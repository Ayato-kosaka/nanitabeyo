import { strict as assert } from "node:assert";

import { launchAppWithSession, waitUntilExists } from "../../fixtures/e2e";
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
	// #1031 【バグ】beforeAll だと前のテストが残した画面状態(開いたままのモーダル等)を次が引き継ぎ、
	// タップがオーバーレイに阻まれて落ちる。セッション注入起動は匿名クォータを消費しないため
	// (fixtures/e2e.ts の launchAppWithSession)、テストごとに起動し直して独立性を担保する
	beforeEach(async () => {
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

	// ─ テストケース: 縦リストが並び、廃止した 4 グリッドタブが残っていない ─
	// #1402 でマイページは「いいね/保存の入口 + 旧設定画面の項目」の縦リストになった。
	// 手順:
	//   1. マイページを表示する
	//   2. 「いいねした投稿」「保存した料理カテゴリ」の行が存在することを検証
	//   3. 旧グリッドタブ（review-tab-grid / save-post-tab-grid）が存在しないことを検証
	//      （残っていると横スワイプやディープリンクで到達できてしまう。Web 版の toHaveCount(0) に相当）
	it("縦リストが並び、廃止した 4 グリッドタブが残っていない", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();

		await tabBar.gotoProfile();
		// #1027 と同じ理由で存在（toExist）で見る。iOS の可視判定は面積の 75% を要求する
		await profileScreen.expectLoaded();
		await waitUntilExists(profileScreen.savedDishCategoriesItem);

		const hasLegacyGridTabs = await profileScreen.hasLegacyGridTabs();
		assert.equal(hasLegacyGridTabs, false, "#1402 で廃止した 4 グリッドタブが残っている");
	});
});
