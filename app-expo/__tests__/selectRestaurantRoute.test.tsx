/*
#1451 【設計】店舗選択 → 店詳細 «ルート» の結び目を固定する。

## なぜ必要か
遷移先（`app/[locale]/restaurant/[restaurantId].tsx`）は `useRestaurantStore` の
キャッシュ優先で描く。この画面は `POST v1/restaurants` /
`GET v1/users/me/saved-restaurants` の応答として **店の実体をすでに持っている**ので、
push より先にストアへ入れておけば遷移先は API を引かずに即描ける。
逆順にすると、遷移先のマウント時点ではストアが空なので `GET v1/restaurants/:id` を
1 本余計に叩き、その間ローディングが出る。**順序を入れ替えると赤くなる**ようにしてある。

## この検査が無かった経緯（同じ轍を踏まないために）
同じ不変条件は `__tests__/mapRestaurantRoute.test.tsx` が持っていたが、**あれは地図タブ側
だけを見ていた**。その地図タブは `_layout.tsx` で `href: null` ＝ 本番から到達不能で、
#1419 で丸ごと削除した。**到達可能なこの画面は、最初から 1 度も守られていなかった。**

「到達不能な側にだけ検査が付いている」は #1411 / #1418 と同じ形の見落としである
（`docs/decisions/20260819-blur-modal-teardown.md` の «#1419 マップタブを丸ごと削除した» を参照）。

## 4 経路すべてを見る
`upsert → push` は 1 箇所ではなく **4 箇所**にある。1 つだけ直しても他が壊れうるので全部固定する。

| 経路 | ハンドラ |
| --- | --- |
| 地図の POI 押下（＝ Place から店を作る） | `createAndOpenRestaurant` |
| 保存した店のマーカー押下（アクティブなものをもう一度） | `handleSavedRestaurantMarkerPress` |
| 保存した店のカード押下 | `handleSavedRestaurantCardPress` |
| 保存した店の「写真・動画を投稿」 | `handleSavedRestaurantReviewPress` |

## 方針
`router.push` と `useRestaurantStore.upsert` の «呼び出し順» を 1 本の列で観測する。
周辺（地図・位置情報・シート・画像）はすべてスタブへ落とす。

`app/` 配下に置いたテストは expo-router がルートとして拾ってしまうため、ここに置いている。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

/** push と upsert の «呼び出し順» を 1 本の列で観測する（この 2 つの順序が検証対象） */
/** ルートのパラメータ（`mode=pick` の有無を切り替えるため可変にする） */
const mockRouteParams: { current: Record<string, string> } = { current: {} };
const callOrder: string[] = [];
const mockPush = jest.fn((_href: unknown) => {
	callOrder.push("push");
});
// #1629 «1 回目では確定しない / カードのボタンで確定する» を見るために露出する
const mockBack = jest.fn();
const mockUpsert = jest.fn((_entry: unknown) => {
	callOrder.push("upsert");
});

// ⚠️ スタブ本体をファクトリの «外» に置かないこと。import 文はこのファイルの const 宣言より前へ
// 巻き上げられるため、ファクトリが走る時点では外の変数がまだ undefined になる
// （loginEntryPoints.test.tsx と同じ注意）
jest.mock("expo-router", () => {
	const stub = {
		push: (href: unknown) => mockPush(href),
		replace: () => {},
		// #1629 «1 回目では確定しない / カードのボタンで確定する» を見るために露出する
		back: () => mockBack(),
		canGoBack: () => true,
	};
	return {
		router: stub,
		useRouter: () => stub,
		useLocalSearchParams: () => mockRouteParams.current,
		useGlobalSearchParams: () => ({}),
		useFocusEffect: () => {},
		useNavigation: () => ({ addListener: () => () => {} }),
	};
});

jest.mock("@/stores/useRestaurantStore", () => ({
	useRestaurantStore: { getState: () => ({ upsert: (entry: unknown) => mockUpsert(entry), getById: () => undefined }) },
}));

jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: false }) }));
jest.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }),
}));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: jest.fn() }) }));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));

