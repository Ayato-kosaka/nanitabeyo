/*
#1629 «食べたを記録 → お店を選ぶ» の地図（`app/[locale]/(tabs)/my-dishes/select-restaurant.tsx`）。

オーナー指摘は「このエリアで再検索が重い」「ピンが出てる数もめっちゃ多い」。
直す前の実測は次のとおりで、**この 4 本はすべて修正前のコードで赤くなる**ことを確認してある。

| 何を測ったか | 修正前 | 修正後 |
| --- | --- | --- |
| 60 件返ったときに描くマーカー | 40 個（`slice(0, 40)`。表示域の外も全部） | 24 個以下（間引き + 畳み + 上限） |
| 同じ場所に 12 件あるとき | 12 個のラベル付きマーカー | «12» の丸 1 個 |
| 地図を 5 回動かしたときの API | 5 本（デバウンス無し） | 1 本 |
| 飛んでいるリクエストの中断 | signal を渡していない（中断しない） | 前の 1 本を abort する |
| 1 件選んだときに props が変わるマーカー | 全部（＝全部が焼き直しの対象） | 選択が動いた 2 件だけ |

ここが守っているのは «数字» そのものである。数字を変えるときは
`features/restaurantPicker/mapPins.ts` の定数と一緒にこのテストも動かすこと。
*/
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
/*
⚠️ フックが返す関数は **参照を固定する**。実物（hooks/useHaptics.ts / useLogger.ts）は
`useCallback` で固定しているので、モックが毎回新しい関数を返すと «画面が悪い» ように見える
（実際、最初に書いたときこれで «onPress が毎回変わる» と誤検出した）。
*/
const mockLightImpact = jest.fn();
const mockMediumImpact = jest.fn();
jest.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({ lightImpact: mockLightImpact, mediumImpact: mockMediumImpact }),
}));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
const mockShowSnackbar = jest.fn();
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: mockShowSnackbar }) }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("@/contexts/ThemeProvider", () => ({
	useAppTheme: () => ({ colors: new Proxy({}, { get: () => "#000000" }) }),
	useThemedStyles: (factory: (c: Record<string, string>) => unknown) =>
		factory(new Proxy({}, { get: () => "#000000" }) as Record<string, string>),
}));

const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));

const mockGetLocationDetails = jest.fn();
const mockGetCurrentLocation = jest.fn(() => Promise.reject(new Error("denied")));
jest.mock("@/hooks/useLocationSearch", () => ({
	useLocationSearch: () => ({
		getLocationDetails: mockGetLocationDetails,
		getCurrentLocation: mockGetCurrentLocation,
	}),
}));

const mockBack = jest.fn();
jest.mock("expo-router", () => {
	const ReactActual = jest.requireActual("react");
	return {
		router: { push: jest.fn(), back: (...args: unknown[]) => mockBack(...args) },
		useLocalSearchParams: () => ({ mode: "pick" }),
		useNavigation: () => ({ addListener: () => () => {} }),
		useFocusEffect: (cb: () => undefined | (() => void)) => ReactActual.useEffect(cb, [cb]),
	};
});

type RegionLike = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
let regionChangeHandler: ((region: RegionLike) => void) | undefined;

/** 1 レンダーぶんの «地図に置かれたマーカー» */
type RenderedMarker = { kind: "label" | "avatar" | "dot" | "cluster"; props: Record<string, unknown> };
let mockRendered: RenderedMarker[] = [];
/** 直前のレンダーで置かれたマーカー（«props が変わっていないか» の比較用） */
let mockPreviousRendered: RenderedMarker[] = [];
const startRenderPass = () => {
	mockPreviousRendered = mockRendered;
	mockRendered = [];
};

jest.mock("@/components/MapView", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		__esModule: true,
		default: ReactActual.forwardRef(
			(
				{
					children,
					onRegionChangeComplete,
				}: { children?: React.ReactNode; onRegionChangeComplete?: (region: RegionLike) => void },
				ref: unknown,
			) => {
				regionChangeHandler = onRegionChangeComplete;
				ReactActual.useImperativeHandle(ref, () => ({ animateToRegion: jest.fn() }));
				return ReactActual.createElement(RNView, { testID: "map-view" }, children);
			},
		),
		// #1629 «点» と «数字の丸» は素の Marker で描かれる
		Marker: (props: Record<string, unknown>) => {
			const testID = props.testID as string | undefined;
			if (testID === "select-restaurant-cluster") mockRendered.push({ kind: "cluster", props });
			if (testID === "select-restaurant-dot") mockRendered.push({ kind: "dot", props });
			return ReactActual.createElement(RNView, { testID }, props.children as React.ReactNode);
		},
	};
});
// #1629 確認カードを画面下へ置くのに安全域を読む。Provider を立てずに済むよう固定値を返す
jest.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("react-native-maps", () => ({ __esModule: true, default: () => null }));

