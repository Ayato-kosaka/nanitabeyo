import { DEFAULT_TIMEOUT, by, tapWhenVisible, waitUntilVisible } from "../fixtures/e2e";

/**
 * 🎞 店舗のレビューフィード（`/[locale]/restaurant/[restaurantId]/feed`）の Screen Object
 *（e2e-web の pages/RestaurantDetailPage.ts のフィード部分に対応）
 *
 * 対応コンポーネント:
 * - `app-expo/app/[locale]/restaurant/[restaurantId]/feed.tsx`（ルート本体）
 * - `app-expo/features/map/components/FeedDishMediaViewer.tsx`（フィードと投稿 CTA の実体）
 *
 * ## #1386 モーダルからルートへ移した
 * 旧実装は `RestaurantReviewsTab` の中の `DishMediaModal`（**既定 zIndex 1100 = 親と同値**）で、
 * さらにその中にレビュー投稿フォームの BlurModal を重ねる **3 段目の入れ子**だった。
 * #308（レストランのレビューが出ない = pointerEvents / 重なり）の当事者でもある。
 *
 * ## ヘッダーを持たない画面
 * フィードは全画面のメディアなので `ScreenHeader` を敷いていない（既存のフィード 2 画面
 *（`notifications/feed` / `profile/food`）と同じ判断）。閉じる導線は `search/result.tsx` と同じ
 * «浮かせた ×»（`restaurant-feed-close-button`）で、可視判定はコンテナ（`restaurant-feed-screen`）で行う。
 */
export class RestaurantFeedScreen {
	/** 画面コンテナ */
	readonly container = by.id("restaurant-feed-screen");
	/** «見るものが無い» 表示（0 件 / 取得失敗）。スピナーで固着しないことの観測点 */
	readonly empty = by.id("restaurant-feed-empty");
	/** 「この料理にレビューを書く」CTA（ログイン済み かつ 表示中のメディアがあるときだけ描かれる） */
	/*
	#1629【オーナー確定】«この料理にレビューを書く» は撤去した（右レールの «食べた» が導線）。
	locator も消す。跡地を残すと «あるはずのもの» として次の人が使ってしまう。
	*/
	/** 閉じる ×（ヘッダーを持たない画面なので浮かせてある） */
	readonly closeButton = by.id("restaurant-feed-close-button");

	/** フィード画面が開いていることを検証する */
	async expectOpened(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.container, timeout);
	}

	/** «見るものが無い» 表示が出ていることを検証する */
	async expectEmpty(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.empty, timeout);
	}

	/** × をタップして閉じる */
	async close(): Promise<void> {
		await tapWhenVisible(this.closeButton);
	}
}
