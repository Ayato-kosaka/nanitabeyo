import { useSpotlightTutorial } from "@/features/tutorial/hooks/useSpotlightTutorial";

/**
 * 閲覧済みフラグは仕様変更時に明示的にバージョンを上げる。
 *
 * 既存キーを書き換えるより新しいキーへ移行する方が、
 * 「どのチュートリアルを見たか」が曖昧にならず安全。
 *
 * #1553 【設計】定数名は DishCategories 系へ改名したが、**保存される値は
 * `topics_spotlight_tutorial_seen_v1` のまま**である。値を変えると既に
 * チュートリアルを見終えた全ユーザーの既読が消え、次回起動で再表示されてしまう。
 */
export const DISH_CATEGORIES_TUTORIAL_STORAGE_KEY = "topics_spotlight_tutorial_seen_v1";

/**
 * #927 料理提案画面のチュートリアル。中身は共通の `useSpotlightTutorial`（#1375 で切り出し）で、
 * ここが持つのは **保存キーだけ**である。
 */
export function useDishCategoriesTutorial({ canAutoOpen }: { canAutoOpen: boolean }) {
	return useSpotlightTutorial({ storageKey: DISH_CATEGORIES_TUTORIAL_STORAGE_KEY, canAutoOpen });
}
