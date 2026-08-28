/*
#1396 PR4 の中核テスト（設計書 (2/2) §3-2 / §8-4 リスク2）。

Map の pan/zoom（`onRegionChangeComplete`）は `MyDishesMapView` 内の `useRef` へ書くだけで、
`useMyDishesFilterStore` には**一切触れない**こと。ここを破ると pan のたびに `queryKey` が
変わり、裏にいるリスト/Calendar が 964MB の `dish_reviews` へ再取得を投げ続ける
（#1395 §0(A): 平均 4.48 秒 / 最大 11.23 秒）。

store（= queryKey）を書くのは「このエリアで再検索」ボタン押下時の `commitArea` と、
PR4 レビュー M-2 で追加した解除ボタンの `clearArea` だけである
（既存 `select-restaurant.tsx` の `currentRegion` ref の先例と同じ形）。
*/
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }) }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));

// #1375 G2: Map の初期表示。既定は «現在地が取れない»（= 権限拒否）にして従来挙動を壊さない
const mockGetCurrentLocationPosition = jest.fn(() => Promise.reject(new Error("denied")));
jest.mock("@/hooks/useCurrentLocationPosition", () => ({
	getCurrentLocationPosition: () => mockGetCurrentLocationPosition(),
}));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));

type RegionLike = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
let regionChangeHandler: ((region: RegionLike) => void) | undefined;
let mapReadyHandler: (() => void) | undefined;
const mockAnimateToRegion = jest.fn();
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
					onMapReady,
				}: {
					children?: React.ReactNode;
					onRegionChangeComplete?: (region: RegionLike) => void;
					onMapReady?: () => void;
				},
				ref: unknown,
			) => {
				regionChangeHandler = onRegionChangeComplete;
				mapReadyHandler = onMapReady;
				// #1396 M-3 / m-1: MyDishesMapView が `mapRef.current.animateToRegion` を呼べるようにする
				ReactActual.useImperativeHandle(ref, () => ({ animateToRegion: mockAnimateToRegion }));
				return ReactActual.createElement(RNView, { testID: "map-view" }, children);
			},
		),
		// #1375（5 巡目）クラスタの丸は素の Marker で描く（AvatarBubbleMarker ではない）
		Marker: ({ children, onPress, testID }: { children?: React.ReactNode; onPress?: () => void; testID?: string }) => {
			if (onPress && testID === "my-dishes-map-cluster") clusterPresses.push(onPress);
			return ReactActual.createElement(RNView, { testID }, children);
		},
	};
});
jest.mock("react-native-maps", () => ({ __esModule: true, default: () => null }));

const clusterPresses: Array<() => void> = [];
const pinPresses: Array<() => void> = [];
const pinUris: Array<string | undefined> = [];
// #1513 墓標のピンは «uri を渡さず bubbleContent を渡す» ので、その有無も拾う
const pinBubbleContents: Array<unknown> = [];
jest.mock("@/features/mapMarkers", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		AvatarBubbleMarker: ({
			onPress,
			uri,
			testID,
			bubbleContent,
		}: {
			onPress?: () => void;
			uri?: string;
			testID?: string;
			bubbleContent?: unknown;
		}) => {
			if (onPress) pinPresses.push(onPress);
			pinUris.push(uri);
			pinBubbleContents.push(bubbleContent);
			return ReactActual.createElement(RNView, { testID }, (bubbleContent ?? null) as never);
		},
	};
});

// #1375 実機確認: 下部シートは «常設»（ピン選択に依存しない）へ役割が変わった。
// 中身は専用 suite で見るので、ここでは «何件のピンが渡ったか» だけ拾うスタブにする
const sheetPinLists: Array<unknown[]> = [];
jest.mock("./MyDishesMapSheet", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		MyDishesMapSheet: ({ pins }: { pins: unknown[] }) => {
			sheetPinLists.push(pins);
			return pins.length > 0 ? ReactActual.createElement(RNView, { testID: "my-dishes-map-sheet" }) : null;
		},
	};
});

jest.mock("@/components/PrimaryButton", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		PrimaryButton: ({
			onPress,
			testID,
			disabled,
			loading,
		}: {
			onPress?: () => void;
			testID?: string;
			disabled?: boolean;
			loading?: boolean;
		}) => ReactActual.createElement(RNView, { testID, onPress, disabled: !!disabled, loading: !!loading }),
	};
});

import React, { act } from "react";
import { Text } from "react-native";
import TestRenderer from "react-test-renderer";
import type { MyDishPin } from "@shared/api/v1/res";
import { MyDishesMapView } from "./MyDishesMapView";
import { selectFilterQueryKey, useMyDishesFilterStore } from "../stores/useMyDishesFilterStore";
import { useMyDishesViewportStore } from "../stores/useMyDishesViewportStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPin = {
	restaurant: {
		id: "restaurant-1",
		name: "テスト食堂",
		latitude: 35.5,
		longitude: 139.5,
		image_url: "https://example.com/restaurant.jpg",
	},
	counts: { want: 1, eaten: 2 },
	latestOccurredAt: "2026-08-01T00:00:00.000Z",
	representativeThumbnailUrl: null,
} as unknown as MyDishPin;

const mockUseMyDishesMapPinsQuery = jest.fn();
jest.mock("../hooks/useMyDishesMapPinsQuery", () => ({
	useMyDishesMapPinsQuery: () => mockUseMyDishesMapPinsQuery(),
}));

