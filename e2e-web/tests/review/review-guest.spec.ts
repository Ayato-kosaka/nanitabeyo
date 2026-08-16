import { test, expect } from "../../fixtures/test";
import { TabBar } from "../../pages/TabBar";
import { ReviewPage } from "../../pages/ReviewPage";
import { LoginPage } from "../../pages/LoginPage";

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

	// ─ テストケース: CTA タップでログイン画面へ遷移する ─
	// 手順:
	//   1. レビュータブのゲスト表示を開く
	//   2. 「ログインする」ボタンをタップする
	//   3. URL が /auth/login へ変わり、Google/Apple ボタンが表示されることを検証
	//   4. #1359 ブラウザバックでレビュータブへ戻れることを検証(モーダルへ戻す変更を止める)
	test("ログイン CTA タップでログイン画面へ遷移する", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const reviewPage = new ReviewPage(appPage);
		const loginPage = new LoginPage(appPage);

		await tabBar.gotoReview();
		await reviewPage.guestLoginButton.click();
		await loginPage.expectOpened();

		await appPage.goBack();
		await reviewPage.expectGuestViewLoaded();
	});
});