jest.mock("@/features/mapMarkers", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		AvatarBubbleMarker: (props: Record<string, unknown>) => {
			mockRendered.push({ kind: "avatar", props });
			return ReactActual.createElement(RNView, { testID: "avatar-marker" });
		},
	};
});
jest.mock("@/features/restaurantPicker/components/RestaurantLabelMarker", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		RestaurantLabelMarker: (props: Record<string, unknown>) => {
			mockRendered.push({ kind: "label", props });
			return ReactActual.createElement(RNView, { testID: "label-marker" });
		},
	};
});

jest.mock("@/features/restaurantPicker/components/SavedRestaurantsSheet", () => {
	const ReactActual = jest.requireActual("react");
	return { SavedRestaurantsSheet: ReactActual.forwardRef(() => null) };
});
jest.mock("@/components/LocationAutocomplete", () => ({ LocationAutocomplete: () => null }));
jest.mock("@/components/ScreenHeader", () => ({ ScreenHeader: () => null }));
jest.mock("@/components/PrimaryButton", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		PrimaryButton: ({ onPress }: { onPress?: () => void }) =>
			ReactActual.createElement(RNView, { testID: "search-this-area", onPress }),
	};
});

import React, { act } from "react";
import { Text } from "react-native";
import TestRenderer from "react-test-renderer";
import SelectRestaurantScreen from "@/app/[locale]/(tabs)/my-dishes/select-restaurant";
import { MAX_PICKER_MARKERS } from "@/features/restaurantPicker/mapPins";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CENTER = { latitude: 35.68, longitude: 139.76 };
/** ラベルを出す寄り具合（`LABEL_ZOOM_MAX_DELTA` = 0.05 より内側） */
const CLOSE_REGION: RegionLike = { ...CENTER, latitudeDelta: 0.04, longitudeDelta: 0.04 };

/**
 * 互いに畳まれない距離で格子状に並べる。
 * クラスタ半径は «表示域の 8%» なので、`step` は表示域に合わせて呼び出し側が決める。
 */
const spreadRestaurants = (count: number, step = 0.006) => {
	const cols = Math.min(count, 8);
	const rows = Math.ceil(count / cols);
	return Array.from({ length: count }, (_, i) => {
		const row = Math.floor(i / cols);
		const col = i % cols;
		return {
			restaurant: {
				id: `r-${i}`,
				name: `店 ${i}`,
				latitude: CENTER.latitude + (row - (rows - 1) / 2) * step,
				longitude: CENTER.longitude + (col - (cols - 1) / 2) * step,
				imageUrls: { sm: `https://example.com/${i}-sm.jpg`, md: `https://example.com/${i}-md.jpg` },
			},
			meta: { reviewCount: 0, averageRating: 0, totalCents: 0, maxEndDate: null },
		};
	});
};

/** 全部が «重なって見える» 距離に置く（畳まれるべきピン） */
const stackedRestaurants = (count: number) =>
	Array.from({ length: count }, (_, i) => ({
		restaurant: {
			id: `s-${i}`,
			name: `密集 ${i}`,
			latitude: CENTER.latitude + i * 0.00005,
			longitude: CENTER.longitude + i * 0.00005,
			imageUrls: { sm: `https://example.com/s${i}.jpg`, md: `https://example.com/s${i}-md.jpg` },
		},
		meta: { reviewCount: 0, averageRating: 0, totalCents: 0, maxEndDate: null },
	}));

const nearbyCalls = () => mockCallBackend.mock.calls.filter(([endpoint]) => endpoint === "v1/restaurants/search");

/** 近傍検索だけ `data` を差し替え、保存済み検索は空で返す既定のモック */
const respondWithNearby = (data: unknown[]) => {
	mockCallBackend.mockImplementation(async (endpoint: string) => {
		if (endpoint === "v1/restaurants/search") return data;
		return { data: [] };
	});
};

const trees: TestRenderer.ReactTestRenderer[] = [];
const render = async () => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(<SelectRestaurantScreen />);
	});
	trees.push(tree);
	return tree;
};

/** 表示域を動かし、デバウンスぶんの時間を進めて取得を確定させる */
const moveMapTo = async (region: RegionLike) => {
	startRenderPass();
	await act(async () => {
		regionChangeHandler?.(region);
	});
	startRenderPass();
	await act(async () => {
		jest.advanceTimersByTime(1000);
	});
};

