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
 * ## #1031 【設計確定】B2: リーガルモーダル検証方法の変更
 * e2e-web（`login-modal.spec.ts`）は「プライバシーポリシー」という同一文字列の出現数（1→3）で
 * リーガルモーダルの表示を判定しているが、Detox に要素数アサーション API（`toHaveCount` 相当）は無い。
 * そのため PR #1033 で追加された `login-privacy-link` / `legal-document-modal` の testID を使い、
 * 「リンクをタップ → モーダルの testID が出現する」という直接検証に置き換える。
 */
export class LoginModal {
	/** モーダルのコンテナ（既存 testID） */
	readonly container = by.id("login-modal");
	/** Google ログインボタン（既存 testID） */
	readonly googleButton = by.id("login-google-button");
	/** Apple ログインボタン（既存 testID） */
	readonly appleButton = by.id("login-apple-button");
	/** 同意文言内のプライバシーポリシーリンク（#1031 確定 B2。PR #1033 で testID 追加） */
	readonly privacyLink = by.id("login-privacy-link");
	/** プライバシーポリシーのリーガルドキュメントモーダル（#1031 確定 B2。PR #1033 で testID 追加） */
	readonly legalDocumentModal = by.id("legal-document-modal");

	/** ログインモーダルが開いていることを検証する */
	async expectOpened(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.container, timeout);
		await expect(element(this.googleButton)).toBeVisible();
		await expect(element(this.appleButton)).toBeVisible();
	}

	/** プライバシーポリシーリンクをタップしてリーガルモーダルを開く */
	async openPrivacyPolicy(): Promise<void> {
		await element(this.privacyLink).tap();
	}

	/** リーガルドキュメントモーダルが開いていることを検証する */
	async expectLegalDocumentOpened(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.legalDocumentModal, timeout);
	}
}
