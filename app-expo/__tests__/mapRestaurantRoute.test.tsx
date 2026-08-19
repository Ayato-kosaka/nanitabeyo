/*
#1386 【設計】地図タブ → 店詳細 «ルート» の結び目を固定する。

## なぜ必要か
モーダル時代の地図は `selectedPlace`（useState）＋ `openRestaurantModal()` で店詳細を
自分の中に描いていた。押した先は型でも E2E でも表現されていない boolean だった。
ルートになると行き先は文字列になり、**間違えても型検査を通る**（typed routes は pathname の
綴りは見るが、locale や «どのルートを選んだか» の意味までは見ない）。

## 順序が意味を持つ
遷移先（`app/[locale]/(tabs)/review/restaurant/[restaurantId].tsx`）は
`useRestaurantStore` のキャッシュ優先で描く。地図は `POST v1/restaurants` /
`GET v1/restaurants/search` の応答として **店の実体をすでに持っている**ので、
push より先にストアへ入れておけば遷移先は API を引かずに即描ける。
逆順にすると、遷移先のマウント時点ではストアが空なので `GET v1/restaurants/:id` を
1 本余計に叩き、その間ローディングが出る。**順序を入れ替えると赤くなる**ようにしてある。

## portal を持たないこと
`Portal.Host` は `<Stack>` を包んでいる（app/[locale]/_layout.tsx）ので、BlurModal を
開いたまま push すると遷移先は portal の下に潜って見えず触れない（#1364 で実測）。
地図がオーバーレイを 1 つも持たないことを、react-native-paper の `<Portal>` が描かれるか否かで
固定する（`__tests__/legalEntryPoints.test.tsx` と同じ形）。#1350 P6 で `features/blurModal` は
撤去済みなので、観測点はモジュール名ではなく機構そのものに置いてある。

`app/` 配下に置いたテストは expo-router がルートとして拾ってしまうため、ここに置いている。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

/** push と upsert の «呼び出し順» を 1 本の列で観測する（この 2 つの順序が検証対象） */
const callOrder: string[] = [];
const mockPush = jest.fn((_href: unknown) => {
	callOrder.push("push");
});
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
		back: () => {},
		canGoBack: () => true,
	};
	return {
		router: stub,
		useRouter: () => stub,
		useLocalSearchParams: () => ({}),
		useGlobalSearchParams: () => ({}),
	};
});

jest.mock("@/features/review/stores/useRestaurantStore", () => ({
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

// 地図・位置情報・API は「押した先」の検証に関係しないので落とす。
// getCurrentLocation は mount 時 effect で呼ばれるため、解決しない Promise を返して静かにさせる
const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));
jest.mock("@/hooks/useLocationSearch", () => ({
	useLocationSearch: () => ({
		getLocationDetails: jest.fn(),
		// マウント時 effect が現在地の周辺検索まで走り、マーカーが描かれるところまで進む
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
			({ children, onPoiClick }: { children?: React.ReactNode; onPoiClick?: (event: unknown) => void }, _ref: unknown) =>
				ReactActual.createElement(RNView, { testID: "map-view", onPress: onPoiClick }, children),
		),
	};
});
jest.mock("react-native-maps", () => ({ __esModule: true, default: () => null }));
jest.mock("@/features/mapMarkers", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		// マーカーは「押せる何か」としてだけ必要。押下ハンドラを testID 付きで露出する
		AvatarBubbleMarker: ({ onPress }: { onPress?: () => void }) =>
			ReactActual.createElement(RNView, { testID: "map-marker", onPress }),
	};
});
jest.mock("@/components/LocationAutocomplete", () => ({ LocationAutocomplete: () => null }));
jest.mock("@/components/PrimaryButton", () => ({ PrimaryButton: () => null }));
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));

/**
 * `<Portal>` のスタブ。
 *
 * ⚠️ 描かれたこと «自体» が検証対象。#1350 P6 で `features/blurModal` を撤去したので、
 * この検査は «消えたモジュール名» ではなく BlurModal が使っていた **機構そのもの**
 * （react-native-paper の `<Portal>`）を見る。直に `<Portal>` を書いても、凍結コピーの
 * `useLegacyBlurModal` を持ち込んでも、同じようにここが赤くなる。
 */
const mockPortal = jest.fn();
jest.mock("react-native-paper", () => ({
	// Portal 以外は本物のまま通す。テーマ（constants/PaperTheme.ts の MD3DarkTheme）など、
	// この画面が «今は» 使っていないだけの export を undefined にすると、将来 useThemeColor を
	// 1 つ足しただけで «Portal と無関係な» TypeError で落ちるため
	...jest.requireActual("react-native-paper"),
	Portal: () => {
		mockPortal();
		return null;
	},
}));

import MapScreen from "../app/[locale]/(tabs)/map";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RESTAURANT_ID = "restaurant-42";
const ENTRY = {
	restaurant: { id: RESTAURANT_ID, name: "テスト食堂", latitude: 35, longitude: 139, imageUrls: undefined },
	meta: { averageRating: 4.2, reviewCount: 12, totalCents: 0, maxEndDate: null },
};

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
	mockPush.mockClear();
	mockUpsert.mockClear();
	mockPortal.mockClear();
	// 周辺検索（GET v1/restaurants/search）は配列、店の作成（POST v1/restaurants）は単体を返す
	mockCallBackend.mockReset();
	mockCallBackend.mockImplementation((path: string) => Promise.resolve(path === "v1/restaurants" ? ENTRY : [ENTRY]));
});

/** 期待する push の引数（3 経路すべてで同じ形になること） */
const EXPECTED_PUSH = {
	pathname: "/[locale]/(tabs)/review/restaurant/[restaurantId]",
	params: { locale: "ja-JP", restaurantId: RESTAURANT_ID },
};

describe("#1386 地図から店詳細ルートへの遷移", () => {
	it("マーカー押下で店詳細ルートへ restaurantId 付きで push する", async () => {
		const tree = await render(<MapScreen />);

		await press(tree, "map-marker");

		expect(mockPush).toHaveBeenCalledTimes(1);
		expect(mockPush).toHaveBeenCalledWith(EXPECTED_PUSH);
	});

	// POI（地図上の店ラベル）押下は `POST v1/restaurants` の応答から遷移する別経路。
	// 同じ関数を通ることを «経路ごとに» 見る（片方だけ直す事故を防ぐ）
	it("POI 押下でも同じルートへ push する", async () => {
		const tree = await render(<MapScreen />);

		await press(tree, "map-view", { nativeEvent: { placeId: "place-1" } });

		expect(mockPush).toHaveBeenCalledTimes(1);
		expect(mockPush).toHaveBeenCalledWith(EXPECTED_PUSH);
	});

	// ⚠️ 順序が逆になると、遷移先はストアが空の状態でマウントされて
	// `GET v1/restaurants/:id` を 1 本余計に叩く（その間ローディングが出る）
	it("ストアへの upsert は push より先に行う", async () => {
		const tree = await render(<MapScreen />);

		await press(tree, "map-marker");

		expect(mockUpsert).toHaveBeenCalledWith({ restaurant: ENTRY.restaurant, meta: ENTRY.meta });
		expect(callOrder).toEqual(["upsert", "push"]);
	});

	// #1386 地図がオーバーレイを持たなくなったこと自体の固定（ファイル冒頭のコメント参照）
	it("地図は Portal を 1 つも描かない", async () => {
		const tree = await render(<MapScreen />);

		await press(tree, "map-marker");

		expect(mockPortal).not.toHaveBeenCalled();
	});
});
