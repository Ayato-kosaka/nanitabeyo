import { test, expect } from "../../fixtures/test";
import { TabBar } from "../../pages/TabBar";
import { SearchPage } from "../../pages/SearchPage";
import { MyDishesPage } from "../../pages/MyDishesPage";
import { ProfilePage } from "../../pages/ProfilePage";

/**
 * 🧭 タブバーのナビゲーションテスト
 *
 * 目的: ボトムタブの可視性ルール(匿名ユーザーでの表示制御)と、
 *       タブ遷移で各画面が表示されることを保証する。
 */
test.describe("タブバー(匿名ユーザー)", () => {
	// ─ テストケース: 匿名時はさがす/食べたい・食べた/マイページの 3 タブのみ表示される ─
	// 手順:
	//   1. appPage で起動(匿名状態)
	//   2. tab-search / tab-my-dishes / tab-profile が表示されることを検証
	//   3. tab-notifications(匿名時は href: null)が存在しないことを検証
	//      tab-map は #1419 でタブごと削除されたので、もう «非表示» ですらない
	test("匿名時に表示されるタブが正しい", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		await expect(tabBar.searchTab).toBeVisible();
		await expect(tabBar.myDishesTab).toBeVisible();
		await expect(tabBar.profileTab).toBeVisible();
		await expect(tabBar.notificationsTab).toHaveCount(0);
	});

	// ─ テストケース: タブ遷移で各画面が表示される ─
	// 手順:
	//   1. appPage で起動(初期タブ = さがす)
	//   2. 食べたい/食べたタブ → ゲスト向け表示が出ることを検証
	//   3. マイページタブ → ゲスト表示(ログインボタン)が出ることを検証
	//   4. さがすタブへ戻る → 検索ヘッダが再表示されることを検証
	test("タブ遷移で各画面が表示される", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const searchPage = new SearchPage(appPage);
		const myDishesPage = new MyDishesPage(appPage);
		const profilePage = new ProfilePage(appPage);

		await tabBar.gotoMyDishes();
		await myDishesPage.expectGuestViewLoaded();

		await tabBar.gotoProfile();
		await profilePage.expectGuestViewLoaded();

		await tabBar.gotoSearch();
		await searchPage.expectLoaded();
	});
});
