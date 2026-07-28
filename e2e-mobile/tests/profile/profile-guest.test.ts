import { strict as assert } from "node:assert";

import { launchAppWithSession } from "../../fixtures/e2e";
import { TabBar } from "../../screens/TabBar";
import { ProfileScreen } from "../../screens/ProfileScreen";

/**
 * 👤 マイページ（匿名ユーザー）のテスト（e2e-web の tests/profile/profile-guest.spec.ts に対応）
 *
 * 目的: 匿名ユーザーのマイページが「ゲスト表示 + 保存系タブのみ」という
 *       仕様どおりの構成になっていることを保証する。
 * ログイン済み前提のテスト（reviews タブの表示等）はこの PR では扱わない（別 PR 担当）。
 */
describe("マイページ（匿名ユーザー）", () => {
	beforeAll(async () => {
		// #1031 【設計】通常の spec は launchAppWithSession({ as: "anon" }) で
		// 匿名サインインのクォータを消費せずに起動する
		await launchAppWithSession({ as: "anon" });
	});

	// ─ テストケース: ゲスト表示（ログインボタン等）が表示される ─
	// 手順:
	//   1. TabBar.gotoProfile() でマイページタブへ遷移する
	//   2. ログインボタン（profile-login-button）が表示されることを検証
	it("ゲスト表示が表示される", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();

		await tabBar.gotoProfile();
		await profileScreen.expectGuestViewLoaded();
	});

	// ─ テストケース: タブが保存系のみで構成される ─
	// 手順:
	//   1. マイページを表示する（デフォルトタブ = 保存した投稿）
	//   2. 保存した投稿タブ（save-post-tab-grid）が表示されることを検証
	//   3. レビュー投稿タブ（review-tab-grid）が存在しないことを検証
	//      （features/profile/containers/ProfileTabsLayout.tsx で isGuest 時は
	//      Tabs.Tab 自体がレンダリングされない仕様。Web 版の toHaveCount(0) に相当）
	it("タブが保存系のみで構成される", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();

		await tabBar.gotoProfile();
		await profileScreen.expectSavedPostsGridVisible();

		const hasReviewsGrid = await profileScreen.hasReviewsGrid();
		assert.equal(hasReviewsGrid, false, "ゲスト時は review-tab-grid が存在しないはず");
	});
});