const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({
	useAPICall: () => ({ callBackend: mockCallBackend }),
	ApiError: class ApiError extends Error {},
}));
jest.mock("@/hooks/useLocationSearch", () => ({
	useLocationSearch: () => ({
		getLocationDetails: jest.fn(),
		// マウント時 effect が現在地の周辺検索まで走り、保存した店のマーカーが描かれるところまで進む
		getCurrentLocation: () => Promise.resolve({ location: { latitude: 35, longitude: 139 } }),
	}),
}));
jest.mock("@/components/MapView", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		__esModule: true,
		// POI 押下（onPoiClick）をテストから起動できるよう、ハンドラを testID 付きで露出する
		default: ReactActual.forwardRef(
			(
				{
					children,
					onPoiClick,
					onRegionChangeComplete,
				}: {
					children?: React.ReactNode;
					onPoiClick?: (event: unknown) => void;
					// #1375 «指を離した» をテストから起こせるようにする（周辺のお店を引く契機）
					onRegionChangeComplete?: (region: unknown) => void;
				},
				_ref: unknown,
			) =>
				ReactActual.createElement(
					RNView,
					{ testID: "map-view", onPress: onPoiClick, onRegionChange: onRegionChangeComplete },
					children,
				),
		),
		// #1629 畳んだ «数字の丸» と引きの «点» は素の Marker で描かれる
		Marker: ({ children, onPress, testID }: { children?: React.ReactNode; onPress?: () => void; testID?: string }) =>
			ReactActual.createElement(RNView, { testID, onPress }, children),
	};
});
jest.mock("react-native-maps", () => ({ __esModule: true, default: () => null }));
// #1629 確認カードを画面下へ置くのに安全域を読む。Provider を立てずに済むよう固定値を返す
jest.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
/*
#1629【オーナー確定】ピンは «食べたい / 食べた» のマップと同じ丸（`AvatarBubbleMarker`）に
統一した。以前は «近くのお店 = 店名つき / 保存したお店 = 丸» と別実装で、前者だけが
Android で映らなかった（オーナー実機報告）。

同じ画面に 2 種類が並ぶことは無い（`pins` は pick モードなら近くのお店、そうでなければ
保存したお店の **どちらか一方**）。したがって «何個描かれたか» だけで両方の検証が足りる。

⚠️ **店名はピンに載らなくなった**ので、名前の検証はできない。名前が正しく渡ることは
   店を押したあとの確認カード（`select-restaurant-pick-confirm`）が見ている。
*/
const renderedPins: { onPress?: () => void }[] = [];
jest.mock("@/features/mapMarkers", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		// マーカーは「押せる何か」としてだけ必要。押下ハンドラを testID 付きで露出する
		AvatarBubbleMarker: ({ onPress }: { onPress?: () => void }) => {
			renderedPins.push({ onPress });
			return ReactActual.createElement(RNView, { testID: "restaurant-pin", onPress });
		},
	};
});
// シートの中身は要らない。カード押下 / 投稿ボタン押下の 2 経路だけを押せる形で露出する
jest.mock("@/features/restaurantPicker/components/SavedRestaurantsSheet", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		SavedRestaurantsSheet: ReactActual.forwardRef(
			(
				{
					savedRestaurants,
					onRestaurantCardPress,
					onRestaurantReviewPress,
				}: {
					savedRestaurants: { restaurant: { id: string } }[];
					onRestaurantCardPress?: (r: { restaurant: { id: string } }) => void;
					onRestaurantReviewPress?: (r: { restaurant: { id: string } }) => void;
				},
				ref: { current?: unknown },
			) => {
				ReactActual.useImperativeHandle(ref, () => ({ present: () => {}, dismiss: () => {} }));
				const first = savedRestaurants?.[0];
				return ReactActual.createElement(
					RNView,
					null,
					ReactActual.createElement(RNView, {
						key: "card",
						testID: "saved-restaurant-card",
						onPress: () => first && onRestaurantCardPress?.(first),
					}),
					ReactActual.createElement(RNView, {
						key: "review",
						testID: "saved-restaurant-review",
						onPress: () => first && onRestaurantReviewPress?.(first),
					}),
				);
			},
		),
	};
});
jest.mock("@/components/LocationAutocomplete", () => ({ LocationAutocomplete: () => null }));
jest.mock("@/components/PrimaryButton", () => ({ PrimaryButton: () => null }));
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
jest.mock("@/components/ScreenHeader", () => ({ ScreenHeader: () => null }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));