// #1396 M-2: `useMyDishesFilterStore` の `area` を新たに subscribe するようになったため、
// テストツリーを unmount せずに残すと、後続テストの `reset()` / `commitArea()` で
// «前のテストの mount 済みツリー» まで再レンダーされ、共有の `pinPresses` 等へ
// 意図しない値が混ざる（Jest の afterEach で必ず unmount する）。
const mountedTrees: TestRenderer.ReactTestRenderer[] = [];
const render = async (): Promise<TestRenderer.ReactTestRenderer> => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(<MyDishesMapView />);
	});
	mountedTrees.push(tree);
	return tree;
};

beforeEach(() => {
	useMyDishesFilterStore.getState().reset();
	mockPush.mockClear();
	regionChangeHandler = undefined;
	mapReadyHandler = undefined;
	mockAnimateToRegion.mockClear();
	// #1375（5 巡目）viewport の保持はテスト間で漏らさない
	useMyDishesViewportStore.getState().reset();
	pinPresses.length = 0;
	clusterPresses.length = 0;
	pinUris.length = 0;
	pinBubbleContents.length = 0;
	sheetPinLists.length = 0;
	mockAnimateToRegion.mockClear();
	mockGetCurrentLocationPosition.mockReset();
	mockGetCurrentLocationPosition.mockImplementation(() => Promise.reject(new Error("denied")));
	mockUseMyDishesMapPinsQuery.mockReturnValue({
		pins: [],
		queryKey: "default",
		isLoading: false,
		error: null,
		hasFetchedInitial: true,
		truncated: false,
		refresh: jest.fn(),
	});
});

afterEach(async () => {
	await act(async () => {
		mountedTrees.splice(0).forEach((tree) => tree.unmount());
	});
});

describe("#1396 viewport（pan/zoom）は filter store に一切触れない（設計書 (2/2) §3-2）", () => {
	it("onRegionChangeComplete を何度呼んでも filter の参照・queryKey が変わらない（= store への set() が起きていない）", async () => {
		await render();
		expect(regionChangeHandler).toBeDefined();

		const filterBefore = useMyDishesFilterStore.getState().filter;
		const queryKeyBefore = selectFilterQueryKey(useMyDishesFilterStore.getState());

		act(() => {
			regionChangeHandler?.({ latitude: 10, longitude: 20, latitudeDelta: 0.01, longitudeDelta: 0.01 });
			regionChangeHandler?.({ latitude: 11, longitude: 21, latitudeDelta: 0.05, longitudeDelta: 0.05 });
			regionChangeHandler?.({ latitude: 60, longitude: -30, latitudeDelta: 10, longitudeDelta: 10 });
		});

		// zustand の set() は新しいオブジェクトを作る。参照が同じ = 一度も set() されていない
		expect(useMyDishesFilterStore.getState().filter).toBe(filterBefore);
		expect(selectFilterQueryKey(useMyDishesFilterStore.getState())).toBe(queryKeyBefore);
		expect(useMyDishesFilterStore.getState().filter.area).toBeNull();
	});

	it("「このエリアで再検索」の押下時だけ、直近の pan 位置で commitArea が呼ばれる", async () => {
		const tree = await render();

		act(() => {
			// このエリアで再検索が有効になるズームレベルまで寄せる（M-2 の disabled と両立させる）
			regionChangeHandler?.({ latitude: 35.5, longitude: 139.5, latitudeDelta: 0.02, longitudeDelta: 0.02 });
		});
		// pan しただけではまだ area は確定していない
		expect(useMyDishesFilterStore.getState().filter.area).toBeNull();

		const button = tree.root.find((node) => node.props?.testID === "my-dishes-search-this-area");
		await act(async () => {
			button.props.onPress?.();
		});

		const area = useMyDishesFilterStore.getState().filter.area;
		expect(area).not.toBeNull();
		expect(area?.lat).toBe(35.5);
		expect(area?.lng).toBe(139.5);
	});
});

/**
 * #1397 (PR3/5) ピンタップの差し替え。#1396 の時点では店舗詳細ルートへ push していたが、
 * `MyDishPin` が `dish_media.id` を 1 つも持たないため全画面 Feed へは直行できない
 * （設計 (1/2) §0-1 / リーダー判断 Q1）。**ピンタップは常に Sheet を開く**で確定している。
 *
 * 店舗詳細への導線は Sheet のヘッダ（店名タップ）へ移った（Q6）ので、ここから push は起きない。
 */
