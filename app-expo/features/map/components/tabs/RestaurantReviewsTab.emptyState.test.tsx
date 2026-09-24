// #1264 店舗詳細の «みんなの投稿» タブが空のときに何を出すか。
//
// ⚠️ **ここが無いと «見出しの下が真っ白» になる。** 本番の自社 UGC は 90 日で 21 件しか
// 無く（#1264 の実測）、ほとんどの店でこのタブは空である。それでもこのタブは
// **1 度も «レビューなし» の面を描いていなかった**。#1264 の完了条件
// «レビュー、または適切な「レビューなし」状態を表示できる» はここのことである。
//
// 固定するのは 3 点。
//   1. 取り終えて 0 件のときだけ «まだ投稿がありません» を出す
//      （読み込み中に出すと、取れているのに «無い» と読ませる）
//   2. 失敗したときは **空と別の面**を出す（通信が落ちただけなのに «投稿が無い» と読ませない）
//   3. 空の面に **投稿ボタンを置かない**（#1629 でオーナーが «写真・動画を投稿» を
//      この画面から外し、投稿は «食べたを記録» へ 1 本化すると決めている）
import React from "react";
import TestRenderer, { type ReactTestRenderer } from "react-test-renderer";

jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key, locale: "ja-JP" } }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("@/components/collapsible-tabs/GridList", () => {
	const { View } = require("react-native");
	return {
		GridList: ({ data, ListEmptyComponent }: { data: unknown[]; ListEmptyComponent: React.ReactNode }) => (
			<View testID="grid">{data.length === 0 ? ListEmptyComponent : null}</View>
		),
	};
});
jest.mock("@/components/ImageCardGrid", () => ({ ImageCard: () => null }));
jest.mock("@/components/DishRating", () => ({ DishRating: () => null }));
jest.mock("../../hooks/useRestaurantDishMediaFetcher", () => ({
	useRestaurantDishMediaFetcher: () => jest.fn(),
}));

/** ストアが返す «この画面ぶん» の状態。各テストが差し替える */
let mockStoreState = { ids: [] as string[], isLoading: false, hasFetchedInitial: false, error: null as unknown };
const fetchInitialByKey = jest.fn();
jest.mock("@/stores/useDishMediaEntriesStore", () => {
	const inner = {
		clearByKey: jest.fn(),
		fetchInitialByKey: jest.fn(),
		fetchMoreByKey: jest.fn(),
	};
	const hook = (selector?: (s: unknown) => unknown) => {
		// `s.fetchInitialByKey` のような «関数の取り出し» にはその関数を、
		// selectIdsByKey 経由の呼び出しには状態を返す
		if (typeof selector === "function") {
			const value = selector(inner);
			if (typeof value === "function") return value;
		}
		return mockStoreState;
	};
	return {
		useDishMediaEntriesStore: Object.assign(hook, { getState: () => inner }),
		selectIdsByKey: () => () => mockStoreState,
		selectEntryByMediaId: () => () => null,
	};
});

import { RestaurantReviewsTab } from "./RestaurantReviewsTab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const render = () => {
	let renderer!: ReactTestRenderer;
	TestRenderer.act(() => {
		renderer = TestRenderer.create(<RestaurantReviewsTab restaurantId="r-1" onItemPress={jest.fn()} />);
	});
	return renderer;
};

const exists = (renderer: ReactTestRenderer, testID: string) =>
	renderer.root.findAll((node) => node.props?.testID === testID).length > 0;

beforeEach(() => {
	fetchInitialByKey.mockClear();
	mockStoreState = { ids: [], isLoading: false, hasFetchedInitial: false, error: null };
});

describe("RestaurantReviewsTab の空の面（#1264）", () => {
	it("取り終えて 0 件なら «まだ投稿がありません» を出す", () => {
		mockStoreState = { ids: [], isLoading: false, hasFetchedInitial: true, error: null };
		const renderer = render();
		expect(exists(renderer, "restaurant-reviews-empty")).toBe(true);
	});

	it("⚠️ まだ取り終えていないうちは出さない（取れているのに «無い» と読ませない）", () => {
		mockStoreState = { ids: [], isLoading: false, hasFetchedInitial: false, error: null };
		const renderer = render();
		expect(exists(renderer, "restaurant-reviews-empty")).toBe(false);
	});

	it("⚠️ 読み込み中も出さない", () => {
		mockStoreState = { ids: [], isLoading: true, hasFetchedInitial: true, error: null };
		const renderer = render();
		expect(exists(renderer, "restaurant-reviews-empty")).toBe(false);
	});

	it("⚠️ 失敗したときは空と別の面を出す（通信が落ちただけなのに «投稿が無い» と読ませない）", () => {
		mockStoreState = { ids: [], isLoading: false, hasFetchedInitial: false, error: "boom" };
		const renderer = render();
		expect(exists(renderer, "restaurant-reviews-error")).toBe(true);
		expect(exists(renderer, "restaurant-reviews-empty")).toBe(false);
		expect(exists(renderer, "restaurant-reviews-retry")).toBe(true);
	});

	it("⚠️ 空の面に投稿ボタンを置かない（#1629 のオーナー判断）", () => {
		mockStoreState = { ids: [], isLoading: false, hasFetchedInitial: true, error: null };
		const renderer = render();
		const text = JSON.stringify(renderer.toJSON());
		// 投稿系の導線に使われている testID / キーが 1 つも出ていないこと
		expect(text).not.toContain("restaurant-detail-post");
		expect(text).not.toContain("Restaurant.detail.postReview");
		expect(text).not.toContain("dish-category");
	});

	it("1 件でもあれば空の面を出さない", () => {
		mockStoreState = { ids: ["m-1"], isLoading: false, hasFetchedInitial: true, error: null };
		const renderer = render();
		expect(exists(renderer, "restaurant-reviews-empty")).toBe(false);
	});
});
