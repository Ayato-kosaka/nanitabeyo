import { DEFAULT_TIMEOUT, by, element, expect, waitUntilVisible } from "../fixtures/e2e";

/**
 * 🔑 ログインモーダル（BlurModal）の Screen Object（e2e-web の pages/LoginModal.ts に対応）
 *
 * 対応コンポーネント: app-expo/features/profile/components/LoginbackModal.tsx
 *
 * ## テスト範囲の注意
 * ログイン手段は Google/Apple OAuth のみ。実際の OAuth 遷移は外部 IdP（Google/Apple）の
 * ログイン画面に進むため E2E テストの対象外とする（bot 検知・利用規約の観点でもアンチパターン。
 * e2e-web の LoginModal と同じ判断）。このモーダルでは「表示・ボタンの存在・リーガルリンク」までを検証する。
 *
 * ## #1031 B2 → #1027 で方針変更: リーガルモーダルの検証はこの画面では行わない
 * e2e-web（`login-modal.spec.ts`）は同意文言内のリンクをクリックしてリーガルモーダルを開く検証をしている。
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
export class LoginModal {
	/** モーダルのコンテナ（既存 testID） */
	readonly container = by.id("login-modal");
	/** Google ログインボタン（既存 testID） */
	readonly googleButton = by.id("login-google-button");
	/** Apple ログインボタン（既存 testID） */
	readonly appleButton = by.id("login-apple-button");

	/**
	 * ログインモーダルが開いていることを検証する。
	 *
	 * #1027 【バグ】観測点にコンテナ（`login-modal`）を使ってはいけない。
	 * このモーダルはぼかし背景（BlurModal）の上に内容を載せる構成で、iOS の可視判定は
	 * 「面積の 75% 以上が見えていて、かつ他の View に覆われていないこと」を要求するため、
	 * **モーダルが完全に開いていてもコンテナは不可視と判定される**
	 *（run 30460621899 の iOS では、スクリーンショット上は Google/Apple ボタンまで描画済みなのに
	 *  `login-modal` の toBeVisible が 25 秒タイムアウトしていた）。
	 * 検証したいのは「ログイン導線が使える状態か」なので、実体のあるボタンを直接観測する。
	 */
	async expectOpened(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.googleButton, timeout);
		await expect(element(this.appleButton)).toBeVisible();
	}
}
