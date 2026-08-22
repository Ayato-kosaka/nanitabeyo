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
 * ## #1031 B2 → #1027 で方針変更: リーガル導線の検証はこの画面では行わない
 * e2e-web（`login-screen.spec.ts`）は同意文言内のリンクをクリックして法務ドキュメントへ遷移する検証をしている。
 * ネイティブでも同じことをしようと `login-privacy-link` を app-expo に追加したが、**この testID は
 * ネイティブでは効かない**。同意文言はリンク部分を `<Text>` の入れ子で表現しており、React Native は
 * 入れ子の `<Text>` を仮想ノード（Android: ReactVirtualTextShadowNode）として親の TextView に畳み込むため、
 * **リンクに対応するネイティブ View が存在しない**（run 30432596949 の Espresso は
 * "No views in hierarchy found matching: view.getTag() is \"login-privacy-link\"" を返した）。
 * web では span + data-testid として実在するので e2e-web 側の検証は有効なまま。
 * #1368 で `login-terms-link` も追加したが、同じ理由でネイティブからは到達できない。
 *
 * ネイティブでは代わりに **設定画面のリーガル行**（`settings-privacy` = 実体のある行）から
 * 同じ `/[locale]/legal/<doc>` へ遷移する経路で検証する
 *（tests/profile/settings.test.ts / tests/profile/legal.test.ts）。
 */
export class LoginScreen {
	/**
	 * ログインフォームのコンテナ（`LoginForm` の testID）。
	 *
	 * ⚠️ `expectOpened()` では使わない。コンテナは中身が空でも「見えている」ため、
	 * 可視判定の観測点としては実体のあるボタン / タイトルの方が壊れにくい（#1027）。
	 */
	readonly container = by.id("login-screen");
	/** 画面タイトル（ScreenHeader が `${testID}-title` として付ける） */
	readonly title = by.id("login-screen-title");
	/** ヘッダーの戻るボタン（`components/ScreenHeader.tsx`） */
	// #1404 ScreenHeader の戻るボタンは `${testID}-back`。共通 id だった頃は、push で背面に残る
	// 画面のヘッダーと同じ id になり «背面を押していた»
	readonly backButton = by.id("login-screen-back");
	/** Google ログインボタン */
	readonly googleButton = by.id("login-google-button");
	/** Apple ログインボタン */
	readonly appleButton = by.id("login-apple-button");
	/**
	 * ヘッダー右の「スキップ」。
	 *
	 * #1486 §4【設計】**オンボーディング経由のときだけ描画される**（`?skippable=1`）。
	 * 口コミ投稿・プロフィール・店舗詳細からのログイン導線では出ない。
	 * 「ログインが要るから来ている」画面を素通りできてしまわないようにするためで、
	 * この spec でもその出し分けごと検証している（tests/search/onboarding.test.ts）。
	 */
	readonly skipButton = by.id("login-screen-skip");

	/**
	 * ログイン画面が開いていることを検証する。
	 *
	 * #1027 観測点にはコンテナではなく **実体のあるボタン**を使う。
	 * BlurModal 時代はぼかし背景で iOS の 75% 可視判定を満たせないという固有の事情もあったが、
	 * ルート化でその制約は消えた。それでもボタンを見るのは、
	 * 検証したいのが「ログイン導線が使える状態か」であり、実体のある要素を見るのが最も壊れにくいため。
	 *
	 * #1359 【設計】ボタンに加えて `title` も見る。これは **「ルートであること」を守るための固定**。
	 * `login-screen-title` は ScreenHeader（`app-expo/components/ScreenHeader.tsx`）が
	 * `${testID}-title` として出すもので、**BlurModal 実装には存在しない**。
	 * ボタンだけを見ていると、ログイン UI をオーバーレイへ戻す変更を通してしまう
	 *（#498 の再発）。e2e-web は `toHaveURL(/\/auth\/login/)`（pages/LoginPage.ts）が
	 * 同じ役目を負っていて、mobile 側にだけその固定が無かった。
	 */
	async expectOpened(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.googleButton, timeout);
		await expect(element(this.appleButton)).toBeVisible();
		await expect(element(this.title)).toBeVisible();
	}

	/** ヘッダーの戻るボタンをタップして離脱する */
	async goBack(): Promise<void> {
		await tapWhenVisible(this.backButton);
	}

	/** ヘッダー右の「スキップ」をタップして、ログインせずに `next` の行き先へ進む（#1486 §4） */
	async skip(): Promise<void> {
		await tapWhenVisible(this.skipButton);
	}
}
