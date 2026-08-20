/*
#1396 PR4 レビュー M-1 の②（必須）: 「再試行ボタン押下で実際に取得が走る（callBackend が呼ばれる）」
を、フックをモックしない形で固定する。

`MyDishesMapView.test.tsx` は `useMyDishesMapPinsQuery` ごとモックしているため、
`EmptyState` の `onRetry` に渡された `refresh` が「本物の `fetchPins` まで辿り着いて
`callBackend` を呼ぶか」を検証できない（`refresh` がただの `jest.fn()` でも同じテストが通る）。
ここでは `useMyDishesMapPinsQuery` は本物のまま、`useAPICall`（＝ `callBackend`）だけをモックし、
実際に「初回失敗 → EmptyState → 再試行ボタン押下 → callBackend が 2 回目を呼ぶ」を通しで確認する。
*/
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }) }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("expo-router", () => ({
	router: { push: jest.fn() },
	// #1450 M-1: MyDishesRestaurantSheet が useFocusEffect / useNavigation を呼ぶようになったため、
	// このファイルは Sheet をスタブせず実物のまま描画する（実物のまま fetchPins まで届かせたい）ので
	// 最小限のノーオップを足す。挙動そのものは MyDishesRestaurantSheet.test.tsx で見ている
	useFocusEffect: () => {},
	useNavigation: () => ({ addListener: () => () => {} }),
}));

jest.mock("@/components/MapView", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		__esModule: true,
		default: ReactActual.forwardRef(({ children }: { children?: React.ReactNode }, ref: unknown) => {
			ReactActual.useImperativeHandle(ref, () => ({ animateToRegion: jest.fn() }));
			return ReactActual.createElement(RNView, { testID: "map-view" }, children);
		}),
	};
});
jest.mock("react-native-maps", () => ({ __esModule: true, default: () => null }));
jest.mock("@/features/mapMarkers", () => ({ AvatarBubbleMarker: () => null }));

const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));

import React, { act } from "react";
import { Text } from "react-native";
import TestRenderer from "react-test-renderer";
import { MyDishesMapView } from "./MyDishesMapView";
import { useMyDishesFilterStore } from "../stores/useMyDishesFilterStore";
import { useMyDishesStore } from "../stores/useMyDishesStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
	useMyDishesFilterStore.getState().reset();
	useMyDishesStore.getState().clearQuery();
	mockCallBackend.mockClear();
});

describe("#1396 M-1 再試行ボタン押下で実際に取得が走る", () => {
	it("初回失敗 → EmptyState の再試行ボタン押下 → callBackend が再び呼ばれる（refresh が本物の fetchPins まで届く）", async () => {
		mockCallBackend.mockRejectedValueOnce(new Error("boom"));

		let tree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			tree = TestRenderer.create(<MyDishesMapView />);
		});

		// 初回取得が失敗している（M-1 が固定した前提）
		expect(mockCallBackend).toHaveBeenCalledTimes(1);

		const retryButtons = tree.root.findAll((node) => node.props?.testID === "my-dishes-map-empty-retry");
		expect(retryButtons.length).toBeGreaterThan(0);

		mockCallBackend.mockResolvedValueOnce({ data: [], truncated: false });
		await act(async () => {
			retryButtons[0].props.onPress?.();
		});

		// 再試行ボタンから本物の fetchPins まで届き、callBackend が再度呼ばれた
		expect(mockCallBackend).toHaveBeenCalledTimes(2);
		expect(mockCallBackend).toHaveBeenNthCalledWith(
			2,
			"v1/users/me/dishes/map-pins",
			expect.objectContaining({ method: "GET" }),
		);

		// 再試行の結果 EmptyState は消える（0 件だが hasFetchedInitial は立つので pins.length===0 の
		// showEmpty 分岐に入るが、少なくとも error は消えていることを確認する）
		const errorTexts = tree.root.findAll((node) => node.type === Text && node.props.children === "boom");
		expect(errorTexts).toHaveLength(0);

		await act(async () => {
			tree.unmount();
		});
	});
});
