import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 👤 「マイページ」タブの Page Object
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/profile/index.tsx（実体は features/profile/ProfileTabsLayout）
 *
 * タブ構成はログイン状態で分岐する:
 * - 匿名ユーザー: 保存系タブのみ（save-post / save-topic / like）+ ログインボタン表示
 * - ログイン済み: 上記に加えて reviews（投稿）・wallet（入札/収益）タブ
 */
export class ProfilePage {
	readonly page: Page;
	/** 匿名ユーザーに表示されるログインボタン */
	readonly loginButton: Locator;
	/** 保存した投稿グリッド（既存 testID） */
	readonly savedPostsGrid: Locator;
	/** 保存したトピックグリッド（既存 testID） */
	readonly savedTopicsGrid: Locator;
	/** いいねした投稿グリッド（既存 testID） */
	readonly likedGrid: Locator;
	/** 自分のレビュー投稿グリッド（ログイン済みのみ・既存 testID） */
	readonly reviewsGrid: Locator;

	constructor(page: Page) {
		this.page = page;
		this.loginButton = page.getByTestId("profile-login-button");
		this.savedPostsGrid = page.getByTestId("save-post-tab-grid");
		this.savedTopicsGrid = page.getByTestId("save-topic-tab-grid");
		this.likedGrid = page.getByTestId("like-tab-grid");
		this.reviewsGrid = page.getByTestId("review-tab-grid");
	}

	/** 指定 URL へ直接遷移する（locale プレフィックス必須） */
	async goto(locale = "ja-JP"): Promise<void> {
		await this.page.goto(`/${locale}/profile`);
	}

	/** 匿名ユーザー向けのゲスト表示（ログインボタン）が出ていることを検証する */
	async expectGuestViewLoaded(): Promise<void> {
		await expect(this.loginButton).toBeVisible();
	}

	/** ログインボタンを押してログインモーダルを開く（匿名ユーザーのみ） */
	async openLoginModal(): Promise<void> {
		await this.loginButton.click();
	}

	/** 設定画面（歯車アイコン）へ遷移する */
	async gotoSettings(locale = "ja-JP"): Promise<void> {
		// 歯車アイコンに testID が無いため URL 直遷移で代替する
		await this.page.goto(`/${locale}/profile/settings`);
	}
}
