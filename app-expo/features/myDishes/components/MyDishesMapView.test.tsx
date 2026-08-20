/*
#1396 PR4 の中核テスト（設計書 (2/2) §3-2 / §8-4 リスク2）。

Map の pan/zoom（`onRegionChangeComplete`）は `MyDishesMapView` 内の `useRef` へ書くだけで、
`useMyDishesFilterStore` には**一切触れない**こと。ここを破ると pan のたびに `queryKey` が
変わり、裏にいるリスト/Calendar が 964MB の `dish_reviews` へ再取得を投げ続ける
（#1395 §0(A): 平均 4.48 秒 / 最大 11.23 秒）。

store（= queryKey）を書くのは「このエリアで再検索」ボタン押下時の `commitArea` だけである
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
				_ref: unknown,
			) => {
				regionChangeHandler = onRegionChangeComplete;
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

jest.mock("@/components/PrimaryButton", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		PrimaryButton: ({ onPress, testID }: { onPress?: () => void; testID?: string }) =>
			ReactActual.createElement(RNView, { testID, onPress }),
	};
});

const mockUseMyDishesMapPinsQuery = jest.fn();
jest.mock("../hooks/useMyDishesMapPinsQuery", () => ({
	useMyDishesMapPinsQuery: () => mockUseMyDishesMapPinsQuery(),
}));

import React, { act } from "react";
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

const render = async (): Promise<TestRenderer.ReactTestRenderer> => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(<MyDishesMapView />);
	});
	return tree;
};

beforeEach(() => {
	useMyDishesFilterStore.getState().reset();
	mockPush.mockClear();
	regionChangeHandler = undefined;
	pinPresses.length = 0;
	pinUris.length = 0;
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

describe("#1396 ピンタップは既存の店舗詳細ルートへ push する（Sheet/Feed は #1397 のスコープ）", () => {
	it("ピン押下で /[locale]/restaurant/[restaurantId] へ push する", async () => {
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

		expect(pinPresses).toHaveLength(1);
		act(() => {
			pinPresses[0]();
		});

		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/restaurant/[restaurantId]",
			params: { locale: "ja-JP", restaurantId: "restaurant-1" },
		});
	});

	it("representativeThumbnailUrl が null のとき restaurant.image_url へ落ちる", async () => {
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

		expect(pinUris).toEqual(["https://example.com/restaurant.jpg"]);
	});
});