beforeEach(() => {
	jest.useFakeTimers();
	mockRendered = [];
	mockPreviousRendered = [];
	regionChangeHandler = undefined;
	mockBack.mockClear();
	respondWithNearby([]);
});

afterEach(async () => {
	await act(async () => {
		trees.splice(0).forEach((tree) => tree.unmount());
	});
	jest.useRealTimers();
});

describe("#1629 描くマーカーの数に上限がある", () => {
	it("60 件返っても、同時に置くマーカーは MAX_PICKER_MARKERS 個まで", async () => {
		respondWithNearby(spreadRestaurants(60));
		await render();
		await moveMapTo(CLOSE_REGION);

		expect(mockRendered.length).toBeGreaterThan(0);
		expect(mockRendered.length).toBeLessThanOrEqual(MAX_PICKER_MARKERS);
	});

	it("表示域の外のピンはマーカーにしない（画面に映っていないものを焼かない）", async () => {
		// 24 件のうち半分を «画面のはるか外»（緯度 +5 度 ≒ 550km）へ置く
		const inside = spreadRestaurants(12);
		const outside = spreadRestaurants(12).map((item, i) => ({
			...item,
			restaurant: { ...item.restaurant, id: `far-${i}`, latitude: item.restaurant.latitude + 5 },
		}));
		respondWithNearby([...inside, ...outside]);
		await render();
		await moveMapTo(CLOSE_REGION);

		expect(mockRendered.length).toBe(12);
	});
});

describe("#1629 重なるピンは «数字の丸» へ畳む", () => {
	it("同じ場所の 12 件は 1 個のクラスタになり、件数を持つ", async () => {
		respondWithNearby(stackedRestaurants(12));
		const tree = await render();
		await moveMapTo(CLOSE_REGION);

		expect(mockRendered).toHaveLength(1);
		expect(mockRendered[0].kind).toBe("cluster");
		// 丸の中の数字が «畳んだ件数» になっていること
		expect(tree.root.findAllByType(Text).map((node) => node.props.children)).toContain(12);
	});
});

describe("#1629 引きでは点、寄りで店名つき", () => {
	it("表示域が広い（0.2 度）ときはラベル付きマーカーを 1 つも置かない", async () => {
		// 0.2 度の表示域ではクラスタ半径が 0.016 度になるので、それより広い間隔に置く
		respondWithNearby(spreadRestaurants(6, 0.05));
		await render();
		await moveMapTo({ ...CENTER, latitudeDelta: 0.2, longitudeDelta: 0.2 });

		expect(mockRendered.length).toBeGreaterThan(0);
		expect(mockRendered.every((marker) => marker.kind === "dot")).toBe(true);
	});

	it("寄っている（0.04 度）ときは店名つきのマーカーになる", async () => {
		respondWithNearby(spreadRestaurants(8));
		await render();
		await moveMapTo(CLOSE_REGION);

		expect(mockRendered.length).toBeGreaterThan(0);
		expect(mockRendered.every((marker) => marker.kind === "label")).toBe(true);
	});
});

describe("#1629 viewport 変更のデバウンスとキャンセル", () => {
	it("地図を 5 回動かしても、飛ぶ近傍検索は 1 本だけ", async () => {
		respondWithNearby(spreadRestaurants(4));
		await render();
		const before = nearbyCalls().length;

		await act(async () => {
			for (let i = 0; i < 5; i++) {
				regionChangeHandler?.({ ...CLOSE_REGION, latitude: CENTER.latitude + i * 0.001 });
				jest.advanceTimersByTime(50);
			}
		});
		await act(async () => {
			jest.advanceTimersByTime(1000);
		});

		expect(nearbyCalls().length - before).toBe(1);
	});

	it("次の検索を始めるとき、飛んでいるリクエストを AbortController で止める", async () => {
		// 応答を返さないモックにして «飛んだまま» を作る
		mockCallBackend.mockImplementation((endpoint: string) =>
			endpoint === "v1/restaurants/search" ? new Promise(() => {}) : Promise.resolve({ data: [] }),
		);
		await render();

		await moveMapTo(CLOSE_REGION);
		const first = nearbyCalls().at(-1)?.[1] as { signal?: AbortSignal } | undefined;
		expect(first?.signal).toBeInstanceOf(AbortSignal);
		expect(first?.signal?.aborted).toBe(false);

		await moveMapTo({ ...CLOSE_REGION, latitude: CENTER.latitude + 0.02 });

		expect(nearbyCalls()).toHaveLength(2);
		expect(first?.signal?.aborted).toBe(true);
	});
});