// #1375 実機確認: ピンタップは Dish Feed へ push する。
// 以前は Map の内部 state で Sheet を開いていたが、Map の上に別の一覧が重なる形だった。
// Feed へ行けば «縦 = その店舗の記録» になり、閉じれば Map がそのまま残る。
describe("#1375 ピンタップは Dish Feed（restaurant スコープ）へ遷移する", () => {
	const pinsResult = () => ({
		pins: [mockPin],
		queryKey: "default",
		isLoading: false,
		error: null,
		hasFetchedInitial: true,
		truncated: false,
		refresh: jest.fn(),
	});

	it("ピン押下で feed へ push される", async () => {
		mockUseMyDishesMapPinsQuery.mockReturnValue(pinsResult());
		await render();

		// #1375 G2: 現在地の判定（getCurrentLocationPosition）が決着すると再描画が 1 回増えるため、
		// «何回描かれたか» ではなく «最後に描かれたピンを押したら遷移するか» で見る。
		// pinPresses はマーカーのモックが描画ごとに push する累積配列である
		expect(pinPresses.length).toBeGreaterThanOrEqual(1);
		act(() => {
			pinPresses[pinPresses.length - 1]();
		});

		expect(mockPush).toHaveBeenCalledWith(
			expect.objectContaining({
				pathname: "/[locale]/(tabs)/my-dishes/feed",
				params: expect.objectContaining({ scope: "restaurant", restaurantId: mockPin.restaurant.id }),
			}),
		);
	});

	it("下部シートは常設で、いま出ているピンがそのまま渡る", async () => {
		mockUseMyDishesMapPinsQuery.mockReturnValue(pinsResult());
		const tree = await render();

		// ピンを押さなくても出ている（＝常設）
		expect(sheetPinLists.at(-1)).toEqual([mockPin]);
		expect(tree.root.findAll((node) => node.props?.testID === "my-dishes-map-sheet").length).toBeGreaterThan(0);
	});

	// ⚠️ #1397 §7-1 の不変条件。押下先が Sheet から Feed へ変わっても、
	// 共有フィルタに店舗 id を混ぜてはいけない（混ぜると一覧・Map まで 1 店舗に絞られる）
	it("ピンを押しても共有フィルタ（filter）のオブジェクト参照と queryKey が変わらない", async () => {
		mockUseMyDishesMapPinsQuery.mockReturnValue(pinsResult());
		await render();

		const filterBefore = useMyDishesFilterStore.getState().filter;
		const queryKeyBefore = selectFilterQueryKey(useMyDishesFilterStore.getState());

		act(() => {
			pinPresses[0]();
		});

		expect(useMyDishesFilterStore.getState().filter).toBe(filterBefore);
		expect(selectFilterQueryKey(useMyDishesFilterStore.getState())).toBe(queryKeyBefore);
		expect(useMyDishesFilterStore.getState().filter).not.toHaveProperty("restaurantId");
	});
});

describe("#1396 M-1 取得失敗時にエラー表示と再試行ボタンが出る", () => {
	it("error !== null && hasFetchedInitial === false でもエラー文言と再試行ボタンが出る", async () => {
		const mockRefresh = jest.fn();
		mockUseMyDishesMapPinsQuery.mockReturnValue({
			pins: [],
			queryKey: "default",
			isLoading: false,
			error: "boom",
			hasFetchedInitial: false,
			truncated: false,
			refresh: mockRefresh,
		});
		const tree = await render();

		const empties = tree.root.findAll((node) => node.props?.testID === "my-dishes-map-empty");
		expect(empties.length).toBeGreaterThan(0);
		const overlays = tree.root.findAll((node) => node.props?.testID === "my-dishes-map-empty-overlay");
		expect(overlays[0].props.pointerEvents).toBe("auto");

		const texts = tree.root.findAll((node) => node.type === Text && node.props.children === "boom");
		expect(texts.length).toBeGreaterThan(0);

		const retryButtons = tree.root.findAll((node) => node.props?.testID === "my-dishes-map-empty-retry");
		expect(retryButtons.length).toBeGreaterThan(0);
	});

	it("再試行ボタン押下で refresh（= fetchPins の再実行）が呼ばれる", async () => {
		const mockRefresh = jest.fn();
		mockUseMyDishesMapPinsQuery.mockReturnValue({
			pins: [],
			queryKey: "default",
			isLoading: false,
			error: "boom",
			hasFetchedInitial: false,
			truncated: false,
			refresh: mockRefresh,
		});
		const tree = await render();

		const retryButtons = tree.root.findAll((node) => node.props?.testID === "my-dishes-map-empty-retry");
		await act(async () => {
			retryButtons[0].props.onPress?.();
		});

		expect(mockRefresh).toHaveBeenCalledTimes(1);
	});

	it("取得成功後（pins 0 件）は従来どおり EmptyState が出る", async () => {
		mockUseMyDishesMapPinsQuery.mockReturnValue({
			pins: [],
			queryKey: "default",
			isLoading: false,
			error: null,
			hasFetchedInitial: true,
			truncated: false,
			refresh: jest.fn(),
		});
		const tree = await render();

		const empties = tree.root.findAll((node) => node.props?.testID === "my-dishes-map-empty");
		expect(empties.length).toBeGreaterThan(0);
		const overlays = tree.root.findAll((node) => node.props?.testID === "my-dishes-map-empty-overlay");
		expect(overlays[0].props.pointerEvents).toBe("none");
	});

	it("取得中（isLoading）は hasFetchedInitial の成否に関わらず EmptyState を出さない", async () => {
		mockUseMyDishesMapPinsQuery.mockReturnValue({
			pins: [],
			queryKey: "default",
			isLoading: true,
			error: null,
			hasFetchedInitial: false,
			truncated: false,
			refresh: jest.fn(),
		});
		const tree = await render();

		expect(tree.root.findAll((node) => node.props?.testID === "my-dishes-map-empty").length).toBe(0);
	});
});

