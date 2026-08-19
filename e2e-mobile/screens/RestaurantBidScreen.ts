import { DEFAULT_TIMEOUT, by, element, expect, tapWhenVisible, waitUntilVisible } from "../fixtures/e2e";

/**
 * 💰 入札画面（`/[locale]/review/restaurant/[restaurantId]/bid`）の Screen Object
 *（e2e-web の pages/RestaurantDetailPage.ts の入札部分に対応）
 *
 * 対応コンポーネント:
 * - `app-expo/app/[locale]/(tabs)/review/restaurant/[restaurantId]/bid.tsx`（ルート本体）
 * - `app-expo/features/map/components/BidForm.tsx`（入力欄・入札ボタンの実体）
 *
 * ## #1386 モーダルからルートへ移した
 * 旧実装は店舗詳細シートの中の `BidBlurModal`（**手動 zIndex 1300**）。
 * ネイティブで最も重要なのは **ハードウェアバックで元の画面へ戻れること**で、
 * BlurModal は自前の BackHandler（`app-expo/features/blurModal/hooks/useBlurModal.tsx`）で
 * 戻るキーを握っていた（#498 の根）。ルート化でその責務は Navigator（スタックの pop）へ移る。
 *
 * ## 入札は送信しない
 * 送信処理は現時点ではダミー（2 秒待って成功ログを出すだけ。決済は未実装）だが、
 * この画面で守りたいのは「入札 UI へ到達でき、離脱できる」ことなので入力と送信には触れない
 *（e2e-web 側も同じ分担）。
 */
export class RestaurantBidScreen {
	/** 画面タイトル（ScreenHeader が `${testID}-title` として付ける） */
	readonly title = by.id("restaurant-bid-screen-title");
	/** ヘッダーの戻るボタン（`app-expo/components/ScreenHeader.tsx`） */
	readonly backButton = by.id("screen-header-back");

	/** 入札画面が開いていることを検証する */
	async expectOpened(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.title, timeout);
		await expect(element(this.backButton)).toBeVisible();
	}

	/** ヘッダーの戻るボタンをタップして離脱する */
	async goBack(): Promise<void> {
		await tapWhenVisible(this.backButton);
	}
}
