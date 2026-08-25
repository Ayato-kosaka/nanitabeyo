import { test, expect } from "../../fixtures/test";
import { TabBar } from "../../pages/TabBar";
import { ProfilePage } from "../../pages/ProfilePage";

/**
 * 👤 マイページ(匿名ユーザー)のテスト
 *
 * 目的: 匿名ユーザーのマイページが「ゲスト表示 + 縦リスト」という
 *       仕様どおりの構成になっていることを保証する（#1402 で 4 グリッドタブから縦リストへ）。
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

	// ─ テストケース: 縦リストが並び、廃止した 4 グリッドタブが残っていない ─
	// #1402 でマイページは「いいね/保存の入口 + 旧設定画面の項目」の縦リストになった。
	// 手順:
	//   1. マイページを表示する
	//   2. 「いいねした投稿」「保存した料理カテゴリ」の行が表示されることを検証
	//   3. 旧グリッドタブ(save-post-tab-grid / review-tab-grid)が DOM に存在しないことを検証
	//      （残っていると横スワイプやディープリンクで到達できてしまう。#1071 と同じ理由）
	test("縦リストが並び、廃止した 4 グリッドタブが残っていない", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const profilePage = new ProfilePage(appPage);

		await tabBar.gotoProfile();
		await expect(profilePage.likedItem).toBeVisible();
		await expect(profilePage.savedDishCategoriesItem).toBeVisible();

		await expect(appPage.getByTestId("save-post-tab-grid")).toHaveCount(0);
		await expect(appPage.getByTestId("review-tab-grid")).toHaveCount(0);
	});

	// ─ テストケース: ゲストでも旧設定画面の項目に到達できる ─
	// #1402 で設定は独立した画面ではなくこの縦リストになった。ログアウト行だけは
	// 匿名ユーザーには出ない（tests/profile/settings.spec.ts が別途見ている）。
	test("旧設定画面の項目が縦リストに並んでいる", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const profilePage = new ProfilePage(appPage);

		await tabBar.gotoProfile();
		await profilePage.expectLoaded();
	});
});
