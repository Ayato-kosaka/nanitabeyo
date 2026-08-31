import { DEFAULT_TIMEOUT, by, tapWhenVisible, waitUntilVisible } from "../fixtures/e2e";

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
 * ## testID
 * `notifications-header-title` は #1130 の Detox spec（SafeArea への食い込み検出）のために
 * app-expo 側へ追加したもの。
 *
 * #1506 で **行とアイコンにも testID を足した**（`notification-item-<action_type>` /
 * `notification-icon-<action_type>`）。通知 id は E2E から予測できないので id は載せず、
 * 種別で引ける形にしてある。同じ種別の通知が複数あれば複数一致するので、
 * 掴むときは `atIndex(0)`（= 一覧の最上段 = 最新）を使うこと。
 * バッジには引き続き testID が無い。必要になったら都度アプリ側へ追加すること。
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

	/**
	 * 指定した種別の通知行（#1506）。
	 *
	 * @param actionType `notifications.action_type`。GRP-04 の投票完了通知は `"vote"`
	 */
	notificationItem(actionType: string) {
		return by.id(`notification-item-${actionType}`);
	}

	/** 指定した種別の通知アイコン（#1506。like=ハート / save=しおり / vote=投票箱） */
	notificationIcon(actionType: string) {
		return by.id(`notification-icon-${actionType}`);
	}

	/**
	 * 指定した種別の通知が一覧に現れるまで待つ。
	 *
	 * ⚠️ 通知は Cloud Tasks の非同期ジョブが作るため、**投票の送信直後にはまだ無い**ことがある。
	 * 呼び出し側は投票からの経過に見合った長めの timeout を渡すこと。
	 *
	 * @param actionType 待つ通知の種別
	 * @param timeout タイムアウト (ms)
	 */
	async expectNotificationItem(actionType: string, timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		// 同種の通知が複数あると素の element() は「Multiple elements were matched」で落ちるため、
		// 必ず最上段（= 最新）だけを見る
		await waitUntilVisible(this.notificationItem(actionType), timeout, 0);
	}

	/** 指定した種別の通知の最上段（= 最新）をタップする */
	async openNotificationItem(actionType: string, timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await tapWhenVisible(this.notificationItem(actionType), timeout, 0);
	}
}
