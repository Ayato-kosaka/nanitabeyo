/*
#1398 PR5 リストビューの写真なしフォールバック（設計書 (2/2) §12 PR5 / #1375 追補2 決定3）。

固定したいのは 3 点：
1. `dishMedia === null` でも灰色プレースホルダーにせず、`dish.categoryImageUrl` →
   `restaurant.image_url` の順で実画像を出す
2. 実画像へフォールバックしても「写真なし」であること自体は分かる
   （`MyDishes.list.noPhoto` バッジが出る）
3. 3 つとも無いときだけ、従来どおりの無地プレースホルダー（`my-dishes-list-item-placeholder`）
*/
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }) }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useContentWidth", () => ({ useContentWidth: () => 390 }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));

jest.mock("expo-image", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		Image: ({ source }: { source?: { uri?: string } }) =>
			ReactActual.createElement(RNView, { testID: "my-dishes-list-item-image", source }),
	};
});

// #1398 PR5 このテストが見たいのは MyDishCard（写真なしフォールバック）だけなので、
// GridList は data を renderItem にそのまま流すだけの薄いフェイクへ差し替える
jest.mock("@/components/collapsible-tabs/GridList", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		GridList: ({ data, renderItem }: { data: { id: string }[]; renderItem: (info: { item: unknown }) => unknown }) =>
			ReactActual.createElement(
				RNView,
				{ testID: "my-dishes-list" },
				data.map((item: { id: string }) => ReactActual.createElement(RNView, { key: item.id }, renderItem({ item }))),
			),
	};
});

import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import type { MyDishItem } from "@shared/api/v1/res";
import { MyDishesListView } from "./MyDishesListView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const makeItem = (
	key: string,
	overrides: { thumbnailImageUrl?: string | null; categoryImageUrl?: string | null; restaurantImageUrl?: string | null } = {},
): MyDishItem =>
	({
		key,
		status: "eaten",
		occurredAt: "2026-08-10T12:00:00.000Z",
		savedAt: null,
		eatenAt: "2026-08-10T12:00:00.000Z",
		restaurant: { id: "restaurant-1", name: "テスト食堂", image_url: overrides.restaurantImageUrl ?? null },
		dish: { id: "dish-1", name: "ラーメン", categoryImageUrl: overrides.categoryImageUrl ?? null },
		dishMedia:
			overrides.thumbnailImageUrl === undefined || overrides.thumbnailImageUrl === null
				? null
				: { id: "media-1", thumbnailImageUrl: overrides.thumbnailImageUrl },
		myReview: null,
	}) as unknown as MyDishItem;

const mockUseMyDishesQuery = jest.fn();
jest.mock("../hooks/useMyDishesQuery", () => ({
	useMyDishesQuery: () => mockUseMyDishesQuery(),
}));

const mountedTrees: TestRenderer.ReactTestRenderer[] = [];
const render = async (): Promise<TestRenderer.ReactTestRenderer> => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(<MyDishesListView />);
	});
	mountedTrees.push(tree);
	return tree;
};

beforeEach(() => {
	mockPush.mockClear();
});

afterEach(async () => {
	await act(async () => {
		mountedTrees.splice(0).forEach((tree) => tree.unmount());
	});
});

describe("#1398 PR5 dishMedia === null の写真なしフォールバック", () => {
	it("categoryImageUrl があればそれを画像として出す（灰色プレースホルダーにしない）", async () => {
		mockUseMyDishesQuery.mockReturnValue({
			items: [makeItem("review:1", { categoryImageUrl: "https://example.com/category.jpg" })],
			isLoading: false,
			isLoadingMore: false,
			error: null,
			hasNextPage: false,
			loadMore: jest.fn(),
			refresh: jest.fn(),
		});
		const tree = await render();

		const images = tree.root.findAll((node) => node.props?.testID === "my-dishes-list-item-image");
		expect(images.length).toBeGreaterThan(0);
		expect(images[0].props.source.uri).toBe("https://example.com/category.jpg");

		expect(tree.root.findAll((node) => node.props?.testID === "my-dishes-list-item-placeholder")).toHaveLength(0);
	});

	it("categoryImageUrl も無ければ restaurant.image_url へ落ちる", async () => {
		mockUseMyDishesQuery.mockReturnValue({
			items: [makeItem("review:1", { restaurantImageUrl: "https://example.com/restaurant.jpg" })],
			isLoading: false,
			isLoadingMore: false,
			error: null,
			hasNextPage: false,
			loadMore: jest.fn(),
			refresh: jest.fn(),
		});
		const tree = await render();

		const images = tree.root.findAll((node) => node.props?.testID === "my-dishes-list-item-image");
		expect(images[0].props.source.uri).toBe("https://example.com/restaurant.jpg");
	});

	it("実画像へフォールバックしても『写真なし』バッジが出る", async () => {
		mockUseMyDishesQuery.mockReturnValue({
			items: [makeItem("review:1", { categoryImageUrl: "https://example.com/category.jpg" })],
			isLoading: false,
			isLoadingMore: false,
			error: null,
			hasNextPage: false,
			loadMore: jest.fn(),
			refresh: jest.fn(),
		});
		const tree = await render();

		expect(
			tree.root.findAll((node) => node.props?.testID === "my-dishes-list-item-no-photo-badge").length,
		).toBeGreaterThan(0);
	});

	it("dishMedia があるとき（写真あり）はバッジを出さない", async () => {
		mockUseMyDishesQuery.mockReturnValue({
			items: [makeItem("review:1", { thumbnailImageUrl: "https://example.com/media.jpg" })],
			isLoading: false,
			isLoadingMore: false,
			error: null,
			hasNextPage: false,
			loadMore: jest.fn(),
			refresh: jest.fn(),
		});
		const tree = await render();

		expect(
			tree.root.findAll((node) => node.props?.testID === "my-dishes-list-item-no-photo-badge"),
		).toHaveLength(0);
	});

	it("categoryImageUrl / restaurant.image_url も無いときだけ従来どおりの無地プレースホルダーになる", async () => {
		mockUseMyDishesQuery.mockReturnValue({
			items: [makeItem("review:1")],
			isLoading: false,
			isLoadingMore: false,
			error: null,
			hasNextPage: false,
			loadMore: jest.fn(),
			refresh: jest.fn(),
		});
		const tree = await render();

		expect(
			tree.root.findAll((node) => node.props?.testID === "my-dishes-list-item-placeholder").length,
		).toBeGreaterThan(0);
		expect(tree.root.findAll((node) => node.props?.testID === "my-dishes-list-item-image")).toHaveLength(0);
	});
});
