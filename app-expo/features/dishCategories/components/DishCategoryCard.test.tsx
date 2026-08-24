/**
 * #1205 トピック保存（ハート/ブックマーク）の多重実行ガード（A7）を固定するテスト。
 *
 * 背景:
 * 保存ボタンに `disabled` は無く、あっても `isSaved`（store 購読の state）は表示用途で、
 * 多重実行の判定には使えない。React が再レンダリングをコミットする前に 2 発目の押下が
 * 処理されると両方が同じ `isSaved` を読んで通過するため、`toggleReaction` が 2 回走る。
 * 保存は `insertReaction`（`lib/reactions.ts` の素の insert）なので 2 発目は `reactions` の
 * 一意制約で失敗し、catch の `setDishCategorySaved(item.categoryId, !willSave)` が発火して
 * **保存できているのに表示が保存解除へ巻き戻る**。
 *
 * このテストは以下を赤で守る。
 *   - await に入る前に 2 回押しても `toggleReaction` が 1 回しか走らない
 *   - 二重押下しても表示（ブックマークの選択状態）が保存解除へ巻き戻らない
 *   - 失敗したあとは押し直せる（解除が finally の 1 箇所に寄っていること）
 *
 * `useDishCategoriesStore` は**本物を使う**。巻き戻りは「楽観更新 → catch でのロールバック」という
 * store 経由の状態遷移そのものなので、スタブに差し替えると表示の巻き戻りを観測できない。
 */
import React, { act } from "react";
import TestRenderer, { type ReactTestInstance } from "react-test-renderer";

// lucide のアイコンは名前ごとに export されるため Proxy で一括スタブ化する（ReviewFormSubmit.test.tsx と同じ）
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
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useHaptics", () => {
	const lightImpact = jest.fn();
	return { useHaptics: () => ({ lightImpact }) };
});
const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));
const mockShowSnackbar = jest.fn();
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: mockShowSnackbar }) }));
// entriesKey の定義だけを使うが、SavedDishCategoriesTab 本体は画面まるごとを引き込むのでスタブ化する
jest.mock("@/features/profile/tabs/SavedDishCategoriesTab", () => ({ profileSavedDishCategoriesEntriesKey: "profileSavedDishCategories" }));
const mockToggleReaction = jest.fn();
jest.mock("@/lib/reactions", () => ({ toggleReaction: (...args: unknown[]) => mockToggleReaction(...args) }));
// 画像表示（expo-image / Lottie）は検証対象外。保存ボタンは topRightContent に入るので必ず描画する
jest.mock("./DishCategoryVisualCard", () => {
	const ReactModule = require("react");
	const { View: RNView } = require("react-native");
	return {
		DishCategoryVisualCard: ({ topRightContent, bottomContent }: { topRightContent?: unknown; bottomContent?: unknown }) =>
			ReactModule.createElement(RNView, null, topRightContent, bottomContent),
	};
});

import { useDishCategoriesStore } from "@/stores/useDishCategoriesStore";
import { DishCategoryCard } from "./DishCategoryCard";
import type { DishCategoryRecommendation } from "@/types/search";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dishCategory = {
	categoryId: "dish-category-1",
	title: "からあげ",
	reason: "揚げたてが旨い",
	imageUrl: "https://cdn.example.test/karaage.jpg",
	isSaved: false,
} as DishCategoryRecommendation;

const imageState = { status: "loaded" } as never;

