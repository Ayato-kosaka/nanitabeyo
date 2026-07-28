import { launchAppWithSession } from "../../fixtures/e2e";
import { TabBar } from "../../screens/TabBar";
import { ProfileScreen } from "../../screens/ProfileScreen";
import { LoginModal } from "../../screens/LoginModal";

/**
 * 🔑 ログインモーダルのテスト（e2e-web の tests/profile/login-modal.spec.ts に対応）
 *
 * 目的: ログイン導線の入口（モーダル表示・OAuth ボタン・リーガルリンク）を保証する。
 *
 * ## なぜ実 OAuth はテストしないのか
 * ログイン手段は Google/Apple OAuth のみで、外部 IdP のログイン画面は bot 検知により
 * 自動化がブロックされる上、プロバイダの利用規約にも抵触しうる。e2e-web と同じ方針で
 * 「自分のアプリの責務（モーダル表示・遷移開始）」までをテストする。
 * ログイン済み状態のテストは別 PR（launchAppWithSession({ as: "authenticated" })）が担当する。
 */
describe("ログインモーダル", () => {
	beforeAll(async () => {
		await launchAppWithSession({ as: "anon" });
	});

	// ─ テストケース: モーダルに Google/Apple ボタンが表示される ─
	// 手順:
	//   1. マイページのログインボタンをタップする
	//   2. モーダル（login-modal）が開き、login-google-button・login-apple-button が
	//      表示されることを検証
	it("Google/Apple ボタンが表示される", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const loginModal = new LoginModal();

		await tabBar.gotoProfile();
		await profileScreen.openLoginModal();
		await loginModal.expectOpened();
	});

	// ─ テストケース: プライバシーポリシーリンクでリーガルモーダルが開く ─
	// 手順:
	//   1. ログインモーダルを開く
	//   2. 同意文言内のプライバシーポリシーリンク（login-privacy-link）をタップする
	//   3. リーガルドキュメントモーダル（legal-document-modal）が表示されることを検証
	//
	// #1031 【設計確定】B2: e2e-web は「プライバシーポリシー」という同一文字列の出現数（1→3）で
	// 判定しているが、Detox に要素数アサーション API は無いため、PR #1033 で追加された
	// testID（login-privacy-link / legal-document-modal）を使って直接検証する。
	it("プライバシーポリシーリンクでリーガルモーダルが開く", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const loginModal = new LoginModal();

		await tabBar.gotoProfile();
		await profileScreen.openLoginModal();
		await loginModal.expectOpened();

		await loginModal.openPrivacyPolicy();
		await loginModal.expectLegalDocumentOpened();
	});
});
