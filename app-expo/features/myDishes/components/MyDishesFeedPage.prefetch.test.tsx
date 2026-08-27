/*
#1629【18】フィードの先読み。オーナー実機報告:

> リストから 1 個開いて **5 秒待って**下っていくと、ローディングが 1〜2 秒かかる

真因は「隣のページは **前面へ来た瞬間** に初めて取得を始める」ことだった
（`isActive` が false の間、行のクエリも `GET /v1/dish-media?ids=` も null で止まる）。
だから何秒待っても速くならない。

ここで固定するのは **1 点だけ**:
**前面ではない隣のページでも、`shouldPrefetch` が立っていれば取得を始める。**

⚠️ このテストは «先読みが効いていること» の証明であって «速いこと» の証明ではない。
   体感の速さは実機でしか確かめられない。
*/
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("expo-router", () => ({ router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() } }));

// 中身（横フィード・チップ）はこのテストの関心事ではない
jest.mock("@/features/dishMedia/components/DishMediaFeed", () => ({
	__esModule: true,
	default: () => null,
}));
jest.mock("@/features/myDishes/components/MyDishesFeedChips", () => ({ MyDishesFeedChips: () => null }));
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: jest.fn() }) }));

/** 派生クエリ 2 本が «何を渡されたか» を記録する。null なら取得しない、という契約 */
// ⚠️ jest.mock のファクトリからは «mock» で始まる変数しか触れない（巻き上げのため）
const mockRestaurantQueryArgs: (string | null)[] = [];
const mockDateQueryArgs: (string | null)[] = [];
const mockEmptyQuery = {
	items: [] as unknown[],
	queryKey: null,
	error: null,
	hasFetchedInitial: false,
	refresh: () => {},
};
jest.mock("@/features/myDishes/hooks/useMyDishesRestaurantQuery", () => ({
	useMyDishesRestaurantQuery: (id: string | null) => {
		mockRestaurantQueryArgs.push(id);
		return mockEmptyQuery;
	},
}));
jest.mock("@/features/myDishes/hooks/useMyDishesDateQuery", () => ({
	useMyDishesDateQuery: (date: string | null) => {
		mockDateQueryArgs.push(date);
		return mockEmptyQuery;
	},
}));

import React, { act } from "react";
import TestRenderer from "react-test-renderer";

import { MyDishesFeedPage } from "./MyDishesFeedPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RESTAURANT_ID = "restaurant-next";

function render(props: { isActive: boolean; shouldPrefetch?: boolean }) {
	let tree: TestRenderer.ReactTestRenderer | undefined;
	act(() => {
		tree = TestRenderer.create(
			<MyDishesFeedPage scope={{ kind: "restaurant", restaurantId: RESTAURANT_ID }} {...props} />,
		);
	});
	return tree!;
}

beforeEach(() => {
	mockRestaurantQueryArgs.length = 0;
	mockDateQueryArgs.length = 0;
	jest.useFakeTimers();
});

afterEach(() => {
	jest.useRealTimers();
});

describe("#1629【18】隣のページの先読み", () => {
	it("前面でなく先読みも指示されていなければ、取得を始めない（従来どおり）", () => {
		render({ isActive: false });
		act(() => {
			jest.advanceTimersByTime(5_000);
		});

		expect(mockRestaurantQueryArgs.every((id) => id === null)).toBe(true);
	});

	it("**前面でなくても `shouldPrefetch` なら取得を始める**（この 1 点が #1629【18】の修正）", () => {
		render({ isActive: false, shouldPrefetch: true });

		// 点火前は従来どおり null（前面のページの往復を邪魔しないための待ち）
		expect(mockRestaurantQueryArgs.every((id) => id === null)).toBe(true);

		act(() => {
			jest.advanceTimersByTime(1_000);
		});

		expect(mockRestaurantQueryArgs).toContain(RESTAURANT_ID);
	});

	it("前面のページは待たずに取得を始める", () => {
		render({ isActive: true });

		expect(mockRestaurantQueryArgs).toContain(RESTAURANT_ID);
	});
});
