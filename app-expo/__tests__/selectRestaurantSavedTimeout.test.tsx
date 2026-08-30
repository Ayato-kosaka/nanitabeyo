/*
#1629 【設計】「このエリアで再取得」が **30 秒で中断したときに画面がどうなるか** を固定する。

## 何が起きていたのか

オーナー報告:「このエリアで再取得でピンが表示されない」。
真因はサーバ（`GET /v1/users/me/saved-restaurants` が p50 8.3 秒 / p95 47 秒）で、
クライアントは 30 秒で中断していた（dev 実測: `api_call_timeout` →
`saved_restaurants_search_error` / raw: AbortError）。サーバ側の 5xx は 0 件である。

サーバは直した（`api/src/v1/restaurants/restaurants.repository.ts`）。
それでも **回線が細ければタイムアウトは起きる**ので、そのときの見え方を決めておく。
決めていなかったせいで、ユーザーには «押しても何も出ない» としか見えなかった。

## この画面が守るべきこと（ここが仕様）

1. **タイムアウトは «通信に失敗しました» と別の文言を出す。** 端末側で打てる手は
   «範囲を狭めてもう一度» しか無いので、それを名指しする
2. **直前に取れていたピンを消さない。** 空にすると «拡大したら全部消えた» になる
3. **もう一度押せる。** 旧実装は «読み込み中なら新しい検索を捨てる» だったので、
   8〜47 秒のあいだボタンが無反応だった。いまは前の検索を AbortController で止めて
   必ず 1 本投げ直す
4. **中断は «失敗» ではない。** 自分で止めたぶんにスナックバーもエラーログも出さない

⚠️ 1 と 3 が赤くなったら、ユーザーから見て «壊れている» 状態へ戻っている。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

const mockRouteParams: { current: Record<string, string> } = { current: {} };
const mockShowSnackbar = jest.fn();
const mockLogFrontendEvent = jest.fn();

jest.mock("expo-router", () => {
	const stub = {
		push: () => {},
		replace: () => {},
		back: () => {},
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
	useRestaurantStore: { getState: () => ({ upsert: () => {}, getById: () => undefined }) },
}));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: false }) }));
jest.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }),
}));
jest.mock("@/hooks/useLogger", () => ({
	useLogger: () => ({ logFrontendEvent: (event: unknown) => mockLogFrontendEvent(event) }),
}));
jest.mock("@/contexts/SnackbarProvider", () => ({
	useSnackbar: () => ({ showSnackbar: (message: string) => mockShowSnackbar(message) }),
}));
// 文言そのものではなく «どのキーを引いたか» を見る（8 ロケールぶんの文面はここでは検証しない）
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));

const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({
	useAPICall: () => ({ callBackend: mockCallBackend }),
}));
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
		default: ReactActual.forwardRef(({ children }: { children?: React.ReactNode }, _ref: unknown) =>
			ReactActual.createElement(RNView, { testID: "map-view" }, children),
		),
		Marker: ({ children, onPress, testID }: { children?: React.ReactNode; onPress?: () => void; testID?: string }) =>
			ReactActual.createElement(RNView, { testID, onPress }, children),
	};
});
// #1629 確認カードを画面下へ置くのに安全域を読む。Provider を立てずに済むよう固定値を返す
jest.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("react-native-maps", () => ({ __esModule: true, default: () => null }));
jest.mock("@/features/restaurantPicker/components/RestaurantLabelMarker", () => ({
	RestaurantLabelMarker: () => null,
}));
jest.mock("@/features/mapMarkers", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		AvatarBubbleMarker: ({ onPress }: { onPress?: () => void }) =>
			ReactActual.createElement(RNView, { testID: "map-marker", onPress }),
	};
});
// 何件のピンがシートへ渡ったかだけ見えれば足りる
const savedCounts: number[] = [];
jest.mock("@/features/restaurantPicker/components/SavedRestaurantsSheet", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		SavedRestaurantsSheet: ReactActual.forwardRef(
			({ savedRestaurants }: { savedRestaurants: unknown[] }, ref: { current?: unknown }) => {
				ReactActual.useImperativeHandle(ref, () => ({ present: () => {}, dismiss: () => {} }));
				savedCounts.push(savedRestaurants?.length ?? 0);
				return ReactActual.createElement(RNView, { testID: "saved-sheet" });
			},
		),
	};
});
jest.mock("@/components/LocationAutocomplete", () => ({ LocationAutocomplete: () => null }));
jest.mock("@/components/PrimaryButton", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	// 「このエリアで再取得」をテストから押せるようにする（本物は見た目だけ）
	return {
		PrimaryButton: ({ onPress, testID }: { onPress?: () => void; testID?: string }) =>
			ReactActual.createElement(RNView, { testID, onPress }),
	};
});
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
jest.mock("@/components/ScreenHeader", () => ({ ScreenHeader: () => null }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));

import SelectRestaurantScreen from "../app/[locale]/(tabs)/my-dishes/select-restaurant";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SAVED = {
	restaurant: { id: "restaurant-42", name: "テスト食堂", latitude: 35, longitude: 139, imageUrls: undefined },
	meta: { averageRating: 4.2, reviewCount: 12, totalCents: 0, maxEndDate: null },
};

/** useAPICall が 30 秒で中断したときに投げるもの（hooks/useAPICall.ts の network_error 分岐） */
const TIMEOUT_ERROR = {
	code: "network_error",
	status: 0,
	message: "Network timeout (30000ms) while calling v1/users/me/saved-restaurants",
	timedOut: true,
	raw: new Error("Aborted"),
};
/** 圏外・回線断（タイムアウトではない network_error） */
const OFFLINE_ERROR = {
	code: "network_error",
	status: 0,
	message: "Network error while calling v1/users/me/saved-restaurants",
	timedOut: false,
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

const pressSearchThisArea = async (tree: TestRenderer.ReactTestRenderer) => {
	const button = tree.root.find((node) => node.props?.testID === "select-restaurant-search-this-area");
	// ⚠️ onPress の戻り値を await しないこと。«応答が返ってこない» を再現するテストでは、
	//    await すると永遠に返らない Promise をそのまま待ってしまう
	await act(async () => {
		button.props.onPress();
	});
};

const savedCalls = () => mockCallBackend.mock.calls.filter(([path]) => path === "v1/users/me/saved-restaurants");

beforeEach(() => {
	mockRouteParams.current = {};
	mockShowSnackbar.mockReset();
	mockLogFrontendEvent.mockReset();
	mockCallBackend.mockReset();
	savedCounts.length = 0;
	mockCallBackend.mockResolvedValue({ data: [SAVED] });
});

describe("#1629 保存したお店の取得が 30 秒でタイムアウトしたとき", () => {
	it("«範囲を狭めてもう一度» と読める専用の文言を出す（通信失敗の文言に混ぜない）", async () => {
		const tree = await render(<SelectRestaurantScreen />);
		mockCallBackend.mockRejectedValue(TIMEOUT_ERROR);

		await pressSearchThisArea(tree);

		expect(mockShowSnackbar).toHaveBeenCalledWith("SelectRestaurant.fetchSavedRestaurantsTimeout");
		expect(mockShowSnackbar).not.toHaveBeenCalledWith("SelectRestaurant.fetchSavedRestaurantsError");
	});

	it("圏外・回線断（timedOut でない）のときは従来どおりの文言のまま", async () => {
		const tree = await render(<SelectRestaurantScreen />);
		mockCallBackend.mockRejectedValue(OFFLINE_ERROR);

		await pressSearchThisArea(tree);

		expect(mockShowSnackbar).toHaveBeenCalledWith("SelectRestaurant.fetchSavedRestaurantsError");
	});

	it("直前に出ていたピンを消さない（«拡大したら全部消えた» にしない）", async () => {
		const tree = await render(<SelectRestaurantScreen />);
		// マウント時の取得で 1 件出ている
		expect(savedCounts[savedCounts.length - 1]).toBe(1);

		mockCallBackend.mockRejectedValue(TIMEOUT_ERROR);
		await pressSearchThisArea(tree);

		expect(savedCounts[savedCounts.length - 1]).toBe(1);
	});

	it("タイムアウトしたことがログに残る（BigQuery で «遅い» と «繋がらない» を分けて数えるため）", async () => {
		const tree = await render(<SelectRestaurantScreen />);
		mockCallBackend.mockRejectedValue(TIMEOUT_ERROR);

		await pressSearchThisArea(tree);

		expect(mockLogFrontendEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				event_name: "saved_restaurants_search_error",
				payload: expect.objectContaining({ timedOut: true }),
			}),
		);
	});
});

