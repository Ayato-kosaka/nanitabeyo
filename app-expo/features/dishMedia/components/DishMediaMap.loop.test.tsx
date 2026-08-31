/*
#1729 オーナー実機報告（お店提案 / 検索結果が 1 件のとき）:

> 検索結果が一件しかないときカルーセルを同じ dish media でぐるぐるさせる必要はない。
> 動画にしたことで音がおかしくなるバグの温床。

`react-native-reanimated-carousel` は `loop` かつ `autoFillData`（既定 true）のとき
**data を複製し**（1 件 → 3 枚 / 2 件 → 4 枚）、`renderItem` へ渡す `index` は
`index % rawDataLength` で畳み戻す（`utils/computed-with-auto-fill-data.ts`）。
つまり 1 件のときは **3 枚とも `index === 0`** で描かれ、`isActive`（= `index === currentIndex`）が
全部 true になる。同じ動画のプレイヤーが同時に 3 つ再生状態になり、音が重なる。

ここで固定すること: **同時に active なセルは常に 1 枚**であること。
このモックは «アプリのロジック» ではなく «ライブラリの水増し規則» を再現している
（本物の Carousel は jest の transformIgnorePatterns の対象外で描けないため）。
ライブラリを上げるときは上記ファイルの規則が変わっていないかを見ること。
*/
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn(), selectionChanged: jest.fn() }),
}));
jest.mock("@/hooks/useContentWidth", () => ({ useContentWidth: () => 390 }));
jest.mock("@expo/react-native-action-sheet", () => ({ useActionSheet: () => ({ showActionSheetWithOptions: jest.fn() }) }));
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

/** セルの代役。isActive をそのまま testID へ出して «同時に何枚 active か» を数える */
jest.mock("./DishMediaContent", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		__esModule: true,
		default: ({ id, isActive }: { id: string; isActive: boolean }) =>
			ReactActual.createElement(RNView, { testID: `cell:${id}:${isActive ? "active" : "idle"}` }),
	};
});

/**
 * Carousel の代役。`loop` を受け取ったときだけ、本物と同じ規則でセルを水増しし、
 * index を `% rawDataLength` へ畳み戻して renderItem を呼ぶ。
 * （`computedFillDataWithAutoFillData` / `computedRealIndexWithAutoFillData` と同じ）
 */
const carouselProps: { loop?: boolean; data?: string[] }[] = [];
jest.mock("react-native-reanimated-carousel", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		Carousel: ({
			data,
			renderItem,
			loop,
		}: {
			data: string[];
			renderItem: (params: { item: string; index: number }) => React.ReactNode;
			loop?: boolean;
		}) => {
			carouselProps.push({ loop, data });
			const filled = loop
				? data.length === 1
					? [data[0], data[0], data[0]]
					: data.length === 2
						? [data[0], data[1], data[0], data[1]]
						: data
				: data;
			return ReactActual.createElement(
				RNView,
				null,
				filled.map((item, cellIndex) =>
					ReactActual.createElement(
						RNView,
						{ key: `cell-${cellIndex}` },
						renderItem({ item, index: loop ? cellIndex % data.length : cellIndex }),
					),
				),
			);
		},
	};
});

import DishMediaMap from "./DishMediaMap";
import { useDishMediaEntriesStore, type NormalizedDishMediaEntry } from "@/stores/useDishMediaEntriesStore";

const ENTRIES_KEY = "search-result";

const entry = (id: string): NormalizedDishMediaEntry =>
	({
		dish_media: { id, media_type: "video", mediaUrl: `https://example.test/${id}.mp4` },
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

function render(ids: string[]) {
	act(() => {
		useDishMediaEntriesStore.setState({
			entriesByMediaId: Object.fromEntries(ids.map((id) => [id, entry(id)])),
			mediaIdsByKey: { [ENTRIES_KEY]: ids },
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
	return renderer;
}

// ホスト要素だけ数える（React 要素とホストの二重計上を避ける）
const countCells = (renderer: ReactTestRenderer, id: string, state: "active" | "idle") =>
	renderer.root.findAll(
		(node) => typeof node.type === "string" && node.props?.testID === `cell:${id}:${state}`,
		{ deep: true },
	).length;

describe("#1729 お店提案のカルーセル", () => {
	beforeEach(() => {
		carouselProps.length = 0;
	});

	it("検索結果が 1 件のときは loop しない（同じ media のセルを増やさない）", () => {
		const renderer = render(["dm-1"]);

		// 水増しされていない = セルは 1 枚だけ。active も 1 枚だけ
		// （loop したままだと 3 枚とも index 0 で描かれ、active が 3 枚になる）
		expect(countCells(renderer, "dm-1", "active")).toBe(1);
		expect(countCells(renderer, "dm-1", "active") + countCells(renderer, "dm-1", "idle")).toBe(1);
		expect(carouselProps.at(-1)?.loop).toBe(false);
	});

	it("2 件のときも loop しない（本物は [a,b,a,b] へ水増しし、a が 2 枚とも active になる）", () => {
		const renderer = render(["dm-1", "dm-2"]);

		expect(carouselProps.at(-1)?.loop).toBe(false);
		expect(countCells(renderer, "dm-1", "active")).toBe(1);
		expect(countCells(renderer, "dm-2", "active")).toBe(0);
		expect(countCells(renderer, "dm-1", "active") + countCells(renderer, "dm-1", "idle")).toBe(1);
	});

	it("3 件以上は従来どおり loop する（この件数では複製が起きない）", () => {
		const renderer = render(["dm-1", "dm-2", "dm-3"]);

		expect(carouselProps.at(-1)?.loop).toBe(true);
		// active は先頭の 1 枚だけ
		expect(countCells(renderer, "dm-1", "active")).toBe(1);
		expect(countCells(renderer, "dm-2", "active")).toBe(0);
		expect(countCells(renderer, "dm-3", "active")).toBe(0);
	});
});
