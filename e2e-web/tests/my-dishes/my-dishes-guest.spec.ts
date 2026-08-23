import { test, expect } from "../../fixtures/test";
import { TabBar } from "../../pages/TabBar";
import { MyDishesPage } from "../../pages/MyDishesPage";
import { LoginPage } from "../../pages/LoginPage";

/**
 * 🍽️ 食べたい/食べたタブ(匿名ユーザー)のテスト（#1396 でレビュータブから差し替え）
 *
 * 目的: 匿名ユーザーに対する「ログインへの導線」が機能していることを保証する。
 *
 * #1375 実機確認: **タブの中身はゲストにも開いている。** 「食べたい」＝
 * `reactions(action_type='save')` は匿名ユーザーでも書けるので、保存はできるのに保存したものを
 * 見られない、という状態を作らない。ログイン導線は一覧を塞がず、上に細い帯として出る。
 */
test.describe("食べたい/食べたタブ(匿名ユーザー)", () => {
	// ─ テストケース: ゲスト向け説明とログイン CTA が表示される ─
	// 手順:
	//   1. appPage で起動し、食べたい/食べたタブへ遷移する
	//   2. ゲスト説明文（testID: my-dishes-guest-description）が表示されることを検証
	//   3. ログイン CTA（testID: my-dishes-guest-login-button）が表示されることを検証
	//   4. #1375 **一覧が塞がれていない**ことを検証（帯は中身の上に出るだけ）
	//   5. #1375 記録 CTA（＋）がゲストにも出ることを検証（押下先は SNS 取り込み）
	test("ゲスト向け説明とログイン CTA が、一覧を塞がずに表示される", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const myDishesPage = new MyDishesPage(appPage);

		await tabBar.gotoMyDishes();
		await myDishesPage.expectGuestCanSeeContent();
		await expect(myDishesPage.guestLoginButton).toBeVisible();
		await expect(myDishesPage.recordButton).toBeVisible();
	});

	// ─ テストケース: CTA タップでログイン画面へ遷移する ─
	// 手順:
	//   1. 食べたい/食べたタブのゲスト表示を開く
	//   2. 「ログインする」ボタンをタップする
	//   3. URL が /auth/login へ変わり、Google/Apple ボタンが表示されることを検証
	//   4. #1359 ブラウザバックで食べたい/食べたタブへ戻れることを検証(モーダルへ戻す変更を止める)
	test("ログイン CTA タップでログイン画面へ遷移する", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const myDishesPage = new MyDishesPage(appPage);
		const loginPage = new LoginPage(appPage);

		await tabBar.gotoMyDishes();
		await myDishesPage.guestLoginButton.click();
		await loginPage.expectOpened();

		await appPage.goBack();
		await myDishesPage.expectGuestCanSeeContent();
	});
});
