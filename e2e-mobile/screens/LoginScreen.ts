import { DEFAULT_TIMEOUT, by, element, expect, tapWhenVisible, waitUntilVisible } from "../fixtures/e2e";

/**
 * 🔑 ログイン画面（`/[locale]/auth/login`）の Screen Object（e2e-web の pages/LoginPage.ts に対応）
 *
 * 対応コンポーネント:
 * - `app-expo/app/[locale]/auth/login.tsx`（ルート本体）
 * - `app-expo/features/auth/components/LoginForm.tsx`（OAuth ボタン・同意文言の実体）
 *
 * ## テスト範囲の注意
 * ログイン手段は Google/Apple OAuth のみ。実際の OAuth 遷移は外部 IdP（Google/Apple）の
 * ログイン画面に進むため E2E テストの対象外とする（bot 検知・利用規約の観点でもアンチパターン。
 * e2e-web の LoginPage と同じ判断）。この画面では「表示・ボタンの存在・戻る導線」までを検証する。
 *
 * ## #1031 B2 → #1027 で方針変更: リーガルモーダルの検証はこの画面では行わない
 * e2e-web（`login-screen.spec.ts`）は同意文言内のリンクをクリックしてリーガルモーダルを開く検証をしている。
 * ネイティブでも同じことをしようと `login-privacy-link` を app-expo に追加したが、**この testID は
 * ネイティブでは効かない**。同意文言はリンク部分を `<Text>` の入れ子で表現しており、React Native は
 * 入れ子の `<Text>` を仮想ノード（Android: ReactVirtualTextShadowNode）として親の TextView に畳み込むため、
 * **リンクに対応するネイティブ View が存在しない**（run 30432596949 の Espresso は
 * "No views in hierarchy found matching: view.getTag() is \"login-privacy-link\"" を返した）。
 * web では span + data-testid として実在するので e2e-web 側の検証は有効なまま。
 *
 * ネイティブでは代わりに **設定画面のリーガル行**（`settings-privacy` = 実体のある行）から
 * 同じ `legal-document-modal` を開く経路で検証する（tests/profile/settings.test.ts）。
 */
export class LoginScreen {
	/** ログインフォームのコンテナ（`LoginForm` の testID） */
	readonly container = by.id("login-screen");
	/** 画面タイトル（ScreenHeader が `${testID}-title` として付ける） */
	readonly title = by.id("login-screen-title");
	/** ヘッダーの戻るボタン（`components/ScreenHeader.tsx`） */
	readonly backButton = by.id("screen-header-back");
	/** Google ログインボタン */
	readonly googleButton = by.id("login-google-button");
	/** Apple ログインボタン */
	readonly appleButton = by.id("login-apple-button");

	/**
	 * ログイン画面が開いていることを検証する。
	 *
	 * #1027 観測点にはコンテナではなく **実体のあるボタン**を使う。
	 * BlurModal 時代はぼかし背景で iOS の 75% 可視判定を満たせないという固有の事情もあったが、
	 * ルート化でその制約は消えた。それでもボタンを見るのは、
	 * 検証したいのが「ログイン導線が使える状態か」であり、実体のある要素を見るのが最も壊れにくいため。
	 */
	async expectOpened(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.googleButton, timeout);
		await expect(element(this.appleButton)).toBeVisible();
	}

	/** ヘッダーの戻るボタンをタップして離脱する */
	async goBack(): Promise<void> {
		await tapWhenVisible(this.backButton);
	}
}
