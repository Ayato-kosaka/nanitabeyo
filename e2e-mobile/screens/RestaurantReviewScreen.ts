import { DEFAULT_TIMEOUT, by, element, expect, waitUntilVisible } from "../fixtures/e2e";

/**
 * ✍️ 店舗のレビュー投稿（`/[locale]/restaurant/[restaurantId]/review`）の Screen Object
 *
 * 対応コンポーネント: `app-expo/app/[locale]/restaurant/[restaurantId]/review.tsx`
 *
 * ## なぜ «着いたこと» の観測点が要るのか（#1579）
 * 料理カテゴリ選択（`dish-category.tsx`）の戻る導線は、履歴が無い着地では
 * `router.replace` でこの画面へ倒れる。ところが e2e はそれを
 * **「カテゴリ選択画面が消えたこと」だけ**で検証していたため、
 * **ハードウェアバックでアプリごと終了しても緑**になっていた（#1961 の不具合が
 * «在るからこそ» 通るテスト）。«居なくなった» ではなく «着いた» を見るために置く。
 *
 * ## 中身ではなくヘッダーを見る
 * この画面はマウント時にメディアピッカーを開くので、フォーム本体は観測点に向かない。
 * `ScreenHeader` は `${testID}-title` をタイトルへ付ける（`components/ScreenHeader.tsx`）。
 * ヘッダーは **データの分岐の外**に 1 つだけ置いてあるので、存在しない id で
 * 404 になっても «ここがレビュー投稿ルートであること» は成り立つ。
 */
export class RestaurantReviewScreen {
	/** 画面タイトル（ScreenHeader が `${testID}-title` として付ける） */
	readonly title = by.id("restaurant-review-screen-title");
	/** ヘッダーの戻るボタン（`${testID}-back`） */
	readonly backButton = by.id("restaurant-review-screen-back");

	/** レビュー投稿画面が開いていることを検証する */
	async expectOpened(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.title, timeout);
		await expect(element(this.backButton)).toBeVisible();
	}
}
