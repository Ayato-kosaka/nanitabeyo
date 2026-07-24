import { test, expect } from "../../fixtures/test";
import { TabBar } from "../../pages/TabBar";
import { ReviewPage } from "../../pages/ReviewPage";
import { LoginModal } from "../../pages/LoginModal";

/**
 * ✏️ レビュータブ(匿名ユーザー)のテスト
 *
 * 目的: 匿名ユーザーに対する「ログインへの導線」が機能していることを保証する。
 */
test.describe("レビュータブ(匿名ユーザー)", () => {
	// ─ テストケース: ゲスト向け説明とログイン CTA が表示される ─
	// 手順:
	//   1. appPage で起動し、レビュータブへ遷移する
	//   2. ゲスト説明文「ログインしてレビューを書こう」が表示されることを検証
	//   3. 「ログインする」ボタンが表示されることを検証
	test("ゲスト向け説明とログイン CTA が表示される", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const reviewPage = new ReviewPage(appPage);

		await tabBar.gotoReview();
		await reviewPage.expectGuestViewLoaded();
		await expect(reviewPage.guestLoginButton).toBeVisible();
	});

	// ─ テストケース: CTA タップでログインモーダルが開く ─
	// 手順:
	//   1. レビュータブのゲスト表示を開く
	//   2. 「ログインする」ボタンをタップする
	//   3. ログインモーダル(login-modal)が開き、Google/Apple ボタンが表示されることを検証
	test("ログイン CTA タップでログインモーダルが開く", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const reviewPage = new ReviewPage(appPage);
		const loginModal = new LoginModal(appPage);

		await tabBar.gotoReview();
		await reviewPage.guestLoginButton.click();
		await loginModal.expectOpened();
	});
});