/**
 * #1396 n-1: 「このエリアで再検索」ボタンのローディング表示が、初回失敗後の再取得（hasFetchedInitial
 * === false）と、一度成功した後の再取得（hasFetchedInitial === true）とで非対称だった。
 * error が立っている（＝再試行中）場合も含めて対称にする。
 */
describe("#1396 n-1 「このエリアで再検索」ボタンのローディング表示の対称性", () => {
	it("初回取得中（error なし・hasFetchedInitial なし）はボタンにスピナーを出さない（全画面ローディングを使う）", async () => {
		mockUseMyDishesMapPinsQuery.mockReturnValue({
			pins: [],
			queryKey: "default",
			isLoading: true,
			error: null,
			hasFetchedInitial: false,
			truncated: false,
			refresh: jest.fn(),
		});
		const tree = await render();

		const button = tree.root.find((node) => node.props?.testID === "my-dishes-search-this-area");
		expect(button.props.loading).toBe(false);
	});

	it("失敗後の再取得中（error あり・hasFetchedInitial なし）はボタンにスピナーを出す", async () => {
		mockUseMyDishesMapPinsQuery.mockReturnValue({
			pins: [],
			queryKey: "default",
			isLoading: true,
			error: "boom",
			hasFetchedInitial: false,
			truncated: false,
			refresh: jest.fn(),
		});
		const tree = await render();

		const button = tree.root.find((node) => node.props?.testID === "my-dishes-search-this-area");
		expect(button.props.loading).toBe(true);
	});

	it("成功後の再取得中（hasFetchedInitial あり）はボタンにスピナーを出す", async () => {
		mockUseMyDishesMapPinsQuery.mockReturnValue({
			pins: [],
			queryKey: "default",
			isLoading: true,
			error: null,
			hasFetchedInitial: true,
			truncated: false,
			refresh: jest.fn(),
		});
		const tree = await render();

		const button = tree.root.find((node) => node.props?.testID === "my-dishes-search-this-area");
		expect(button.props.loading).toBe(true);
	});
});

/**
 * #1375 実機確認（2 巡目）: 「ズームインしてから…」の無効化・ヒントは廃止した。
 * 広すぎる表示域では `regionToArea` が MAX_AREA_RADIUS_M（50km）へ黙って丸める。
 * ここでは «どのズームでも押せる» ことと «ヒントが出ない» ことを固定する（戻したら失敗する）。
 */
describe("#1375 「このエリアで再検索」はどのズームでも押せる", () => {
	it("既定 viewport（日本全体）でもボタンは押せて、ヒントは出ない", async () => {
		const tree = await render();

		const button = tree.root.find((node) => node.props?.testID === "my-dishes-search-this-area");
		expect(button.props.disabled).toBeFalsy();
		expect(tree.root.findAll((node) => node.props?.testID === "my-dishes-map-zoom-hint").length).toBe(0);
	});

	it("押すと 50km へ clamp されたエリアが確定する", async () => {
		const tree = await render();

		const button = tree.root.find((node) => node.props?.testID === "my-dishes-search-this-area");
		await act(async () => {
			button.props.onPress();
		});

		const area = useMyDishesFilterStore.getState().filter.area;
		expect(area).not.toBeNull();
		expect(area!.radius).toBeLessThanOrEqual(50_000);
	});
});

/**
 * #1375 実機確認: 「このエリアで絞り込み中」の帯は Map から廃止した。
 *
 * 地図は «いま見えている範囲» そのものが絞り込み範囲なので、それを文字で言い直す帯は
 * 地図を隠すだけの重複だった。エリアの表示と解除はフィルタ画面に集約してある。
 * ここでは «エリアが確定していても Map に帯を出さない» ことを固定する（戻したら失敗する）。
 */
describe("#1375 エリアの帯は Map に出さない", () => {
	it("area が確定していても、帯も解除ボタンも Map 上に無い", async () => {
		useMyDishesFilterStore.getState().commitArea({ lat: 35.5, lng: 139.5, radius: 5000 });
		const tree = await render();

		expect(tree.root.findAll((node) => node.props?.testID === "my-dishes-map-area-active").length).toBe(0);
		expect(tree.root.findAll((node) => node.props?.testID === "my-dishes-map-area-clear").length).toBe(0);
	});
});

/**
 * #1396 M-3: web 版共用 `MapView.web.tsx` は `initialRegion`（uncontrolled）を読まないため、
 * `onMapReady` 後に `mapRef.animateToRegion` で明示的に補正する（先例: select-restaurant.tsx /
 * DishMediaMap.tsx）。共用コンポーネント自体は変更しない。
 */
describe("#1396 M-3 mapReady 後に initialRegion へ animateToRegion で補正する", () => {
	// #1375（9 巡目）現在地が取れないときは «日本全体» へ寄せるようになったので、
	// mapReady を待たずに 1 回動く。それでも `pendingRegionRef` は残るので、
	// web（initialRegion を読まない）でも mapReady 後に同じ場所へ補正される
	it("mapReady 後、日本全体（REGION_JP）へ補正する", async () => {
		await render();

		const before = mockAnimateToRegion.mock.calls.length;
		act(() => {
			mapReadyHandler?.();
		});

		expect(mockAnimateToRegion.mock.calls.length).toBe(before + 1);
		const [region] = mockAnimateToRegion.mock.calls[mockAnimateToRegion.mock.calls.length - 1];
		expect(region.latitude).toBeCloseTo(36.2048);
		expect(region.longitude).toBeCloseTo(138.2529);

		// 二度呼んでも再度は animate しない（pendingRegionRef を使い切ったら null に戻す）
		act(() => {
			mapReadyHandler?.();
		});
		expect(mockAnimateToRegion.mock.calls.length).toBe(before + 1);
	});
});

