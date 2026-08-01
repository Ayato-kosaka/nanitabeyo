import { test, expect } from "../../fixtures/test";
import { TabBar } from "../../pages/TabBar";
import { ProfilePage } from "../../pages/ProfilePage";

/**
 * 👤 マイページ(匿名ユーザー)のテスト
 *
 * 目的: 匿名ユーザーのマイページが「ゲスト表示 + 保存系タブのみ」という
 *       仕様どおりの構成になっていることを保証する。
 */
test.describe("マイページ(匿名ユーザー)", () => {
	// ─ テストケース: ゲスト表示(ログインボタン等)が表示される ─
	// 手順:
	//   1. appPage で起動し、マイページタブへ遷移する
	//   2. ログインボタン(profile-login-button)が表示されることを検証
	//   3. ゲスト bio(ja-JP: Profile.guestBio 冒頭「ようこそ、ゲストさん」)が表示されることを検証
	test("ゲスト表示が表示される", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const profilePage = new ProfilePage(appPage);

		await tabBar.gotoProfile();
		await profilePage.expectGuestViewLoaded();
		await expect(appPage.getByText("ようこそ、ゲストさん", { exact: false })).toBeVisible();
	});

	// ─ テストケース: タブが保存系のみで構成される ─
	// 手順:
	//   1. マイページを表示する(デフォルトタブ = 保存した投稿)
	//   2. 保存した投稿タブ(save-post-tab-grid)が表示されることを検証
	//   3. レビュー投稿タブ(review-tab-grid)と wallet 系タブが DOM に存在しないことを検証
	//      (features/profile/containers/ProfileTabsLayout.tsx で isGuest 時は
	//      これらの Tabs.Tab 自体がレンダリングされない仕様)
	test("タブが保存系のみで構成される", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const profilePage = new ProfilePage(appPage);

		await tabBar.gotoProfile();
		await expect(profilePage.savedPostsGrid).toBeVisible();
		await expect(profilePage.reviewsGrid).toHaveCount(0);
	});
});
