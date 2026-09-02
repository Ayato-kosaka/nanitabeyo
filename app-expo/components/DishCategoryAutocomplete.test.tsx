/**
 * #528 候補タップ時にキーボードを閉じる責務が「子（オートコンプリート側）」にあることを守るテスト。
 * 意図は components/LocationAutocomplete.test.tsx と同じ。料理カテゴリ側（レビュー投稿・地図の
 * 検索モーダル）も同じ BlurModal に載るため、同じ不変条件を両方で固定する。
 */
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { Keyboard } from "react-native";
import type { QueryDishCategoryVariantsResponse } from "@shared/api/v1/res";

// lucide のアイコンは名前ごとに export されるため Proxy で一括スタブ化する
jest.mock(
	"lucide-react-native",
	() =>
		new Proxy(
			{},
			{
				get: (_target, prop) =>
					prop === "__esModule"
						? true
						: function MockIcon() {
								return null;
							},
			},
		),
);
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));

let mockSuggestions: QueryDishCategoryVariantsResponse = [];
jest.mock("@/hooks/useDishCategorySearch", () => ({
	useDishCategorySearch: () => ({
		suggestions: mockSuggestions,
		isSearching: false,
		searchDishCategories: jest.fn(),
	}),
}));

import { DishCategoryAutocomplete } from "./DishCategoryAutocomplete";

const TEST_ID = "dish-category-autocomplete";

const ramen = { dishCategoryId: "cat-ramen", label: "ラーメン" } as QueryDishCategoryVariantsResponse[number];

describe("#528 DishCategoryAutocomplete の候補タップ", () => {
	let renderer: TestRenderer.ReactTestRenderer;
	let dismissSpy: jest.SpyInstance;

	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		mockSuggestions = [ramen];
		dismissSpy = jest.spyOn(Keyboard, "dismiss").mockImplementation(() => {});
	});

	afterEach(() => {
		act(() => renderer?.unmount());
		jest.restoreAllMocks();
	});

	/** 検索閾値（2 文字）を満たす値を入れて focus させ、候補パネルが出た状態にする */
	const mountFocused = (props: Partial<React.ComponentProps<typeof DishCategoryAutocomplete>> = {}) => {
		act(() => {
			renderer = TestRenderer.create(
				<DishCategoryAutocomplete
					value="ラーメン"
					onChangeText={jest.fn()}
					onSelectSuggestion={jest.fn()}
					testID={TEST_ID}
					{...props}
				/>,
			);
		});
		act(() => renderer.root.findByProps({ testID: `${TEST_ID}-input` }).props.onFocus());
		return renderer;
	};

	it("候補を押すと onSelectSuggestion が呼ばれ、キーボードは子が自分で閉じる", () => {
		const onSelectSuggestion = jest.fn();
		mountFocused({ onSelectSuggestion });

		const row = renderer.root.findByProps({ testID: `${TEST_ID}-suggestion-0` });
		act(() => row.props.onPress());

		expect(onSelectSuggestion).toHaveBeenCalledWith(ramen);
		expect(dismissSpy).toHaveBeenCalledTimes(1);
	});

	it("キーボードを閉じるのはタップ開始ではなく onPress（押下成立後）である", () => {
		mountFocused();

		const row = renderer.root.findByProps({ testID: `${TEST_ID}-suggestion-0` });
		// タップ開始のレスポンダ交渉だけを起こす。ここで閉じると押下が潰れる（#528 の事故）
		act(() => {
			row.props.onStartShouldSetResponder?.({});
		});
		expect(dismissSpy).not.toHaveBeenCalled();

		act(() => row.props.onPress());
		expect(dismissSpy).toHaveBeenCalledTimes(1);
	});
});
