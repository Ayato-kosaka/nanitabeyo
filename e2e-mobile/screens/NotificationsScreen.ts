import { DEFAULT_TIMEOUT, by, waitUntilVisible } from "../fixtures/e2e";

/**
 * 🔔 お知らせ一覧画面の Screen Object
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/notifications/index.tsx
 *
 * ## ⚠️ この画面を開くと dev DB へ書き込みが起きる
 * 通知一覧は入場時（useFocusEffect）に `markAllAsRead()` を呼び、共有 dev DB の既読状態を
 * 書き換える。そのため **この画面を開く spec は Tier 3（tests/mutation/ + describeMutation）に置くこと**。
 * tests/authenticated/profile-authenticated.test.ts が「お知らせタブの表示有無だけを見てタップしない」と
 * 明記しているのと同じ理由（#1030 の Tier 分類）。
 *
 * ## testID は現状ヘッダーのタイトルだけ
 * `notifications-header-title` は #1130 の Detox spec（SafeArea への食い込み検出）のために
 * app-expo 側へ追加したもの。一覧の各行やバッジには testID が無いため、
 * 内容の検証が必要になったら都度アプリ側へ追加すること。
 */
export class NotificationsScreen {
	/**
	 * ヘッダーのタイトル（ja-JP: `Notifications.title`＝「お知らせ」）。
	 *
	 * SafeAreaView（`react-native-safe-area-context`, edges={["top"]}）の直下にある
	 * ヘッダー View の唯一の子で、その上端 y は **safe area の下端 + ヘッダーの paddingVertical(16dp)**
	 * になる。#1130 ではここの実座標を読んで「ステータスバー領域へ食い込んでいないこと」を検証する。
	 */
	readonly headerTitle = by.id("notifications-header-title");

	/** お知らせ一覧が表示される（ヘッダーの描画完了 = 遷移完了）まで待つ */
	async expectLoaded(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.headerTitle, timeout);
	}
}