/*
#1629 **«引いた状態» で検索が成立することを固定する回帰テスト。**

オーナー報告:「日本全体を映して『このエリアで再検索』を押しても必ず 0 件」。
この画面は位置情報を拒否すると `REGION_JP`（日本全体）から始まるので、
開いた直後がまさにその状態だった。原因は `radiusForRegion` が半径を 50km へ
頭打ちにしていたことで、«長野の山中から 50km» しか探していなかった。

⚠️ **この 2 本は修正前のコードで赤くなる**（radius が 50,000 で頭打ちになるため、
   «東京駅までの距離（約 200km）を含む» が満たせない）。
*/
describe("#1629 引き（日本全体）でも、見えている範囲をそのまま検索する", () => {
	/** `features/map/constants.ts` の `REGION_JP` と同じ（日本全体） */
	const JAPAN_REGION: RegionLike = {
		latitude: 36.2048,
		longitude: 138.2529,
		latitudeDelta: 20,
		longitudeDelta: 20,
	};

	/** 2 点間の距離（m）。球面（半径 6,371km）で十分 */
	const distanceMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
		const toRad = (deg: number) => (deg * Math.PI) / 180;
		const dLat = toRad(b.lat - a.lat);
		const dLng = toRad(b.lng - a.lng);
		const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
		return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
	};

	it("日本全体を映したときの検索半径に、東京駅が入る（50km で頭打ちにしない）", async () => {
		await render();
		await moveMapTo(JAPAN_REGION);

		const payload = nearbyCalls().at(-1)?.[1] as { requestPayload: { lat: number; lng: number; radius: number } };
		expect(payload.requestPayload.radius).toBeGreaterThan(50_000);
		expect(payload.requestPayload.radius).toBeGreaterThan(
			distanceMeters(
				{ lat: payload.requestPayload.lat, lng: payload.requestPayload.lng },
				{ lat: 35.681236, lng: 139.767125 },
			),
		);
	});

	it("引いた状態で返ってきた全国の店が、地図にちゃんと出る（0 件にならない）", async () => {
		// 全国に散らばった 5 件（東京・大阪・福岡・札幌・仙台）
		const nationwide = [
			{ id: "tokyo", latitude: 35.681236, longitude: 139.767125 },
			{ id: "osaka", latitude: 34.6937, longitude: 135.5023 },
			{ id: "fukuoka", latitude: 33.5904, longitude: 130.4017 },
			{ id: "sapporo", latitude: 43.0618, longitude: 141.3545 },
			{ id: "sendai", latitude: 38.2682, longitude: 140.8694 },
		].map(({ id, latitude, longitude }) => ({
			restaurant: {
				id,
				name: id,
				latitude,
				longitude,
				imageUrls: { sm: `https://example.com/${id}.jpg`, md: `https://example.com/${id}-md.jpg` },
			},
			meta: { reviewCount: 0, averageRating: 0, totalCents: 0, maxEndDate: null },
		}));
		respondWithNearby(nationwide);
		await render();
		await moveMapTo(JAPAN_REGION);

		expect(mockRendered.length).toBeGreaterThan(0);
	});
});

describe("#1629 1 件選んでも、他のマーカーの props は作り直さない", () => {
	it("マーカーを押したとき、描き直されるのは選択が動いたマーカーだけ", async () => {
		respondWithNearby(spreadRestaurants(8));
		await render();
		await moveMapTo(CLOSE_REGION);

		expect(mockRendered).toHaveLength(8);
		const pressFirst = mockRendered[0].props.onPress as () => void;
		const pressBefore = mockRendered.map((marker) => marker.props.onPress);

		startRenderPass();
		await act(async () => {
			pressFirst();
		});

		/*
		直す前は、選択が変わると `useMemo` が全マーカーを新しい `coordinate` と
		新しい `onPress` で作り直していたので、ここに 8 個並ぶ（＝ 8 枚焼き直す）。
		いまは props が実際に変わるのは «選ばれた 1 件» だけで、残りは React.memo が止める。
		*/
		expect(mockRendered).toHaveLength(1);
		expect(mockRendered[0].props.isActive).toBe(true);
		// 描き直された 1 件でも、押すための関数は同じ参照のまま（ビットマップの鍵は isActive だけ）
		expect(mockRendered[0].props.onPress).toBe(pressBefore[0]);
		// 比較の土台（直前のレンダー）が空振りしていないこと
		expect(mockPreviousRendered).toHaveLength(8);
	});
});
