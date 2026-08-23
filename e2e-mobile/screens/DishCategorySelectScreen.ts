import {
	DEFAULT_TIMEOUT,
	by,
	element,
	expect,
	tapWhenVisible,
	waitUntilNotVisible,
	waitUntilVisible,
} from "../fixtures/e2e";

/**
 * 🍜 料理カテゴリ選択画面（`/[locale]/restaurant/[restaurantId]/dish-category`）の Screen Object
 *（e2e-web の pages/RestaurantDetailPage.ts の料理カテゴリ部分に対応）
 *
 * 対応コンポーネント:
 * - `app-expo/app/[locale]/restaurant/[restaurantId]/dish-category.tsx`（ルート本体）
 * - `app-expo/features/map/components/DishCategorySearchForm.tsx`（入力欄・候補の実体）
 *
 * ## #1386 モーダルからルートへ移した
 * 旧実装はレビュー投稿フォームの中の `DishCategoryModal`（**既定 zIndex 1100**）で、
 * 親のレビュー投稿モーダル（1200）より数字が小さいという逆転を抱えていた。
 * さらにオートコンプリートを BlurModal の中に置いていた点が #528（候補をタップすると
 * キーボードだけ閉じて選択が反応しない）そのもので、その修正 PR #1180 が
 * «全モーダルの操作性» を削った経緯がある。
 *
 * ## 候補は選ばない
 * 候補の取得は `GET v1/dish-category-variants` の実データに依存し、選択後は
 * 前の画面（レビュー投稿フォーム）の state を書き換える。ここで守りたいのは
 * 「独立した画面として到達でき、ハードウェアバックで離脱できる」ことなので入力には触れない。
 * 選択結果がフォームへ戻ることは app-expo の `__tests__/reviewFormRoutes.test.tsx` が固定している。
 */
export class DishCategorySelectScreen {
	/** 画面タイトル（ScreenHeader が `${testID}-title` として付ける） */
	readonly title = by.id("dish-category-screen-title");
	/** 料理カテゴリの検索入力欄（`DishCategoryAutocomplete` が `${testID}-input` として出す） */
	readonly searchInput = by.id("dish-category-search-input");
	/** ヘッダーの戻るボタン（`app-expo/components/ScreenHeader.tsx`） */
	// #1404 ScreenHeader の戻るボタンは `${testID}-back`。共通 id だった頃は、push で背面に残る
	// 画面のヘッダーと同じ id になり «背面を押していた»
	readonly backButton = by.id("dish-category-screen-back");

	/** 料理カテゴリ選択画面が開いていることを検証する */
	async expectOpened(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.title, timeout);
		await expect(element(this.searchInput)).toBeVisible();
	}

	/** 料理カテゴリ選択画面から離脱したことを検証する */
	async expectClosed(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilNotVisible(this.title, timeout);
	}

	/** ヘッダーの戻るボタンをタップして離脱する */
	async goBack(): Promise<void> {
		await tapWhenVisible(this.backButton);
	}
}
