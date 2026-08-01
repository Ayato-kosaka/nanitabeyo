import { expect, type Locator, type Page } from "@playwright/test";

/**
 * ✏️ 「レビュー」タブの Page Object
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/review/index.tsx
 *
 * 表示内容はログイン状態で分岐する:
 * - 匿名ユーザー: ゲスト向け説明 + ログイン CTA（Review.guest.*）
 * - ログイン済み: レビュー投稿 CTA（Review.authenticated.postButton）
 */
export class ReviewPage {
	readonly page: Page;
	/** 匿名ユーザー向けのゲスト説明文（ja-JP: Review.guest.description） */
	readonly guestDescription: Locator;
	/** 匿名ユーザー向けのログイン CTA ボタン（ja-JP: Review.guest.loginButton） */
	readonly guestLoginButton: Locator;
	/** ログイン済みユーザー向けのレビュー投稿ボタン（ja-JP: Review.authenticated.postButton） */
	readonly postReviewButton: Locator;

	constructor(page: Page) {
		this.page = page;
		this.guestDescription = page.getByText("ログインしてレビューを書こう");
		this.guestLoginButton = page.getByText("ログインする", { exact: true });
		this.postReviewButton = page.getByText("✏️ お店のレビューを投稿しよう");
	}

	/** 指定 URL へ直接遷移する（locale プレフィックス必須） */
	async goto(locale = "ja-JP"): Promise<void> {
		await this.page.goto(`/${locale}/review`);
	}

	/** 匿名ユーザー向けのゲスト表示が出ていることを検証する */
	async expectGuestViewLoaded(): Promise<void> {
		await expect(this.guestDescription).toBeVisible();
	}

	/** ログイン済みユーザー向けの投稿 CTA が出ていることを検証する */
	async expectAuthenticatedViewLoaded(): Promise<void> {
		await expect(this.postReviewButton).toBeVisible();
	}
}