/**
 * #1396 m-1: エリア未確定だと全世界のピンが返るため、初回取得後に一度だけピンの外接矩形へ
 * `animateToRegion` で寄せる。§3-2 の不変条件（store を書かない・再取得を起こさない）を壊さず、
 * 二度目以降の取得では発火しないことを固定する。
 */
describe("#1396 m-1 初回取得後に一度だけピンへ viewport を寄せる", () => {
	/*
	#1375（9 巡目・オーナー指示）**ピンの外接矩形へは寄せない。**

	「初期は現在地周辺、位置情報拒否なら日本地図」という指示により、取得したピンの
	外接矩形へ寄せる挙動は無くした。取得の完了を待って地図が動くため «開いた直後に
	勝手に動く» ように見えていた、という理由もある。
	*/
	it("ピンがあっても外接矩形へは寄せず、日本全体（REGION_JP）へ寄せる", async () => {
		mockUseMyDishesMapPinsQuery.mockReturnValue({
			pins: [mockPin],
			queryKey: "default",
			isLoading: false,
			error: null,
			hasFetchedInitial: true,
			truncated: false,
			refresh: jest.fn(),
		});
		await render();

		expect(mockAnimateToRegion).toHaveBeenCalledTimes(1);
		const [region] = mockAnimateToRegion.mock.calls[0];
		expect(region.latitude).toBeCloseTo(36.2048);
		expect(region.longitude).toBeCloseTo(138.2529);
	});

	/**
	 * #1397 絶対条件3: Sheet の開閉で `hasFitPinsRef` の «一度きり» のフィットが再発火しないこと。
	 *
	 * Sheet をルートにすると（§9-1 が避けた形）Map が push/pop で再マウントされ、ref が初期化されて
	 * 二度目のフィットが走る。内部 state で開閉している限り、再レンダーは起きても ref は残る。
	 */
	it("Sheet を開いて閉じても animateToRegion は増えない（内部 state なので Map は再マウントしない）", async () => {
		mockUseMyDishesMapPinsQuery.mockReturnValue({
			pins: [mockPin],
			queryKey: "default",
			isLoading: false,
			error: null,
			hasFetchedInitial: true,
			truncated: false,
			refresh: jest.fn(),
		});
		await render();
		expect(mockAnimateToRegion).toHaveBeenCalledTimes(1);

		act(() => {
			pinPresses[0]();
		});
		expect(mockAnimateToRegion).toHaveBeenCalledTimes(1);

		// もう一度押しても同じ（Sheet の開閉ではなく push になったが、
		// «ピン押下では viewport を触らない» という不変条件は変わらない）
		act(() => {
			pinPresses[0]();
		});
		expect(mockAnimateToRegion).toHaveBeenCalledTimes(1);
	});

	it("pins が 0 件でも日本全体へは寄せる（ピンの有無で初期表示を変えない）", async () => {
		await render();
		expect(mockAnimateToRegion).toHaveBeenCalledTimes(1);
		const [region] = mockAnimateToRegion.mock.calls[0];
		expect(region.latitude).toBeCloseTo(36.2048);
	});

	it("二度目以降の取得（queryKey 変更後の再取得）では発火せず、filter store にも触れない", async () => {
		mockUseMyDishesMapPinsQuery.mockReturnValue({
			pins: [mockPin],
			queryKey: "default",
			isLoading: false,
			error: null,
			hasFetchedInitial: true,
			truncated: false,
			refresh: jest.fn(),
		});
		const tree = await render();
		expect(mockAnimateToRegion).toHaveBeenCalledTimes(1);

		const otherPin = {
			...mockPin,
			restaurant: { ...mockPin.restaurant, id: "restaurant-2", latitude: 10, longitude: 20 },
		} as unknown as MyDishPin;

		// 「このエリアで再検索」で queryKey が変わり、新しいキーの初回取得が始まって完了する様子を模す
		await act(async () => {
			mockUseMyDishesMapPinsQuery.mockReturnValue({
				pins: [],
				queryKey: "area=1",
				isLoading: true,
				error: null,
				hasFetchedInitial: false,
				truncated: false,
				refresh: jest.fn(),
			});
			tree.update(<MyDishesMapView />);
		});
		await act(async () => {
			mockUseMyDishesMapPinsQuery.mockReturnValue({
				pins: [otherPin],
				queryKey: "area=1",
				isLoading: false,
				error: null,
				hasFetchedInitial: true,
				truncated: false,
				refresh: jest.fn(),
			});
			tree.update(<MyDishesMapView />);
		});

		expect(mockAnimateToRegion).toHaveBeenCalledTimes(1);
		expect(useMyDishesFilterStore.getState().filter.area).toBeNull();
	});

	// #1375 独立レビュー（仕様ギャップ G2）: 仕様 §7「位置情報が利用可能なら現在地周辺を初期表示」
	it("現在地が取れたらその周辺へ寄せ、取れなければ従来のフォールバック（ピンの外接矩形）のままにする", async () => {
		mockGetCurrentLocationPosition.mockImplementationOnce(() =>
			Promise.resolve({ latitude: 35.6595, longitude: 139.7005 } as never),
		);
		mockUseMyDishesMapPinsQuery.mockReturnValue({
			pins: [mockPin],
			isLoading: false,
			error: null,
			hasFetchedInitial: true,
			truncated: false,
			refresh: jest.fn(),
		});

		await render();

		const centered = mockAnimateToRegion.mock.calls.find(
			([region]) => Math.abs((region as { latitude: number }).latitude - 35.6595) < 1e-6,
		);
		expect(centered).toBeDefined();
		// 現在地が取れたときは «日本全体» へは寄せない（現在地の方が仕様上の優先）
		const fitToJapan = mockAnimateToRegion.mock.calls.find(
			([region]) => Math.abs((region as { latitude: number }).latitude - 36.2048) < 1e-3,
		);
		expect(fitToJapan).toBeUndefined();
	});

	// #1375（9 巡目・オーナー指示）「位置情報拒否なら日本地図」
	it("現在地が取れない（権限拒否）ときは日本全体へ寄せる", async () => {
		mockUseMyDishesMapPinsQuery.mockReturnValue({
			pins: [mockPin],
			isLoading: false,
			error: null,
			hasFetchedInitial: true,
			truncated: false,
			refresh: jest.fn(),
		});

		await render();

		const fitToJapan = mockAnimateToRegion.mock.calls.find(
			([region]) => Math.abs((region as { latitude: number }).latitude - 36.2048) < 1e-3,
		);
		expect(fitToJapan).toBeDefined();
		// 外接矩形（ピンの中心 35.5）へは寄せない
		const fitToPins = mockAnimateToRegion.mock.calls.find(
			([region]) => Math.abs((region as { latitude: number }).latitude - 35.5) < 1e-6,
		);
		expect(fitToPins).toBeUndefined();
	});

	// #1375 実機確認（5 巡目）: 拡大 → リスト → Map と戻ると全国まで引かれてしまう
	it("人が動かした表示域は、次に開いたときも保たれる（現在地にもピンの外接矩形にも奪われない）", async () => {
		mockUseMyDishesMapPinsQuery.mockReturnValue({
			pins: [mockPin],
			isLoading: false,
			error: null,
			hasFetchedInitial: true,
			truncated: false,
			refresh: jest.fn(),
		});

		// 1 回目: 開いて拡大する（onRegionChangeComplete が人の操作として届く）
		await render();
		const zoomed = { latitude: 35.6812, longitude: 139.7671, latitudeDelta: 0.01, longitudeDelta: 0.01 };
		act(() => {
			regionChangeHandler?.(zoomed);
		});

		// 2 回目: いったん閉じて開き直す（リストへ行って戻る操作に相当）
		await act(async () => {
			mountedTrees.splice(0).forEach((tree) => tree.unmount());
		});
		mockAnimateToRegion.mockClear();
		mockGetCurrentLocationPosition.mockImplementationOnce(() =>
			Promise.resolve({ latitude: 35.6595, longitude: 139.7005 } as never),
		);
		await render();

		// 拡大した表示域へ戻っていること
		const restored = mockAnimateToRegion.mock.calls.find(
			([region]) => Math.abs((region as { latitudeDelta: number }).latitudeDelta - 0.01) < 1e-6,
		);
		expect(restored).toBeDefined();
		// 現在地にもピンの外接矩形にも動かされていないこと
		const stolen = mockAnimateToRegion.mock.calls.find(([region]) => {
			const lat = (region as { latitude: number }).latitude;
			return Math.abs(lat - 35.6595) < 1e-6 || Math.abs(lat - 35.5) < 1e-6;
		});
		expect(stolen).toBeUndefined();
	});
});

