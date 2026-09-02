import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 🔑 ログイン画面（`/[locale]/auth/login`）の Page Object
 *
 * 対応コンポーネント:
 * - `app-expo/app/[locale]/auth/login.tsx`（ルート本体）
 * - `app-expo/features/auth/components/LoginForm.tsx`（OAuth ボタン・同意文言の実体）
 *
 * ## #1359 モーダルからルートへ移した
 * かつては BlurModal のオーバーレイ（`login-modal`）で、開いても URL はタブのままだった。
 * いまは通常の push なので **URL が `/auth/login` へ変わる**。`expectOpened()` の
 * `toHaveURL` はそれを守る唯一のアサーションで、うっかりモーダルへ戻す変更を赤で止める。
 *
 * ## 戻る導線をコンテナ配下から探さないこと
 * `login-screen` は `LoginForm` の `View` に付いており、`ScreenHeader`（戻るボタン）は
 * **その外側**にある（`app/[locale]/auth/login.tsx`）。戻る導線は `backButton`
 *（`login-screen-back`）か `toHaveURL` で検証する。
 *
 * ## テスト範囲の注意
 * ログイン手段は Google/Apple OAuth のみ。実際の OAuth 遷移は外部 IdP（Google/Apple）の
 * ログイン画面に進むため E2E テストの対象外とする（bot 検知・利用規約の観点でもアンチパターン）。
 * この画面では「表示・ボタンの存在・リーガルリンク・戻る導線」までを検証し、
 * ログイン済み状態のテストはセッション注入（tests/setup/auth.setup.ts）で実現する。
 *
 * ## #1368 同意文言のリンクはモーダルではなく «遷移»
 * リーガル文書は `/[locale]/legal/<doc>` ルートへ push する。遷移先の検証は
 * `pages/LegalPage.ts` が持つ。
 */
export class LoginPage {
	readonly page: Page;
	/** ログインフォームのコンテナ（`LoginForm` の testID） */
	readonly container: Locator;
	/** 画面タイトル（ja-JP: auth.login_title）。ScreenHeader が `${testID}-title` として出す */
	readonly title: Locator;
	/** ヘッダーの戻るボタン（`components/ScreenHeader.tsx`） */
	readonly backButton: Locator;
	/** Google ログインボタン */
	readonly googleButton: Locator;
	/** Apple ログインボタン */
	readonly appleButton: Locator;
	/**
	 * 同意文言内の「利用規約」リンク（#1368 で testID を追加）。
	 *
	 * ⚠️ テキストで探さないこと。遷移先の法務ドキュメント画面ではタイトルと Markdown の見出しが
	 * 同じ文字列になるため、`getByText("利用規約")` は複数ノードへ一致する。
	 */
	readonly termsLink: Locator;
	/** 同意文言内の「プライバシーポリシー」リンク（#1031 で追加） */
	readonly privacyLink: Locator;

	constructor(page: Page) {
		this.page = page;
		this.container = page.getByTestId("login-screen");
		this.title = page.getByTestId("login-screen-title");
		this.backButton = page.getByTestId("login-screen-back");
		this.googleButton = page.getByTestId("login-google-button");
		this.appleButton = page.getByTestId("login-apple-button");
		this.termsLink = page.getByTestId("login-terms-link");
		this.privacyLink = page.getByTestId("login-privacy-link");
	}

	/**
	 * 指定 URL へ直接遷移する（locale プレフィックス必須）。
	 *
	 * 履歴を持たない着地（コールドロード / web の OAuth 全画面リダイレクトからの復帰）を
	 * 再現するために使う。`next` を渡すと `?next=` 付きで開く。
	 */
	async goto(locale = "ja-JP", next?: string): Promise<void> {
		const query = next ? `?next=${encodeURIComponent(next)}` : "";
		await this.page.goto(`/${locale}/auth/login${query}`);
	}

	/** ログイン画面が開いていることを検証する */
	async expectOpened(): Promise<void> {
		// #1359 ルート化そのものを守る唯一のアサーション。モーダルへ戻すと URL が変わらず落ちる
		await expect(this.page).toHaveURL(/\/auth\/login/);
		await expect(this.container).toBeVisible();
		await expect(this.googleButton).toBeVisible();
		await expect(this.appleButton).toBeVisible();
	}

	/** ヘッダーの戻るボタンで離脱する */
	async goBack(): Promise<void> {
		await this.backButton.click();
	}
}
