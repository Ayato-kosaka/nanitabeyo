import type { Locator, Page } from "@playwright/test";

/**
 * 🧭 ボトムタブバーの Page Object
 *
 * app-expo/app/[locale]/(tabs)/_layout.tsx の `tabBarButtonTestID` に対応する。
 *
 * ## タブ可視性の注意点（アサーション時に必ず考慮すること）
 * - お知らせ (tab-notifications): 匿名ユーザーには非表示（href: null）。
 *   ログイン済みプロジェクトでのみ表示をアサートできる
 * - posts: 常に非表示（内部遷移専用の隠しルート）
 */
export class TabBar {
	readonly page: Page;
	/** さがすタブ */
	readonly searchTab: Locator;
	/** 食べたい/食べたタブ（#1396 でレビュータブから差し替え） */
	readonly myDishesTab: Locator;
	/** マイページタブ */
	readonly profileTab: Locator;
	/** お知らせタブ（ログイン済みユーザーのみ表示） */
	readonly notificationsTab: Locator;
	/** マップタブ（常に非表示 — 存在しないことのアサート用） */

	constructor(page: Page) {
		this.page = page;
		this.searchTab = page.getByTestId("tab-search");
		this.myDishesTab = page.getByTestId("tab-my-dishes");
		this.profileTab = page.getByTestId("tab-profile");
		this.notificationsTab = page.getByTestId("tab-notifications");
	}

	/** さがすタブへ遷移する */
	async gotoSearch(): Promise<void> {
		await this.searchTab.click();
	}

	/** 食べたい/食べたタブへ遷移する */
	async gotoMyDishes(): Promise<void> {
		await this.myDishesTab.click();
	}

	/** マイページタブへ遷移する */
	async gotoProfile(): Promise<void> {
		await this.profileTab.click();
	}

	/** お知らせタブへ遷移する（ログイン済みユーザー専用） */
	async gotoNotifications(): Promise<void> {
		await this.notificationsTab.click();
	}
}