import SelectRestaurantScreen from "../app/[locale]/(tabs)/my-dishes/select-restaurant";
import { PICKER_FETCH_DEBOUNCE_MS } from "@/features/restaurantPicker/mapPins";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RESTAURANT_ID = "restaurant-42";
const SAVED = {
	restaurant: { id: RESTAURANT_ID, name: "テスト食堂", latitude: 35, longitude: 139, imageUrls: undefined },
	meta: { averageRating: 4.2, reviewCount: 12, totalCents: 0, maxEndDate: null },
};
/** POI 押下で作られる店（`POST v1/restaurants` の応答） */
const CREATED = { restaurant: SAVED.restaurant, meta: SAVED.meta };

const mountedTrees: TestRenderer.ReactTestRenderer[] = [];
const render = async (element: React.ReactElement) => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(element);
	});
	mountedTrees.push(tree);
	return tree;
};

afterEach(async () => {
	await act(async () => {
		mountedTrees.splice(0).forEach((tree) => tree.unmount());
	});
});

/** 指定 testID の要素を押す（引数はハンドラへそのまま渡す） */
const press = async (tree: TestRenderer.ReactTestRenderer, testID: string, arg?: unknown): Promise<void> => {
	const target = tree.root.find((node) => node.props?.testID === testID);
	await act(async () => {
		await target.props.onPress(arg);
	});
};

beforeEach(() => {
	callOrder.length = 0;
	mockBack.mockClear();
	renderedPins.length = 0;
	mockRouteParams.current = {};
	mockCallBackend.mockReset();
	// 保存した店の検索（GET）は { data } を、店の作成（POST v1/restaurants）は単体を返す
	mockCallBackend.mockImplementation((path: string) =>
		Promise.resolve(path === "v1/restaurants" ? CREATED : { data: [SAVED] }),
	);
});

describe("#1451 店舗選択から店詳細へ push する 4 経路", () => {
	/*
	⚠️ アサーションは «push されたこと» ではなく **`["upsert", "push"]` という列**に置くこと。
	push だけを見ていると、順序を入れ替えても緑のままになる（それが今まさに無防備だった形）。
	*/
	it("地図の POI 押下: 店を作ってから upsert → push の順で遷移する", async () => {
		const tree = await render(<SelectRestaurantScreen />);

		await press(tree, "map-view", {
			nativeEvent: { placeId: "place-1", name: "テスト食堂", coordinate: { latitude: 35, longitude: 139 } },
		});

		expect(mockCallBackend).toHaveBeenCalledWith("v1/restaurants", expect.objectContaining({ method: "POST" }));
		expect(callOrder).toEqual(["upsert", "push"]);
		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/restaurant/[restaurantId]",
			params: { locale: "ja-JP", restaurantId: RESTAURANT_ID },
		});
	});

	it("保存した店のカード押下: upsert → push の順で遷移する", async () => {
		const tree = await render(<SelectRestaurantScreen />);

		await press(tree, "saved-restaurant-card");

		expect(callOrder).toEqual(["upsert", "push"]);
		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/restaurant/[restaurantId]",
			params: { locale: "ja-JP", restaurantId: RESTAURANT_ID },
		});
	});

	it("保存した店の「写真・動画を投稿」: upsert → push の順で投稿フォームへ進む", async () => {
		const tree = await render(<SelectRestaurantScreen />);

		await press(tree, "saved-restaurant-review");

		expect(callOrder).toEqual(["upsert", "push"]);
		expect(mockPush).toHaveBeenCalledWith(
			expect.objectContaining({
				pathname: "/[locale]/restaurant/[restaurantId]/review",
			}),
		);
	});

	/*
	マーカーは «2 度押し» が仕様である。1 度目はアクティブにするだけで遷移しない
	（シートのスクロールを同期させるため）。ここを 1 度目で遷移させると、
	地図を触っただけで画面が飛ぶ。
	*/
	it("保存した店のマーカー押下: 1 度目は遷移せず、2 度目に upsert → push する", async () => {
		const tree = await render(<SelectRestaurantScreen />);

		await press(tree, "restaurant-pin");
		expect(callOrder).toEqual([]);

		await press(tree, "restaurant-pin");
		expect(callOrder).toEqual(["upsert", "push"]);
	});
});

