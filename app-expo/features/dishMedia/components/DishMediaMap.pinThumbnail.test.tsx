/*
#1743 オーナー実機報告（2026-08-31・お店提案）:

> お店提案でマップに出てくるピンの画像が、サムネの画像が反映されていない

ここで固定すること: **ピンへ渡る絵は、そのピンに対応するカードのサムネイルである**こと。
店の写真（`restaurant.imageUrls?.sm`）は落とし先であって第一候補ではない。

理由の全文は `DishMediaMap.tsx` の `restaurants` memo の設計コメント。
*/
import React from "react";
import { act, create } from "react-test-renderer";

jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn(), selectionChanged: jest.fn() }),
}));
jest.mock("@/hooks/useContentWidth", () => ({ useContentWidth: () => 390 }));
jest.mock("@expo/react-native-action-sheet", () => ({
	useActionSheet: () => ({ showActionSheetWithOptions: jest.fn() }),
}));
jest.mock("../hooks/useDishMediaActions", () => ({
	useDishMediaActions: () => ({ openInGoogleMaps: jest.fn(), shareRestaurant: jest.fn() }),
}));
jest.mock("@/features/dishMedia/hooks/useDishMediaBackgroundImageResources", () => ({
	useDishMediaBackgroundImageResources: () => ({ getBackgroundImageState: () => ({ status: "idle" }) }),
}));
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
jest.mock("@/components/PrimaryButton", () => ({ PrimaryButton: () => null }));
jest.mock("./DishMediaContent", () => ({ __esModule: true, default: () => null }));

/** ピンが受け取った props を記録する */
const markerProps: { uri?: string }[] = [];
jest.mock("@/features/mapMarkers", () => ({
	AvatarBubbleMarker: (props: { uri?: string }) => {
		markerProps.push(props);
		return null;
	},
}));

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
jest.mock("react-native-reanimated-carousel", () => ({ Carousel: () => null }));

import DishMediaMap from "./DishMediaMap";
import { useDishMediaEntriesStore, type NormalizedDishMediaEntry } from "@/stores/useDishMediaEntriesStore";

const ENTRIES_KEY = "search-result";

const entry = (
	id: string,
	{
		thumbnailImageUrl,
		restaurantImageUrl,
	}: { thumbnailImageUrl: string | null; restaurantImageUrl?: string },
): NormalizedDishMediaEntry =>
	({
		dish_media: { id, media_type: "video", mediaUrl: null, thumbnailImageUrl },
		restaurant: {
			id: `restaurant-${id}`,
			name: `店 ${id}`,
			latitude: 34.7,
			longitude: 135.5,
			imageUrls: restaurantImageUrl ? { sm: restaurantImageUrl, md: restaurantImageUrl } : undefined,
			google_place_id: `place-${id}`,
		},
		dish: { id: `dish-${id}`, name: "料理" },
		dishReviewIds: [],
	}) as unknown as NormalizedDishMediaEntry;

/**
 * ⚠️ 描いた木は必ず片付ける（`afterEach`）。store は全テスト共通なので、
 * 前のテストの木が残っていると次の `setState` でそれも再描画され、
 * `markerProps` に前のテストのピンが混ざる。
 */
let tree: ReturnType<typeof create> | null = null;

function render(entries: Record<string, NormalizedDishMediaEntry>) {
	const ids = Object.keys(entries);
	act(() => {
		useDishMediaEntriesStore.setState({
			entriesByMediaId: entries,
			mediaIdsByKey: { [ENTRIES_KEY]: ids },
			reviewsByReviewId: {},
			reviewIdsByKey: {},
			deletedIds: {},
			isLoadingByKey: {},
			errorByKey: {},
		} as never);
	});
	act(() => {
		tree = create(<DishMediaMap entriesKey={ENTRIES_KEY} idType="dish_media" />);
	});
}

describe("DishMediaMap のピンに渡る絵 (#1743)", () => {
	beforeEach(() => {
		markerProps.length = 0;
	});
	afterEach(() => {
		act(() => {
			tree?.unmount();
		});
		tree = null;
	});

	it("カードのサムネイルをピンへ渡す（店に写真が無くても白い丸にしない）", () => {
		render({
			"media-1": entry("media-1", { thumbnailImageUrl: "https://example.test/thumb-1.jpg" }),
		});
		expect(markerProps.map((props) => props.uri)).toEqual(["https://example.test/thumb-1.jpg"]);
	});

	it("サムネイルが無いときだけ店の写真へ落ちる", () => {
		render({
			"media-1": entry("media-1", {
				thumbnailImageUrl: null,
				restaurantImageUrl: "https://example.test/restaurant-1.jpg",
			}),
		});
		expect(markerProps.map((props) => props.uri)).toEqual(["https://example.test/restaurant-1.jpg"]);
	});

	it("どちらも無ければ undefined（空文字を <Image> へ渡さない）", () => {
		render({ "media-1": entry("media-1", { thumbnailImageUrl: "" }) });
		expect(markerProps.map((props) => props.uri)).toEqual([undefined]);
	});
});
