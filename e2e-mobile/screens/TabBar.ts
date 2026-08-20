import { DEFAULT_TIMEOUT, by, element, existsNow, tapWhenVisible, waitUntilVisible } from "../fixtures/e2e";

/**
 * 🧭 ボトムタブバーの Screen Object（e2e-web の pages/TabBar.ts に対応）
 *
 * testID は `app-expo/app/[locale]/(tabs)/_layout.tsx` の `tabBarButtonTestID` に対応する。
 *
 * ## タブ可視性の注意点（アサーション時に必ず考慮すること）
 * - お知らせ (`tab-notifications`): 匿名ユーザーには非表示（`href: null`）。
 *   `describeAuthenticated` 配下でのみ表示をアサートできる
 * - posts: 常に非表示（内部遷移専用の隠しルート）
 *
 * ## Detox と Playwright の違い
 * Detox の `element()` はグローバル API で、Page Object のように `page` を保持する必要が無い。
 * そのため e2e-web の Page Object と違いコンストラクタ引数を取らず、**インスタンスは使い捨てでよい**
 * （#1031 §2）。
 */
export class TabBar {
	/** さがすタブ */
	readonly searchTab = by.id("tab-search");
	/** 食べたい/食べたタブ（#1396 でレビュータブから差し替え） */
	readonly myDishesTab = by.id("tab-my-dishes");
	/** マイページタブ */
	readonly profileTab = by.id("tab-profile");
	/** お知らせタブ（ログイン済みユーザーのみ表示） */
	readonly notificationsTab = by.id("tab-notifications");
	/** マップタブ（常に非表示 — 存在しないことのアサート用） */

	/** さがすタブへ遷移する */
	async gotoSearch(): Promise<void> {
		await tapWhenVisible(this.searchTab);
	}

	/** 食べたい/食べたタブへ遷移する */
	async gotoMyDishes(): Promise<void> {
		await tapWhenVisible(this.myDishesTab);
	}

	/** マイページタブへ遷移する */
	async gotoProfile(): Promise<void> {
		await tapWhenVisible(this.profileTab);
	}

	/** お知らせタブへ遷移する（ログイン済みユーザー専用） */
	async gotoNotifications(): Promise<void> {
		await tapWhenVisible(this.notificationsTab);
	}

	/**
	 * 匿名ユーザーでも必ず表示される 3 タブが見えていることを検証する。
	 * 「タブレイアウトまで描画が到達した」ことの共通観測点として使う。
	 */
	async expectLoaded(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.searchTab, timeout);
		await waitUntilVisible(this.myDishesTab, timeout);
		await waitUntilVisible(this.profileTab, timeout);
	}

	/**
	 * お知らせタブが表示されているかを **待たずに** 判定する。
	 * 匿名/ログイン済みで可視性が変わるため、アサーションの分岐に使う。
	 */
	async hasNotificationsTab(): Promise<boolean> {
		return existsNow(this.notificationsTab);
	}
}
