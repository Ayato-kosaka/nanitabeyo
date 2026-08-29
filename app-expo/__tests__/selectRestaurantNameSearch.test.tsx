/*
#1398 (PR6) 【設計】`select-restaurant` の店名検索導線を固定する。

## なぜ必要か
店名検索（`GET /v1/restaurants/search?q=&lat&lng&radius`、#1416 で新設済み）を
`select-restaurant.tsx` に組み込む。絶対条件は2つ:

1. 検索結果を押すと `/[locale]/restaurant/[restaurantId]` へ push されること
2. **入力のたびに `callBackend` を叩かないこと**（デバウンスで確定操作をまとめる）

`app/` 配下に置いたテストは expo-router がルートとして拾ってしまうため、ここに置いている
（`__tests__/mapRestaurantRoute.test.tsx` と同じ理由）。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

const mockPush = jest.fn();
const mockUpsert = jest.fn();

// ⚠️ スタブ本体をファクトリの «外» に置かないこと。import 文はこのファイルの const 宣言より前へ
// 巻き上げられるため、ファクトリが走る時点では外の変数がまだ undefined になる
jest.mock("expo-router", () => {
	const stub = {
		push: (href: unknown) => mockPush(href),
		replace: () => {},
		back: () => {},
		canGoBack: () => true,
	};
	return {
		router: stub,
		useRouter: () => stub,
		useLocalSearchParams: () => ({}),
		useGlobalSearchParams: () => ({}),
		useFocusEffect: () => {},
		useNavigation: () => ({ addListener: () => () => {} }),
	};
});

jest.mock("@/stores/useRestaurantStore", () => ({
	useRestaurantStore: { getState: () => ({ upsert: (entry: unknown) => mockUpsert(entry), getById: () => undefined }) },
}));

jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }),
}));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useScreenTrace", () => ({ useScreenTrace: () => {} }));
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: jest.fn() }) }));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));

jest.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// 店名検索（`v1/restaurants/search`）と保存店検索（`v1/users/me/saved-restaurants`）を
// endpoint 名で振り分ける。マウント時 effect（isJapanese=true なので REGION_JP で即実行）は
// 後者だけを叩くため、前者の呼び出し回数だけを「入力のたびに叩いていないか」の検証に使える。
const mockCallBackend = jest.fn();
const SEARCH_RESULT = {
	restaurant: { id: "restaurant-99", name: "テスト食堂", latitude: 35, longitude: 139, imageUrls: undefined },
	meta: { averageRating: 4.0, reviewCount: 3, totalCents: 0, maxEndDate: null },
};
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));
jest.mock("@/hooks/useLocationSearch", () => ({
	useLocationSearch: () => ({
		getLocationDetails: jest.fn(),
		getCurrentLocation: () => Promise.resolve({ location: { latitude: 35, longitude: 139 } }),
	}),
}));
jest.mock("@/components/MapView", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		__esModule: true,
		default: ReactActual.forwardRef(
			({ children, onPoiClick }: { children?: React.ReactNode; onPoiClick?: (event: unknown) => void }, _ref: unknown) =>
				ReactActual.createElement(RNView, { testID: "map-view", onPress: onPoiClick }, children),
		),
	};
});
jest.mock("react-native-maps", () => ({ __esModule: true, default: () => null }));
jest.mock("@/features/mapMarkers", () => ({ AvatarBubbleMarker: () => null }));
jest.mock("@/components/LocationAutocomplete", () => ({ LocationAutocomplete: () => null }));
jest.mock("@/components/PrimaryButton", () => ({ PrimaryButton: () => null }));
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
jest.mock("@/features/restaurantPicker/components/SavedRestaurantsSheet", () => ({
	SavedRestaurantsSheet: () => null,
}));
jest.mock("expo-image", () => ({ Image: "Image" }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));

import { RestaurantNameSearch } from "@/features/restaurantPicker/components/RestaurantNameSearch";
import type { QueryRestaurantsResponse } from "@shared/api/v1/res";

// 店名検索は画面から切り離したので、コンポーネント単体を最小の器で描く。
// `regionRef` は画面が持っていた「いま見ている地図の中心」で、検索の lat/lng に使われる
const mockOnSelectRestaurant = jest.fn();
function NameSearchHarness({ selectedName = null }: { selectedName?: string | null }) {
	const regionRef = React.useRef({ latitude: 35.68, longitude: 139.76, latitudeDelta: 0.01, longitudeDelta: 0.01 });
	return (
		<RestaurantNameSearch
			regionRef={regionRef}
			onSelectRestaurant={(result: QueryRestaurantsResponse[number]) => mockOnSelectRestaurant(result)}
			selectedName={selectedName}
			onClearSelection={() => {}}
			testID="select-restaurant-name-search"
		/>
	);
}

/** 画面に出ている文字を全部つないで返す（«見つかりません» が残っているかを見るため） */
const visibleText = (tree: TestRenderer.ReactTestRenderer): string =>
	tree.root
		.findAll((node) => typeof node.type === "string" && typeof node.props?.children === "string", { deep: true })
		.map((node) => String(node.props.children))
		.join(" ");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mountedTrees: TestRenderer.ReactTestRenderer[] = [];