/*
#1375 実機確認（5 巡目）「Map のクラスタリングはやってほしい」。

近すぎるピンは 1 つの丸へ畳み、押すと中のピンの外接矩形へ寄る（= もう一段ほどく）。
畳む粒度は **指を離したときの表示域**で決める（pan 追従は重く、ピンが動いて見える）。
*/
/*
#1513 «自分の投稿が削除済み» のピン（`isOwnMediaDeleted`）。

ピンは残す（店舗ごとの記録が消えたわけではない）。ただし写真は
`restaurant.image_url` へも落とさず、吹き出しの中身を墓標へ差し替える。
落としてしまうと「自分が消した写真の跡地に別の絵」になり、消えたことが伝わらない。
*/
describe("#1513 削除済みのピンは墓標になる（ピン自体は消さない）", () => {
	const pinsResult = (pins: MyDishPin[]) => ({
		pins,
		queryKey: "default",
		isLoading: false,
		error: null,
		hasFetchedInitial: true,
		truncated: false,
		refresh: jest.fn(),
	});

	it("isOwnMediaDeleted なら uri を渡さず、墓標（bubbleContent）を渡す", async () => {
		mockUseMyDishesMapPinsQuery.mockReturnValue(
			pinsResult([
				{
					...mockPin,
					representativeThumbnailUrl: null,
					isOwnMediaDeleted: true,
				} as unknown as MyDishPin,
			]),
		);
		const tree = await render();

		// restaurant.image_url（mockPin にある）へ落ちていないこと。
		// ⚠️ マーカーは mapReady の補正で 2 回描かれるので «全ての描画で» を見る（件数で数えない）
		expect(pinUris.every((uri) => uri === undefined)).toBe(true);
		expect(pinBubbleContents.filter(Boolean).length).toBeGreaterThan(0);
		// ピンは消えない
		expect(tree.root.findAll((node) => node.props?.testID === "my-dishes-map-pin").length).toBeGreaterThan(0);
	});

	it("削除されていないピンは従来どおり画像を渡す（bubbleContent は渡さない）", async () => {
		mockUseMyDishesMapPinsQuery.mockReturnValue(
			pinsResult([{ ...mockPin, isOwnMediaDeleted: false } as unknown as MyDishPin]),
		);
		await render();

		expect(pinUris.every((uri) => uri === "https://example.com/restaurant.jpg")).toBe(true);
		expect(pinUris.length).toBeGreaterThan(0);
		expect(pinBubbleContents.filter(Boolean)).toHaveLength(0);
	});
});

