import { strict as assert } from "node:assert";

import { describeAuthenticated, launchAppWithSession, waitUntilExists, waitUntilVisible } from "../../fixtures/e2e";
import { ProfileScreen } from "../../screens/ProfileScreen";
import { TabBar } from "../../screens/TabBar";

/**
 * 👤 マイページ（ログイン済みユーザー）のテスト（e2e-web の tests/authenticated/profile-authenticated.spec.ts に対応）
 *
 * 目的: 「匿名かログイン済みか」でしか変わらない UI 分岐が、セッション注入後に
 *       正しくログイン済み側へ倒れていることを保証する。
 *       言い換えると **セッション注入（#1030 A' 案）が実際に効いていること**の回帰テストでもある。
 *
 * ## この spec が tests/profile/profile-guest.test.ts と対になっている理由
 * 匿名側は「ログインボタンがある / reviews タブが無い」を検証している。ここではその真逆
 * （ログインボタンが無い / reviews タブがある）を検証することで、分岐の両側を押さえる。
 * 片側だけだと「常にゲスト表示」でもテストが緑になってしまう。
 *
 * ## TEST_USER_* が無い環境では spec ごと skip される
 * `describeAuthenticated` は fixtures/e2e.ts が `isAuthenticatedAvailable()` で切り替える
 * （#1030 3-3）。fork PR や初見のローカルでも run 全体を壊さない。
 *
 * ## 書き込みは行わない（Tier 2 の境界）
 * ここは読み取り専用のアサーションのみに留める。とくに **「お知らせ」タブは開かない**:
 * 通知一覧画面は入場時に markAllAsRead() で共有 dev DB の既読状態を書き換えるため、
 * タップは Tier 3（@mutation）の領分になる。ここではタブの「表示有無」だけを見る。
 */
describeAuthenticated("マイページ（ログイン済みユーザー）", () => {
	// #1031 【バグ】beforeAll だと前のテストが残した画面状態（開いたままのモーダル等）を次が引き継ぎ、
	// タップがオーバーレイに阻まれて落ちる。セッション注入起動は匿名クォータを消費しないため
	// （fixtures/e2e.ts の launchAppWithSession）、テストごとに起動し直して独立性を担保する
	beforeEach(async () => {
		await launchAppWithSession({ as: "authenticated" });
	});

	// ─ テストケース: ゲスト表示ではなく編集ボタンつきのマイページが表示される ─
	//
	// #1402 【変更】旧版は «レビュー投稿タブ（review-tab-grid）が出ること» を匿名との差分にしていたが、
	// 4 グリッドタブは廃止された。ログイン済みかどうかの差は
	// «ログインボタンではなく編集ボタンが出る» と «ログアウト行がある» の 2 つになった。
	// 手順:
	//   1. TabBar.gotoProfile() でマイページタブへ遷移する
	//   2. 縦リストの描画完了を待つ
	//   3. ログインボタン（profile-login-button）が存在しないことを検証
	//   4. 編集ボタン（profile-edit-button）が存在することを検証（匿名側 spec の裏返し）
	it("ゲスト表示ではなく編集ボタンつきのマイページが表示される", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();

		await tabBar.gotoProfile();

		// 先に縦リストの描画を待つ。描画完了を待たずに存在有無を判定すると、
		// 「まだ描画されていないだけ」を「ゲスト表示ではない」と誤って解釈しうるため。
		// #1027 `toBeVisible` ではなく存在で見る（iOS は面積の 75% 可視を要求する。ProfileScreen 参照）
		await profileScreen.expectLoaded();
		await waitUntilExists(profileScreen.editButton);

		const hasLoginButton = await profileScreen.hasLoginButton();
		assert.equal(hasLoginButton, false, "ログイン済みでは profile-login-button が存在しないはず");
	});

	// ─ テストケース: 縦リストからいいね・保存の一覧へ遷移できる ─
	// #1402 の本体。4 グリッドタブの代わりに縦リストの行から «独立した画面» を開く。
	it("縦リストからいいね・保存の一覧へ遷移できる", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();

		await tabBar.gotoProfile();
		await profileScreen.expectLoaded();

		await profileScreen.openLiked();
		// #1027 グリッドは 0 件だと面積を持たないため存在で見る
		await waitUntilExists(profileScreen.likedGrid);

		await tabBar.gotoProfile();
		await profileScreen.openSavedDishCategories();
		await waitUntilExists(profileScreen.savedDishCategoriesGrid);
	});

	// ─ テストケース: ログイン済みのときだけ表示される「お知らせ」タブが表示される ─
	// 手順:
	//   1. 匿名でも必ず出る 3 タブの表示を待ち、タブレイアウトの描画完了を確認する
	//   2. お知らせタブ（tab-notifications）が表示されていることを検証
	//      （匿名ユーザーには href: null で非表示。tests/navigation/tab-bar.test.ts の裏返し）
	// 注意: ここでタップして遷移すると通知が全件既読になる（dev DB への書き込み）ため、表示のみ検証する
	it("ログイン済みのときだけ表示されるお知らせタブが表示される", async () => {
		const tabBar = new TabBar();

		await tabBar.expectLoaded();
		await waitUntilVisible(tabBar.notificationsTab);
	});
});