/*
#1375（オーナー指示 8 巡目）**「お店を探す」ときのピン。**

保存済みのピンだけが出ていたため、«まだ保存していない店を探す» というこの画面本来の
目的に対して地図に手がかりが無かった。pick モードでは **アプリ内のお店データ**を
**店名の文字つき**で出す。

#1629 **上限は «取得件数を切る» ではなく «畳んでから描く数を切る» へ変えた。**
旧実装は取得した 120 件を `slice(0, 40)` して 40 個のマーカーを置いていた
（表示域の外も含めて全部）。いまは間引き → 畳み → 上限（`MAX_PICKER_MARKERS`）で、
重なるピンは «数字の丸» 1 個になる。数そのものの回帰は
`__tests__/selectRestaurantMap.test.tsx` が実数で固定している。
*/
describe("#1375 «お店を探す»（pick モード）のピン", () => {
	/**
	 * 指を離した（＝表示域が確定した）ことにする。
	 *
	 * ⚠️ #1629 で取得は **デバウンス**されるようになった。表示域を渡すだけでは飛ばないので、
	 * ここで待ち時間ぶん進める（この待ちを消すと «取得しない» ように見えて赤くなる）。
	 */
	const settleRegion = async (tree: TestRenderer.ReactTestRenderer) => {
		const map = tree.root.find((node) => node.props?.testID === "map-view");
		await act(async () => {
			await map.props.onRegionChange({
				latitude: 35.68,
				longitude: 139.76,
				latitudeDelta: 0.05,
				longitudeDelta: 0.05,
			});
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, PICKER_FETCH_DEBOUNCE_MS + 50));
		});
	};

	/** 互いに畳まれない距離（表示域 0.05 度に対しクラスタ半径は 0.004 度）で並べる */
	const nearby = (n: number) =>
		Array.from({ length: n }, (_, i) => ({
			restaurant: {
				id: `n-${i}`,
				name: `お店${i}`,
				latitude: 35.68 + i * 0.006,
				longitude: 139.76,
				imageUrls: { sm: null },
			},
			meta: { reviewCount: 0, averageRating: 0, totalCents: 0, maxEndDate: null },
		}));

	/** 全部が同じ座標（＝ 重なって見える）ピン */
	const stacked = (n: number) =>
		Array.from({ length: n }, (_, i) => ({
			restaurant: { id: `n-${i}`, name: `お店${i}`, latitude: 35.68, longitude: 139.76, imageUrls: { sm: null } },
			meta: { reviewCount: 0, averageRating: 0, totalCents: 0, maxEndDate: null },
		}));

	it("アプリ内のお店を店名つきのピンで出す（自前の検索 API を引く。Google Places は呼ばない）", async () => {
		mockRouteParams.current = { mode: "pick" };
		mockCallBackend.mockImplementation((path: string) =>
			Promise.resolve(path === "v1/restaurants/search" ? nearby(3) : { data: [SAVED] }),
		);

		const tree = await render(<SelectRestaurantScreen />);
		await settleRegion(tree);

		expect(mockCallBackend).toHaveBeenCalledWith("v1/restaurants/search", expect.objectContaining({ method: "GET" }));
		// #1629 ピンに店名は載らなくなったので «3 件ぶん立つこと» を見る（上のモックの申し送り）
		expect(renderedPins).toHaveLength(3);
	});

	it("重なるピンは «数字の丸» 1 個へ畳む（120 件をそのまま置かない）", async () => {
		mockRouteParams.current = { mode: "pick" };
		mockCallBackend.mockImplementation((path: string) =>
			Promise.resolve(path === "v1/restaurants/search" ? stacked(120) : { data: [SAVED] }),
		);

		const tree = await render(<SelectRestaurantScreen />);
		await settleRegion(tree);

		expect(renderedPins).toHaveLength(0);
		// 実体（host 要素）だけ数える。composite を含めると 1 個の丸が複数回一致する
		expect(
			tree.root.findAll((node) => typeof node.type === "string" && node.props?.testID === "select-restaurant-cluster"),
		).toHaveLength(1);
	});

	it("«形が違う» 応答でも落ちない（空で描く）", async () => {
		mockRouteParams.current = { mode: "pick" };
		mockCallBackend.mockImplementation((path: string) =>
			Promise.resolve(path === "v1/restaurants/search" ? { unexpected: true } : { data: [SAVED] }),
		);

		const tree = await render(<SelectRestaurantScreen />);
		await settleRegion(tree);

		expect(renderedPins).toHaveLength(0);
	});

	/*
	#1629【オーナー実機報告 → 指示】「店ピンを二度押さないと反映されない」。

	**2 回押す作法そのものは残す**（#1375 8 巡目のオーナー指示。地図を触っていて指が当たった
	だけで記録するお店が決まるのを防ぐため）。壊れていたのは «1 回目に何が起きたか分からない»
	ことで、1 回目に起きるのはピンの色が変わることだけだった。

	1 回目のタップで «選んだ店の名前 + このお店にする» を出し、押す対象を言葉で見せる。
	*/
	it("1 回目のタップで «このお店にする» が出る。まだ確定はしない", async () => {
		mockRouteParams.current = { mode: "pick" };
		mockCallBackend.mockImplementation((path: string) =>
			// ⚠️ ピンは 1 本にする。`press` は testID が 1 つであることを前提にしている
			Promise.resolve(path === "v1/restaurants/search" ? nearby(1) : { data: [SAVED] }),
		);

		const tree = await render(<SelectRestaurantScreen />);
		await settleRegion(tree);

		// 前提: ピンが立っている（0 本のまま «出ない» を ✅ と読まない）
		expect(renderedPins.length).toBeGreaterThan(0);
		// 何も選んでいない間はカードを出さない
		expect(tree.root.findAll((node) => node.props?.testID === "select-restaurant-pick-confirm")).toHaveLength(0);

		await press(tree, "restaurant-pin");

		expect(
			tree.root.findAll((node) => node.props?.testID === "select-restaurant-pick-confirm").length,
		).toBeGreaterThan(0);
		// **まだ確定していない**（画面を離れない）
		expect(mockBack).not.toHaveBeenCalled();
	});

	it("カードの «このお店にする» で確定して前の画面へ戻る", async () => {
		mockRouteParams.current = { mode: "pick" };
		mockCallBackend.mockImplementation((path: string) =>
			Promise.resolve(path === "v1/restaurants/search" ? nearby(1) : { data: [SAVED] }),
		);

		const tree = await render(<SelectRestaurantScreen />);
		await settleRegion(tree);
		await press(tree, "restaurant-pin");
		await press(tree, "select-restaurant-pick-confirm-button");

		expect(mockBack).toHaveBeenCalled();
	});

	it("pick モードでないときは、この検索を投げない（従来どおり保存したお店を出す）", async () => {
		mockRouteParams.current = {};
		const tree = await render(<SelectRestaurantScreen />);
		await settleRegion(tree);

		expect(mockCallBackend).not.toHaveBeenCalledWith("v1/restaurants/search", expect.anything());
		// pick モードでないときのピンは «保存したお店»。近くのお店は 1 件も引いていない
		expect(renderedPins).toHaveLength(1);
	});
});