describe("#1629 応答が返ってこないあいだも「このエリアで再取得」は押せること", () => {
	/*
	旧実装は «読み込み中なら新しい検索を捨てる» だった。サーバが 8〜47 秒かかっていたので、
	そのあいだ何度押しても **リクエストが 1 本も増えない**（＝ 完全に無反応に見える）。
	いまは前の検索を止めて必ず投げ直す。
	*/
	it("応答待ちの最中に押し直すと、2 本目のリクエストが実際に飛ぶ", async () => {
		const tree = await render(<SelectRestaurantScreen />);
		const before = savedCalls().length;

		// 決して解決しない応答（＝ サーバが返してこない状態）
		mockCallBackend.mockImplementation(() => new Promise(() => {}));

		await pressSearchThisArea(tree);
		await pressSearchThisArea(tree);

		expect(savedCalls().length).toBe(before + 2);
	});

	it("押し直したとき、前のリクエストは AbortController で止められている", async () => {
		const tree = await render(<SelectRestaurantScreen />);
		mockCallBackend.mockImplementation(() => new Promise(() => {}));

		await pressSearchThisArea(tree);
		const firstSignal = savedCalls().at(-1)?.[1]?.signal as AbortSignal | undefined;
		expect(firstSignal).toBeDefined();
		expect(firstSignal?.aborted).toBe(false);

		await pressSearchThisArea(tree);

		expect(firstSignal?.aborted).toBe(true);
	});

	it("自分で止めたぶんは «失敗» として扱わない（スナックバーもエラーログも出さない）", async () => {
		const tree = await render(<SelectRestaurantScreen />);
		mockShowSnackbar.mockClear();
		mockLogFrontendEvent.mockClear();
		mockCallBackend.mockRejectedValue({ code: "aborted", message: "Aborted by caller" });

		await pressSearchThisArea(tree);

		expect(mockShowSnackbar).not.toHaveBeenCalled();
		expect(mockLogFrontendEvent).not.toHaveBeenCalledWith(
			expect.objectContaining({ event_name: "saved_restaurants_search_error" }),
		);
	});
});
