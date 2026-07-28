import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 🔑 ログインモーダル（BlurModal）の Page Object
 *
 * 対応コンポーネント: app-expo/features/profile/components/LoginbackModal.tsx
 *
 * ## テスト範囲の注意
 * ログイン手段は Google/Apple OAuth のみ。実際の OAuth 遷移は外部 IdP（Google/Apple）の
 * ログイン画面に進むため E2E テストの対象外とする（bot 検知・利用規約の観点でもアンチパターン）。
 * このモーダルでは「表示・ボタンの存在・リーガルリンク」までを検証し、
 * ログイン済み状態のテストはセッション注入（tests/setup/auth.setup.ts）で実現する。
 */
export class LoginModal {
	readonly page: Page;
	/** モーダルのコンテナ */
	readonly container: Locator;
	/** モーダルタイトル（ja-JP: auth.login_title） */
	readonly title: Locator;
	/** Google ログインボタン */
	readonly googleButton: Locator;
	/** Apple ログインボタン */
	readonly appleButton: Locator;

	constructor(page: Page) {
		this.page = page;
		this.container = page.getByTestId("login-modal");
		this.title = this.container.getByText("ログイン", { exact: true });
		this.googleButton = page.getByTestId("login-google-button");
		this.appleButton = page.getByTestId("login-apple-button");
	}

	/** ログインモーダルが開いていることを検証する */
	async expectOpened(): Promise<void> {
		await expect(this.container).toBeVisible();
		await expect(this.googleButton).toBeVisible();
		await expect(this.appleButton).toBeVisible();
	}
}