describe("#1375 Map のクラスタリング", () => {
	const nearbyPin = {
		...mockPin,
		restaurant: { ...mockPin.restaurant, id: "restaurant-2", name: "隣の食堂", latitude: 35.5001, longitude: 139.5001 },
	};
	const farPin = {
		...mockPin,
		restaurant: { ...mockPin.restaurant, id: "restaurant-3", name: "遠くの食堂", latitude: 35.9, longitude: 139.9 },
	};
	const result = (pins: unknown[]) => ({
		pins,
		queryKey: "default",
		isLoading: false,
		error: null,
		hasFetchedInitial: true,
		truncated: false,
		refresh: jest.fn(),
	});

	it("近い 2 件は丸 1 つに畳まれ、離れた 1 件は写真のピンのまま残る", async () => {
		mockUseMyDishesMapPinsQuery.mockReturnValue(result([mockPin, nearbyPin, farPin]));
		const tree = await render();
		// 初期表示は日本全体（REGION_JP）なので 3 件とも «近い»。
		// 人が寄せたところから判定する（クラスタの粒度は指を離した表示域で決まる）
		act(() => {
			regionChangeHandler?.({ latitude: 35.5, longitude: 139.5, latitudeDelta: 0.05, longitudeDelta: 0.05 });
		});

		const clusters = tree.root.findAll(
			(node) => typeof node.type === "string" && node.props?.testID === "my-dishes-map-cluster",
		);
		expect(clusters).toHaveLength(1);
		// 畳んだ 2 件ぶんの数字が出る
		const texts = clusters[0].findAllByType("Text" as never).flatMap((n) => n.props.children);
		expect(texts).toContain(2);
	});

	it("クラスタを押すと中のピンの範囲へ寄る（Feed へは行かない）", async () => {
		mockUseMyDishesMapPinsQuery.mockReturnValue(result([mockPin, nearbyPin]));
		await render();
		act(() => {
			regionChangeHandler?.({ latitude: 35.5, longitude: 139.5, latitudeDelta: 0.05, longitudeDelta: 0.05 });
		});

		expect(clusterPresses.length).toBeGreaterThanOrEqual(1);
		mockAnimateToRegion.mockClear();
		act(() => {
			clusterPresses[clusterPresses.length - 1]();
		});

		expect(mockAnimateToRegion).toHaveBeenCalled();
		const [region] = mockAnimateToRegion.mock.calls[mockAnimateToRegion.mock.calls.length - 1];
		expect(region.latitude).toBeCloseTo(35.50005, 4);
		// クラスタ押下は «ほどく» 操作であって記録を開く操作ではない
		expect(mockPush).not.toHaveBeenCalled();
	});
});

/*
#1375（実機: 「マップから絞り込む画面がすごくクラッシュする」）

**地図に出るものと、下の帯に並ぶものを一致させる。**

表示域の外のピンをマーカーにしない間引きを入れた結果、
「取得した全件」と「地図に見えているもの」が食い違うようになった。
下の帯の責務は «いま Map に出ているピンを横に並べる» なので、
揃えないと **帯には居るのに地図にピンが無い**（件数の見出しもずれる）。
*/
describe("地図に出ているピンと下部シートの一致", () => {
	const pinAt = (id: string, latitude: number, longitude: number) =>
		({
			restaurant: { id, name: id, latitude, longitude, image_url: null },
			counts: { want: 0, eaten: 1 },
			latestOccurredAt: "2026-08-01T00:00:00.000Z",
			representativeThumbnailUrl: null,
		}) as unknown as MyDishPin;

	it("表示域の外のピンは、地図にも下部シートにも出さない", async () => {
		const near = pinAt("near", 35.68, 139.76);
		const hokkaido = pinAt("hokkaido", 43.06, 141.35);
		mockUseMyDishesMapPinsQuery.mockReturnValue({
			pins: [near, hokkaido],
			queryKey: "q",
			isLoading: false,
			error: null,
			hasFetchedInitial: true,
			truncated: false,
			refresh: jest.fn(),
		});

		await render();
		// 指を離した（＝表示域が確定した）ことにする。東京駅あたりを 0.05 度ぶん
		await act(async () => {
			regionChangeHandler?.({ latitude: 35.68, longitude: 139.76, latitudeDelta: 0.05, longitudeDelta: 0.05 });
		});

		const lastSheetPins = sheetPinLists[sheetPinLists.length - 1] as MyDishPin[];
		expect(lastSheetPins.map((p) => p.restaurant.id)).toEqual(["near"]);
	});
});

