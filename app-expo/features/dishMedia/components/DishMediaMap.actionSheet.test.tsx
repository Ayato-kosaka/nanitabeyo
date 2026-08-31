/*
#1742 オーナー実機報告（検索結果マップ / Android）:

> ボトムシートの safearea が効いてない

カードを押して出る ActionSheet の最下行「キャンセル」がナビゲーションバーへ潜っていた。
`@expo/react-native-action-sheet` の Android 実装（`CustomActionSheet`）は
`position: "absolute"` の `bottom: 0` へ貼るだけで safe area を見ないため、
**呼び出し側が `containerStyle` で下余白を渡す以外に直す手が無い**。

ここで固定するのは «渡している» ことではなく «inset ぶんが載っている» こと。
inset 0 と inset あり の 2 回開いて差を測る（余白の考え方は hooks/useSheetBottomPadding.test.tsx と同じ）。

モックの構成は `DishMediaMap.loop.test.tsx` と揃えてある（Map / Carousel / セルは描けないため代役）。
*/
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { ViewStyle } from "react-native";

/** ジェスチャーバー相当の下 inset。テストごとに書き換える（`mock` 接頭辞は jest.mock の制約） */
let mockBottomInset = 0;
jest.mock("react-native-safe-area-context", () => ({
	...jest.requireActual("react-native-safe-area-context/jest/mock").default,
	useSafeAreaInsets: () => ({ top: 24, bottom: mockBottomInset, left: 0, right: 0 }),
}));

jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn(), selectionChanged: jest.fn() }),
}));
jest.mock("@/hooks/useContentWidth", () => ({ useContentWidth: () => 390 }));

/** ActionSheet へ渡されたオプション。containerStyle をここで観測する */
const shownOptions: { containerStyle?: ViewStyle }[] = [];
jest.mock("@expo/react-native-action-sheet", () => ({
	useActionSheet: () => ({
		showActionSheetWithOptions: (options: { containerStyle?: ViewStyle }) => {
			shownOptions.push(options);
		},
	}),
}));

jest.mock("../hooks/useDishMediaActions", () => ({
	useDishMediaActions: () => ({ openInGoogleMaps: jest.fn(), shareRestaurant: jest.fn() }),
}));
jest.mock("@/features/dishMedia/hooks/useDishMediaBackgroundImageResources", () => ({
	useDishMediaBackgroundImageResources: () => ({ getBackgroundImageState: () => ({ status: "idle" }) }),
}));
jest.mock("@/features/mapMarkers", () => ({ AvatarBubbleMarker: () => null }));
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
jest.mock("@/components/PrimaryButton", () => ({ PrimaryButton: () => null }));
jest.mock("@/components/MapView", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		__esModule: true,
		default: ReactActual.forwardRef(({ children }: { children?: React.ReactNode }, ref: unknown) => {
			ReactActual.useImperativeHandle(ref, () => ({ animateToRegion: jest.fn() }));
			return ReactActual.createElement(RNView, null, children);
		}),
	};
});
jest.mock("react-native-gesture-handler", () => {
	const ReactActual = jest.requireActual("react");
	const chain = new Proxy({}, { get: () => () => chain });
	return {
		GestureDetector: ({ children }: { children: React.ReactNode }) =>
			ReactActual.createElement(ReactActual.Fragment, null, children),
		Gesture: { Pan: () => chain },
	};
});

/** セルの代役。カード押下（onCardPress）を testID 付きの押下点として外へ出す */
jest.mock("./DishMediaContent", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		__esModule: true,
		default: ({ id, onCardPress }: { id: string; onCardPress: (entry: unknown) => void }) =>
			ReactActual.createElement(RNView, { testID: `card:${id}`, onPress: onCardPress }),
	};
});

jest.mock("react-native-reanimated-carousel", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		Carousel: ({
			data,
			renderItem,
		}: {
			data: string[];
			renderItem: (params: { item: string; index: number }) => React.ReactNode;
		}) =>
			ReactActual.createElement(
				RNView,
				null,
				data.map((item, index) =>
					ReactActual.createElement(RNView, { key: `cell-${index}` }, renderItem({ item, index })),
				),
			),
	};
});

import DishMediaMap from "./DishMediaMap";
import { useDishMediaEntriesStore, type NormalizedDishMediaEntry } from "@/stores/useDishMediaEntriesStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ENTRIES_KEY = "search-result";
const IDS = ["dm-1", "dm-2", "dm-3"];

const entry = (id: string): NormalizedDishMediaEntry =>
	({
		dish_media: { id, media_type: "image", mediaUrl: `https://example.test/${id}.jpg` },
		restaurant: {
			id: `restaurant-${id}`,
			name: `店 ${id}`,
			latitude: 35.1,
			longitude: 136.9,
			imageUrls: {},
			google_place_id: `place-${id}`,
		},
		dish: { id: `dish-${id}`, name: "料理" },
		dishReviewIds: [],
	}) as unknown as NormalizedDishMediaEntry;

/** カードを 1 枚押して、そのとき ActionSheet に渡された下余白を返す */
function openActionSheetWith(inset: number): number | undefined {
	mockBottomInset = inset;
	shownOptions.length = 0;

	act(() => {
		useDishMediaEntriesStore.setState({
			entriesByMediaId: Object.fromEntries(IDS.map((id) => [id, entry(id)])),
			mediaIdsByKey: { [ENTRIES_KEY]: IDS },
			reviewsByReviewId: {},
			reviewIdsByKey: {},
			deletedIds: {},
			isLoadingByKey: {},
			errorByKey: {},
		} as never);
	});

	let renderer!: ReactTestRenderer;
	act(() => {
		renderer = create(<DishMediaMap entriesKey={ENTRIES_KEY} idType="dish_media" />);
	});
	act(() => {
		renderer.root
			.find((n) => typeof n.type === "string" && n.props?.testID === "card:dm-1")
			.props.onPress(entry("dm-1"));
	});
	const containerStyle = shownOptions.at(-1)?.containerStyle;
	act(() => renderer.unmount());
	return containerStyle?.paddingBottom as number | undefined;
}

describe("#1742 お店提案の ActionSheet はナビゲーションバーへ潜らない", () => {
	afterEach(() => {
		mockBottomInset = 0;
	});

	it("safe area の下 inset ぶんの余白を ActionSheet へ渡す", () => {
		const withoutInset = openActionSheetWith(0);
		const withInset = openActionSheetWith(48);

		expect(withoutInset).toBe(0);
		// 「キャンセル」がバーの上へ持ち上がる量。ここが 0 のままだと実機で潜る
		expect(withInset).toBe(48);
	});
});