describe("#1205 DishCategoryCard の保存の多重実行ガード", () => {
	let tree: TestRenderer.ReactTestRenderer;

	beforeEach(async () => {
		// 保存状態は store が持つ。テスト間で持ち越すと fallback（item.isSaved）が効かなくなる
		useDishCategoriesStore.setState({ savedByDishCategoryId: {}, dishCategoryIdsByKey: {}, dishCategoryById: {} });
		// jest.config の clearMocks（= mockClear）は **mockXxxOnce の待ち行列を消さない**。
		// ガードで 2 発目が弾かれると Once が 1 つ余るので、明示的に reset しないと
		// 次のテストが前のテストの実装（未解決 Promise や reject）を食って落ちる
		mockToggleReaction.mockReset();
		mockToggleReaction.mockResolvedValue(undefined);

		await act(async () => {
			tree = TestRenderer.create(
				<DishCategoryCard
					item={dishCategory}
					onBlock={jest.fn()}
					onSelect={jest.fn()}
					cardWidth={300}
					cardHeight={400}
					imageState={imageState}
				/>,
			);
		});
	});

	afterEach(async () => {
		await act(async () => tree?.unmount());
	});

	/**
	 * 保存ボタン（TouchableOpacity）。ラベルは保存状態で入れ替わるのでどちらも拾う。
	 * onPress は TouchableOpacity のレスポンダへ畳み込まれてホスト要素の props には出ないため、
	 * ホスト要素ではなく onPress を持つコンポーネント要素の方を探す。
	 */
	const saveButton = (): ReactTestInstance => {
		const button = tree.root.findAll(
			(node) =>
				typeof node.props?.onPress === "function" &&
				(node.props.accessibilityLabel === "DishCategories.accessibility.saveDishCategory" ||
					node.props.accessibilityLabel === "DishCategories.accessibility.unsaveDishCategory"),
		)[0];
		if (!button) throw new Error("保存ボタンが見つかりません");
		return button;
	};

	/** 支援技術・見た目に出る保存状態（Bookmark の塗りと同じ isSaved を見ている） */
	const isSavedOnScreen = () => saveButton().props.accessibilityState.selected as boolean;

	/**
	 * 保存ボタンを「再レンダリングを挟まずに」`times` 回押す。
	 *
	 * 1 つの act() の中で同じ onPress（= 同じ render の closure）を続けて呼ぶのが重要。
	 * 押下ごとに act を分けると store の更新が反映されてしまい、本番で起きる
	 * 「コミット前の連打」を再現できない。
	 */
	const pressSave = async (times = 1) => {
		const onPress = saveButton().props.onPress as (event: { stopPropagation: () => void }) => void;
		await act(async () => {
			for (let i = 0; i < times; i += 1) onPress({ stopPropagation: () => {} });
		});
	};

	/** テスト側で解決／棄却できる保留 Promise を toggleReaction へ差し込む */
	const deferToggle = () => {
		let resolveToggle!: () => void;
		let rejectToggle!: (reason: unknown) => void;
		mockToggleReaction.mockImplementationOnce(
			() =>
				new Promise<void>((resolve, reject) => {
					resolveToggle = resolve;
					rejectToggle = reject;
				}),
		);
		return {
			resolve: () => act(async () => resolveToggle()),
			reject: (reason: unknown) => act(async () => rejectToggle(reason)),
		};
	};

	it("await 前に 2 回押しても toggleReaction は 1 回しか走らない", async () => {
		const toggling = deferToggle();

		await pressSave(2);

		expect(mockToggleReaction).toHaveBeenCalledTimes(1);
		expect(mockToggleReaction).toHaveBeenCalledWith({
			target_type: "dish_categories",
			target_id: dishCategory.categoryId,
			action_type: "save",
			willReact: true,
		});

		await toggling.resolve();
	});

	it("二重に押しても表示が保存解除へ巻き戻らない（2 発目が一意制約で失敗しても）", async () => {
		// 1 発目は成功、2 発目は reactions の一意制約違反を模して失敗させる
		mockToggleReaction.mockResolvedValueOnce(undefined);
		mockToggleReaction.mockRejectedValueOnce(new Error("duplicate key value violates unique constraint"));

		await pressSave(2);

		// #1205 これが本丸。ガードが無いと 2 発目の catch で setDishCategorySaved(false) が走り、
		// 保存できているのにブックマークが未保存表示へ戻る
		expect(isSavedOnScreen()).toBe(true);
		expect(useDishCategoriesStore.getState().savedByDishCategoryId[dishCategory.categoryId]).toBe(true);
		expect(mockShowSnackbar).not.toHaveBeenCalledWith("Common.error");
		expect(mockLogFrontendEvent).not.toHaveBeenCalled();
	});

	it("保存に失敗すると表示を戻し、そのあと押し直せる", async () => {
		const failing = deferToggle();

		await pressSave();
		expect(isSavedOnScreen()).toBe(true); // 楽観更新

		await failing.reject(new Error("network down"));

		// 失敗時のロールバックは既存挙動（#954）。ここは変えない
		expect(isSavedOnScreen()).toBe(false);
		expect(mockShowSnackbar).toHaveBeenCalledWith("Common.error");

		// 解除は finally の 1 箇所。try 側へ散らすと ref が立ったままになり二度と保存できない
		const retry = deferToggle();
		await pressSave();
		expect(mockToggleReaction).toHaveBeenCalledTimes(2);

		await retry.resolve();
		expect(isSavedOnScreen()).toBe(true);
	});

	it("保存が完了したあとは解除も押せる（トグルが片方向に固まらない）", async () => {
		await pressSave();
		expect(isSavedOnScreen()).toBe(true);

		await pressSave();

		expect(mockToggleReaction).toHaveBeenLastCalledWith({
			target_type: "dish_categories",
			target_id: dishCategory.categoryId,
			action_type: "save",
			willReact: false,
		});
		expect(isSavedOnScreen()).toBe(false);
	});
});
