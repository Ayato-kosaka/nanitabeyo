import { DEFAULT_TIMEOUT, by, element, existsNow, expect, tapWhenVisible, waitUntilVisible } from "../fixtures/e2e";

/**
 * 🏪 店舗詳細（`/[locale]/restaurant/[restaurantId]`）の Screen Object
 *（e2e-web の pages/RestaurantDetailPage.ts に対応）
 *
 * 対応コンポーネント:
 * - `app-expo/app/[locale]/restaurant/[restaurantId].tsx`（ルート本体）
 * - `app-expo/features/restaurant/components/SelectedRestaurantDetails.tsx`（中身・#1386 で 2 実装を統合）
 *
 * ## #1386 店舗詳細は 1 つになった
 * 以前は地図タブの `RestaurantBlurModal`（手動 zIndex 1100）の中に別実装（353 行）があり、
 * このルートとは «同じ画面の 2 実装» だった。統合で消えたのは実装だけで、機能
 *（入札タブ / 入札 / 現在の入札額 / Google マップ / フィード）はすべてこちらへ移してある。
 *
 * ## 観測点に `restaurant-detail-screen-title` を選んだ理由
 * これは `ScreenHeader`（`app-expo/components/ScreenHeader.tsx`）だけが出す testID で、
 * **BlurModal 実装には存在しない**。投稿ボタンだけを見ていると、店舗詳細をオーバーレイへ戻す
 * 変更を通してしまう（`screens/LoginScreen.ts` / `screens/ProfileEditScreen.ts` と同じ発想）。
 * e2e-web は `toHaveURL(/\/restaurant\//)` が同じ役目を負う。
 *
 * ## データを用意しないこと
 * 実在する restaurantId を用意するには dev DB へ店舗を作る（`POST /v1/restaurants`）必要があり、
 * Detox には API モックの仕組みも無い。この Screen Object を使うテストが見るのは
 * **「ルートへ着地でき、行き止まりにならない」** ことなので、存在しない id で着地して
 * ヘッダー（= 分岐の外に置いてある戻る導線）だけを観測する。
 * 中身が実データで描かれる経路は e2e-web のモックテストと @mutation テストが持つ。
 */
export class RestaurantDetailScreen {
	/** 画面タイトル（ScreenHeader が `${testID}-title` として付ける） */
	readonly title = by.id("restaurant-detail-screen-title");
	/** 「Google マップで開く」ボタン（実データがあるときだけ描かれる） */
	// #1629【オーナー確定】«写真・動画を投稿» を外し、この導線へ差し替えた。
	// 投稿は «食べたを記録» のフローへ 1 本化されている
	readonly googleMapsButton = by.id("restaurant-detail-google-maps-button");
	/** ヘッダーの戻るボタン（`app-expo/components/ScreenHeader.tsx`） */
	// #1404 ScreenHeader の戻るボタンは `${testID}-back`。共通 id だった頃は、push で背面に残る
	// 画面のヘッダーと同じ id になり «背面を押していた»
	readonly backButton = by.id("restaurant-detail-screen-back");

	/** 店舗詳細画面が開いていることを検証する */
	async expectOpened(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.title, timeout);
		await expect(element(this.backButton)).toBeVisible();
	}

	/** Google マップの導線が描かれているかを **待たずに** 判定する（実データ次第で出ない） */
	async hasGoogleMapsButton(): Promise<boolean> {
		return existsNow(this.googleMapsButton);
	}

	/** ヘッダーの戻るボタンをタップして離脱する */
	async goBack(): Promise<void> {
		await tapWhenVisible(this.backButton);
	}
}
