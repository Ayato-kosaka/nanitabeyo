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
	};
});
jest.mock("react-native-maps", () => ({ __esModule: true, default: () => null }));

const pinPresses: Array<() => void> = [];
const pinUris: Array<string | undefined> = [];
jest.mock("@/features/mapMarkers", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		AvatarBubbleMarker: ({ onPress, uri, testID }: { onPress?: () => void; uri?: string; testID?: string }) => {
			if (onPress) pinPresses.push(onPress);
			pinUris.push(uri);
			return ReactActual.createElement(RNView, { testID });
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
	pinPresses.length = 0;
	pinUris.length = 0;
	sheetPinLists.length = 0;
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

		expect(pinPresses).toHaveLength(1);
		act(() => {
			pinPresses[0]();
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
 * #1396 レビュー M-2: 既定 viewport（`REGION_JP` = 日本全体）のまま「このエリアで再検索」を
 * 押すと、`regionToArea` が `MAX_AREA_RADIUS_M`（50km）へ clamp し、ボタンのラベルと実際に
 * 確定する範囲が大きくずれる（東京・大阪の記録が圏外になる）。clamp されるズームレベルでは
 * ボタンを無効化し、ズームを促すヒントを出す。
 */
describe("#1396 M-2 既定 viewport では「このエリアで再検索」を無効化する", () => {
	it("マウント直後（REGION_JP 相当の初期 viewport）はボタンが無効でヒントが出る", async () => {
		const tree = await render();

		const button = tree.root.find((node) => node.props?.testID === "my-dishes-search-this-area");
		expect(button.props.disabled).toBe(true);
		expect(tree.root.findAll((node) => node.props?.testID === "my-dishes-map-zoom-hint").length).toBeGreaterThan(0);
	});

	it("ズームインした region へ pan すると有効化されヒントが消える", async () => {
		const tree = await render();

		act(() => {
			regionChangeHandler?.({ latitude: 35.5, longitude: 139.5, latitudeDelta: 0.02, longitudeDelta: 0.02 });
		});

		const button = tree.root.find((node) => node.props?.testID === "my-dishes-search-this-area");
		expect(button.props.disabled).toBe(false);
		expect(tree.root.findAll((node) => node.props?.testID === "my-dishes-map-zoom-hint").length).toBe(0);
	});

	it("ズームインした後、再びズームアウトすると無効化に戻る", async () => {
		const tree = await render();

		act(() => {
			regionChangeHandler?.({ latitude: 35.5, longitude: 139.5, latitudeDelta: 0.02, longitudeDelta: 0.02 });
		});
		act(() => {
			regionChangeHandler?.({ latitude: 36.2048, longitude: 138.2529, latitudeDelta: 20, longitudeDelta: 20 });
		});

		const button = tree.root.find((node) => node.props?.testID === "my-dishes-search-this-area");
		expect(button.props.disabled).toBe(true);
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
	it("mapReady 前は animateToRegion を呼ばない", async () => {
		await render();
		expect(mockAnimateToRegion).not.toHaveBeenCalled();
	});

	it("mapReady 後、initialRegion（REGION_JP）へ一度だけ animateToRegion する", async () => {
		await render();

		act(() => {
			mapReadyHandler?.();
		});

		expect(mockAnimateToRegion).toHaveBeenCalledTimes(1);
		const [region] = mockAnimateToRegion.mock.calls[0];
		expect(region.latitude).toBeCloseTo(36.2048);
		expect(region.longitude).toBeCloseTo(138.2529);

		// 二度呼んでも再度は animate しない（pendingRegionRef を使い切ったら null に戻す）
		act(() => {
			mapReadyHandler?.();
		});
		expect(mockAnimateToRegion).toHaveBeenCalledTimes(1);
	});
});

/**
 * #1396 m-1: エリア未確定だと全世界のピンが返るため、初回取得後に一度だけピンの外接矩形へ
 * `animateToRegion` で寄せる。§3-2 の不変条件（store を書かない・再取得を起こさない）を壊さず、
 * 二度目以降の取得では発火しないことを固定する。
 */
describe("#1396 m-1 初回取得後に一度だけピンへ viewport を寄せる", () => {
	it("初回取得（pins あり）で一度だけ animateToRegion がピンの外接矩形へ呼ばれる", async () => {
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
		expect(region.latitude).toBeCloseTo(35.5);
		expect(region.longitude).toBeCloseTo(139.5);
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

	it("pins が 0 件の初回取得では animateToRegion を呼ばない", async () => {
		await render();
		expect(mockAnimateToRegion).not.toHaveBeenCalled();
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
});
