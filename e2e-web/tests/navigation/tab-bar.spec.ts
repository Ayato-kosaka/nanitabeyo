import { test, expect } from "../../fixtures/test";
import { TabBar } from "../../pages/TabBar";
import { SearchPage } from "../../pages/SearchPage";
import { ReviewPage } from "../../pages/ReviewPage";
import { ProfilePage } from "../../pages/ProfilePage";

/**
 * 🧭 タブバーのナビゲーションテスト
 *
 * 目的: ボトムタブの可視性ルール(匿名ユーザーでの表示制御)と、
 *       タブ遷移で各画面が表示されることを保証する。
 */
test.describe("タブバー(匿名ユーザー)", () => {
	// ─ テストケース: 匿名時はさがす/レビュー/マイページの 3 タブのみ表示される ─
	// 手順:
	//   1. appPage で起動(匿名状態)
	//   2. tab-search / tab-review / tab-profile が表示されることを検証
	//   3. tab-notifications(匿名時は href: null)が存在しないことを検証
	test("匿名時に表示されるタブが正しい", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		await expect(tabBar.searchTab).toBeVisible();
		await expect(tabBar.reviewTab).toBeVisible();
		await expect(tabBar.profileTab).toBeVisible();
		await expect(tabBar.notificationsTab).toHaveCount(0);
	});

	// ─ テストケース: タブ遷移で各画面が表示される ─
	// 手順:
	//   1. appPage で起動(初期タブ = さがす)
	//   2. レビュータブ → ゲスト向け表示が出ることを検証
	//   3. マイページタブ → ゲスト表示(ログインボタン)が出ることを検証
	//   4. さがすタブへ戻る → 検索ヘッダが再表示されることを検証
	test("タブ遷移で各画面が表示される", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const searchPage = new SearchPage(appPage);
		const reviewPage = new ReviewPage(appPage);
		const profilePage = new ProfilePage(appPage);

		await tabBar.gotoReview();
		await reviewPage.expectGuestViewLoaded();

		await tabBar.gotoProfile();
		await profilePage.expectGuestViewLoaded();

		await tabBar.gotoSearch();
		await searchPage.expectLoaded();
	});
});
