import { test, expect } from "../../fixtures/test";
import { TabBar } from "../../pages/TabBar";
import { ProfilePage } from "../../pages/ProfilePage";
import { LoginModal } from "../../pages/LoginModal";

/**
 * 🔑 ログインモーダルのテスト
 *
 * 目的: ログイン導線の入口(モーダル表示・OAuth ボタン・リーガルリンク)を保証する。
 *
 * ## なぜ実 OAuth はテストしないのか
 * ログイン手段は Google/Apple OAuth のみで、外部 IdP のログイン画面は bot 検知により
 * 自動化がブロックされる上、プロバイダの利用規約にも抵触しうる。
 * Playwright のベストプラクティスに従い「自分のアプリの責務(モーダル表示・遷移開始)」までを
 * テストし、ログイン済み状態はセッション注入(tests/setup/auth.setup.ts)で作る。
 */
test.describe("ログインモーダル", () => {
	// ─ テストケース: モーダルにタイトルと Google/Apple ボタンが表示される ─
	// 手順:
	//   1. appPage で起動し、マイページのログインボタンをタップする
	//   2. モーダル(login-modal)が開くことを検証
	//   3. タイトル「ログイン」・login-google-button・login-apple-button の表示を検証
	test("タイトルと Google/Apple ボタンが表示される", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const profilePage = new ProfilePage(appPage);
		const loginModal = new LoginModal(appPage);

		await tabBar.gotoProfile();
		await profilePage.openLoginModal();
		await loginModal.expectOpened();
	});

	// ─ テストケース: プライバシーポリシーリンクでリーガルモーダルが開く ─
	// 手順:
	//   1. ログインモーダルを開く
	//   2. 同意文言内の「プライバシーポリシー」リンクをタップする
	//      (「利用規約」はリーガルモーダルのタイトルとしても表示され曖昧になるため、
	//      一意にセレクトできる「プライバシーポリシー」で検証する)
	//   3. 「プライバシーポリシー」の出現数が増える(リーガルモーダルが開く)ことを検証
	//      開いた後は 3 箇所に出現する: ① 同意文言内のリンク自身
	//      ② LegalDocument コンポーネントのタイトル
	//      ③ プライバシーポリシー本文(Markdown)の見出し(# プライバシーポリシー)
	test("プライバシーポリシーリンクでリーガルモーダルが開く", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const profilePage = new ProfilePage(appPage);
		const loginModal = new LoginModal(appPage);

		await tabBar.gotoProfile();
		await profilePage.openLoginModal();
		await loginModal.expectOpened();

		const privacyText = appPage.getByText("プライバシーポリシー", { exact: true });
		await expect(privacyText).toHaveCount(1);

		await loginModal.container.getByText("プライバシーポリシー", { exact: true }).click();
		await expect(privacyText).toHaveCount(3);
	});
});
