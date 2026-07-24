import { expect, type Locator, type Page } from "@playwright/test";

/**
 * ⚙️ 設定画面の Page Object
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/profile/settings.tsx
 *
 * - 「レビューを書く」（ストア誘導）は Web では非表示（Platform.OS !== "web" 条件）
 * - 「ログアウト」はログイン済み（非匿名）ユーザーのみ表示
 */
export class SettingsPage {
	readonly page: Page;
	/** 画面タイトル（ja-JP: Settings.title） */
	readonly title: Locator;
	/** ご意見・不具合（フィードバック）行 */
	readonly feedbackItem: Locator;
	/** 利用規約行 */
	readonly termsItem: Locator;
	/** プライバシーポリシー行 */
	readonly privacyItem: Locator;
	/** ブロック済みの料理トピック行 */
	readonly blockedTopicsItem: Locator;
	/** ログアウト行（ログイン済みユーザーのみ表示） */
	readonly logoutItem: Locator;

	constructor(page: Page) {
		this.page = page;
		this.title = page.getByText("設定", { exact: true });
		this.feedbackItem = page.getByTestId("settings-feedback");
		this.termsItem = page.getByTestId("settings-terms");
		this.privacyItem = page.getByTestId("settings-privacy");
		this.blockedTopicsItem = page.getByTestId("settings-blocked-topics");
		this.logoutItem = page.getByTestId("settings-logout");
	}

	/** 指定 URL へ直接遷移する（locale プレフィックス必須） */
	async goto(locale = "ja-JP"): Promise<void> {
		await this.page.goto(`/${locale}/profile/settings`);
	}

	/** 設定画面が表示されていることを検証する */
	async expectLoaded(): Promise<void> {
		await expect(this.title).toBeVisible();
	}
}
