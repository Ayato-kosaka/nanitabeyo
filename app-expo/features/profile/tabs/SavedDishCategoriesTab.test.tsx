/**
 * #1369 保存料理カテゴリのカードを押したときの «行き先» を固定する。
 *
 * モーダル時代はここが `open()` で、押した先という概念自体がコードに無かった。
 * ルートになると行き先は文字列とパラメータになり、**間違えても型検査を通る**
 * （typed routes は pathname の綴りは見るが、どのパラメータを載せたかまでは見ない）。
 * 遷移先が検索に使うのは `dishCategoryId` と `dishCategoryLabelEn` の 2 つで、片方でも落ちると
 * 「画面は開くのに検索が始まらない」という形で壊れる。
 *
 * 地点が確定したあとの検証（details・最近使った場所・entriesKey）は
 * containers/SavedDishCategoryLocationSearch.test.tsx にある。
 */
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import type { DishCategory } from "@/stores/useDishCategoriesStore";

const captured: { onItemPress?: (item: DishCategory, index: number) => void } = {};
jest.mock("./save/SaveDishCategoryTab", () => ({
	SaveDishCategoryTab: (props: { onItemPress?: (item: DishCategory, index: number) => void }) => {
		captured.onItemPress = props.onItemPress;
		return null;
	},
}));

const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({
	router: { push: (...args: unknown[]) => mockRouterPush(...args) },
	useLocalSearchParams: () => ({ userId: "user-1" }),
}));

jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: jest.fn() }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));

jest.mock("@/stores/useDishCategoriesStore", () => {
	const useDishCategoriesStore = () => ({
		ids: [],
		isLoading: false,
		error: null,
		hasNextPage: false,
		isLoadingMore: false,
	});
	// 初回マウントの取得は検証対象外なので、取得済みにして走らせない
	useDishCategoriesStore.getState = () => ({
		fetchInitialByKey: jest.fn(),
		hasFetchedInitialByKey: { profileSavedDishCategories: true },
	});
	return { useDishCategoriesStore, selectDishCategoryIdsByKey: () => () => undefined };
});

import { SavedDishCategoriesTab } from "./SavedDishCategoriesTab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dishCategory: DishCategory = {
	id: "cat-1",
	image_url: "https://example.com/ramen.png",
	labels: { "ja-JP": "ラーメン" },
	label_en: "ramen",
} as DishCategory;

describe("#1369 保存料理カテゴリのカードから地点検索へ", () => {
	let renderer: TestRenderer.ReactTestRenderer;

	beforeEach(() => {
		captured.onItemPress = undefined;
	});

	afterEach(async () => {
		await act(async () => {
			renderer?.unmount();
		});
	});

	it("カードを押すと地点検索ルートへ locale とトピックを載せて push する", async () => {
		await act(async () => {
			renderer = TestRenderer.create(<SavedDishCategoriesTab />);
		});

		await act(async () => {
			captured.onItemPress!(dishCategory, 0);
		});

		expect(mockRouterPush).toHaveBeenCalledTimes(1);
		expect(mockRouterPush).toHaveBeenCalledWith({
			pathname: "/[locale]/(tabs)/profile/saved-dish-category-location",
			// label_en は遷移先が推薦 API へ渡す検索語。id だけにすると画面は開くが検索が成立しない
			params: { locale: "ja-JP", dishCategoryId: "cat-1", dishCategoryLabelEn: "ramen" },
		});
	});
});