const render = async (element: React.ReactElement) => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(element);
	});
	mountedTrees.push(tree);
	return tree;
};

const findByTestId = (tree: TestRenderer.ReactTestRenderer, testID: string) =>
	tree.root.find((node) => node.props?.testID === testID);

const nameSearchCalls = () => mockCallBackend.mock.calls.filter(([path]) => path === "v1/restaurants/search");

beforeEach(() => {
	jest.useFakeTimers();
	mockPush.mockClear();
	mockUpsert.mockClear();
	mockOnSelectRestaurant.mockClear();
	mockCallBackend.mockReset();
	mockCallBackend.mockImplementation((path: string) =>
		Promise.resolve(path === "v1/restaurants/search" ? [SEARCH_RESULT] : { data: [] }),
	);
});

afterEach(async () => {
	await act(async () => {
		mountedTrees.splice(0).forEach((tree) => tree.unmount());
	});
	jest.runOnlyPendingTimers();
	jest.useRealTimers();
});

// #1375 実機確認: select-restaurant の検索窓はエリア検索 1 本に統合した（店名検索の窓は外した）。
// `RestaurantNameSearch` 自体は残っており（SNS URL 取り込みの店舗選択で使う想定）、
// デバウンスと結果押下の挙動はこのコンポーネント単体で固定し続ける。
describe("#1398 (PR6) 店名検索コンポーネント（RestaurantNameSearch）", () => {
	it("入力のたびに callBackend を叩かない（デバウンスで1回にまとまる）", async () => {
		const tree = await render(<NameSearchHarness />);
		const input = findByTestId(tree, "select-restaurant-name-search-input");

		// 3文字を素早く連続入力する（各キーストロークの間はデバウンス時間より短い）
		await act(async () => {
			input.props.onChangeText("テ");
			jest.advanceTimersByTime(100);
			input.props.onChangeText("テス");
			jest.advanceTimersByTime(100);
			input.props.onChangeText("テスト");
		});

		// デバウンス確定（300ms）まで進める
		await act(async () => {
			jest.advanceTimersByTime(300);
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(nameSearchCalls()).toHaveLength(1);
		expect(nameSearchCalls()[0][1]).toEqual(
			expect.objectContaining({
				method: "GET",
				requestPayload: expect.objectContaining({ q: "テスト" }),
			}),
		);
	});

	it("検索結果を押すと onSelectRestaurant にその行がそのまま渡る", async () => {
		const tree = await render(<NameSearchHarness />);
		const input = findByTestId(tree, "select-restaurant-name-search-input");

		await act(async () => {
			input.props.onChangeText("テスト食堂");
		});
		await act(async () => {
			jest.advanceTimersByTime(300);
			await Promise.resolve();
			await Promise.resolve();
		});

		const result = findByTestId(tree, "select-restaurant-name-search-result-0");
		await act(async () => {
			result.props.onPress();
		});

		expect(mockOnSelectRestaurant).toHaveBeenCalledWith(SEARCH_RESULT);
	});

	/**
	 * #1375（6 巡目・実機で 2 回指摘）**外側の器に `flex` を持たせない。**
	 *
	 * 呼び出し元（「食べたを記録」タブ・SNS 取り込みタブ）はどちらも高さを決めない
	 * 普通の縦並びの中にこの部品を置く。そこで器が `flex: 1` だと、ネイティブでは
	 * 高さが 0 に潰れて **入力欄ごと見えなくなる**。
	 *
	 * ⚠️ web（react-native-web）では潰れないので、**スクリーンショットでは正常に見える**。
	 * この差のせいで «直した» と誤って報告した経緯がある。だからここは «見た目» ではなく
	 * **スタイルの値そのもの**を固定する。
	 */
	it("外側の器に flex を持たせない（実機で高さが 0 に潰れるため）", async () => {
		const tree = await render(<NameSearchHarness />);
		const input = findByTestId(tree, "select-restaurant-name-search-input");

		// 入力欄から外側の器までのすべての親のスタイルを集める
		const flexValues: unknown[] = [];
		for (let node = input.parent; node; node = node.parent) {
			const style = node.props?.style;
			for (const entry of Array.isArray(style) ? style : [style]) {
				if (entry && typeof entry === "object" && "flex" in entry) {
					flexValues.push((entry as { flex: unknown }).flex);
				}
			}
		}
		// 入力欄自身の flex: 1（横方向に伸びる）は正しいので、器側だけを見る。
		// 器に flex が 1 つでも付いていたら、それが潰れの原因になる
		expect(flexValues).not.toContain(1);
	});
});

/*
#1629【オーナー実機報告】**この欄の外で店が決まったときの後始末。**

> 「該当するお店が見つかりません」→ 地図の店舗をタップ → お店を選択 → そのエラーが消えない。
> 入力した文字が残る。バツボタンを押すと選択した店が出てくる。

確定名を出す条件が `query.length === 0` だったため、地図の POI タップや候補チップのように
**この欄の外**で決まる経路では打った文字も検索結果も残りっぱなしになっていた。
*/
describe("#1629 外で店が決まったら、打っていた文字と検索結果を畳む", () => {
	it("0 件表示のまま店が決まっても «見つかりません» が残らず、確定名が入力欄に出る", async () => {
		// 0 件を返させて «見つかりません» を出す
		mockCallBackend.mockImplementation((path: string) =>
			Promise.resolve(path === "v1/restaurants/search" ? [] : { data: [] }),
		);

		const tree = await render(<NameSearchHarness />);
		const input = findByTestId(tree, "select-restaurant-name-search-input");

		await act(async () => {
			input.props.onChangeText("焼き鳥番長");
			jest.advanceTimersByTime(300);
			await Promise.resolve();
			await Promise.resolve();
		});

		// 前提: この時点では «見つかりません» が出ていて、打った文字が欄に残っている
		expect(visibleText(tree)).toContain("SelectRestaurant.nameSearch.noResults");
		expect(findByTestId(tree, "select-restaurant-name-search-input").props.value).toBe("焼き鳥番長");

		// 地図の POI から店が決まった（＝ selectedName が外から入る）
		await act(async () => {
			tree.update(<NameSearchHarness selectedName="焼き鳥番長 渋谷店" />);
			await Promise.resolve();
		});

		expect(visibleText(tree)).not.toContain("SelectRestaurant.nameSearch.noResults");
		expect(findByTestId(tree, "select-restaurant-name-search-input").props.value).toBe("焼き鳥番長 渋谷店");
	});
});