/*
#1375（9 巡目・オーナー指摘）**マップに現在地ボタン。**

初期表示は現在地に寄せているが、地図を動かしたあと現在地へ戻る手段が無かった。
（«このエリアで再検索» は範囲を変えずに引き直すだけ）

押したときの 4 点セット（表示域 ref / 保存 / クラスタ倍率 / 地図の移動）が揃っていないと、
地図と «いま見えている範囲» の認識がずれる。ここでは «地図が現在地へ動くこと» と
«次に開いたときのために保存されること» を固定する。
*/
describe("#1375 現在地ボタン", () => {
	it("押すと現在地へ寄せ、表示域として保存する", async () => {
		mockGetCurrentLocationPosition.mockReset();
		mockGetCurrentLocationPosition.mockImplementation(() =>
			Promise.resolve({ latitude: 34.7025, longitude: 135.4959 } as never),
		);
		const tree = await render();
		mockAnimateToRegion.mockClear();

		const button = tree.root.find((node) => node.props?.testID === "my-dishes-map-current-location");
		await act(async () => {
			await button.props.onPress();
		});

		const moved = mockAnimateToRegion.mock.calls.find(
			([region]) => Math.abs((region as { latitude: number }).latitude - 34.7025) < 1e-6,
		);
		expect(moved).toBeDefined();
		expect(useMyDishesViewportStore.getState().region?.latitude).toBeCloseTo(34.7025);
	});

	// 位置情報が取れなくても «押しても何も起きない» で済ませる（この画面は位置情報を必須にしていない）
	it("現在地が取れなくても落ちない", async () => {
		const tree = await render();
		mockAnimateToRegion.mockClear();

		const button = tree.root.find((node) => node.props?.testID === "my-dishes-map-current-location");
		await act(async () => {
			await button.props.onPress();
		});

		expect(mockAnimateToRegion).not.toHaveBeenCalled();
	});
});

/*
#1629【32】オーナー実機報告:
「東京でエリア再検索して、日本地図全体にして再検索すると
 『気になるお店の料理を保存したり…』（= `MyDishes.empty.description`）と出る」。

`MyDishes.empty.description` は «まだ 1 件も記録が無い人» 向けのオンボーディング文言なので、
«絞り込みの結果が 0 件» のときに出してはいけない（本体の showEmpty 付近のコメント参照）。

修正前は 0 件を 1 種類しか持っておらず、下の 3 ケースのうち «エリアあり» と «エリア以外の
絞り込みあり» の 2 つが `MyDishes.empty.description` を出して落ちる。
*/
describe("#1629【32】空状態は «全体で 0 件» と «この範囲・この条件で 0 件» を区別する", () => {
	/** ツリーに描かれた文字列のうち、空状態の i18n キー（i18n はモックでキーをそのまま返す）だけを拾う */
	const emptyKeys = (tree: TestRenderer.ReactTestRenderer): string[] => {
		const found: string[] = [];
		const walk = (node: unknown): void => {
			if (typeof node === "string") {
				if (node.startsWith("MyDishes.empty.")) found.push(node);
				return;
			}
			if (Array.isArray(node)) {
				node.forEach(walk);
				return;
			}
			if (node && typeof node === "object") walk((node as { children?: unknown }).children);
		};
		walk(tree.toJSON());
		return found;
	};

	const renderWithNoPins = async (): Promise<TestRenderer.ReactTestRenderer> => {
		mockUseMyDishesMapPinsQuery.mockReturnValue({
			pins: [],
			queryKey: "default",
			isLoading: false,
			error: null,
			hasFetchedInitial: true,
			truncated: false,
			refresh: jest.fn(),
		});
		return render();
	};

	it("絞り込みが 1 つも無いときだけ、オンボーディング文言を出す", async () => {
		const tree = await renderWithNoPins();

		expect(emptyKeys(tree)).toEqual(["MyDishes.empty.description"]);
	});

	it("エリアで絞ったあとの 0 件では «この範囲に無い» を出す（オンボーディング文言は出さない）", async () => {
		// 「日本地図全体にして再検索」= regionToArea が半径を 50km へ clamp した円が確定した状態
		act(() => {
			useMyDishesFilterStore.getState().commitArea({ lat: 36.2, lng: 138.2, radius: 50_000 });
		});
		const tree = await renderWithNoPins();

		expect(emptyKeys(tree)).toEqual(["MyDishes.empty.noResultsInArea", "MyDishes.empty.noResultsInAreaHint"]);
		expect(emptyKeys(tree)).not.toContain("MyDishes.empty.description");
	});

	it("エリア以外の絞り込みでの 0 件では «条件に合うものが無い» を出す", async () => {
		act(() => {
			useMyDishesFilterStore.getState().patch({ categoryIds: ["ramen"] });
		});
		const tree = await renderWithNoPins();

		expect(emptyKeys(tree)).toEqual(["MyDishes.empty.noResultsForFilter", "MyDishes.empty.noResultsForFilterHint"]);
		expect(emptyKeys(tree)).not.toContain("MyDishes.empty.description");
	});
});
