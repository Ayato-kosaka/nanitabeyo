import { by } from "../fixtures/e2e";

/**
 * 📍 レビュー投稿用の「お店選択」Screen Object。
 *
 * 対応画面:
 * - `app-expo/app/[locale]/(tabs)/review/selectRestaurant.tsx`（地図 + 検索でお店を選ぶ画面）
 * - `app-expo/app/[locale]/(tabs)/review/restaurant/[restaurantId].tsx`
 *   （`features/review/components/SelectedRestaurantDetails.tsx`。選択後の詳細画面）
 *
 * ## この PR（PR-5）では定義のみ（#1031 B6 レビュー指摘の反映）
 * この画面へ到達する唯一の UI 導線は `ReviewScreen.postButton`（レビュータブの投稿 CTA）で、
 * ログイン済みユーザーにしか表示されない（`app-expo/.../review/index.tsx` の
 * `user?.is_anonymous !== false` 分岐）。つまり **匿名ユーザーはこの画面へ到達する手段が無い**ため、
 * この PR（匿名のみで検証する PR-5）のテストからは使わない。
 * 将来の認証済みレビュー投稿テスト（別 PR）がそのまま使えるよう、実在する testID を確認したうえで
 * 定義だけ用意しておく。
 */
export class SelectRestaurantScreen {
	/** 検索バー内の現在地ボタン（`selectRestaurant.tsx:480`） */
	readonly currentLocationButton = by.id("review-select-restaurant-current-location-button");

	/**
	 * 選択したお店の詳細画面にある「写真・動画を投稿」ボタン（`SelectedRestaurantDetails.tsx:137`）。
	 * ログイン済みなら ReviewScreen（フォーム）へ、匿名ならログインモーダルへ遷移する
	 * （`handleReviewButtonPress`、`SelectedRestaurantDetails.tsx:68-88`）。
	 */
	readonly postPhotoButton = by.id("restaurant-detail-post-photo-button");
}
