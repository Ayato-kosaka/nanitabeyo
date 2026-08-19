import { test, expect } from "../../fixtures/test";
import { TabBar } from "../../pages/TabBar";
import { ProfilePage } from "../../pages/ProfilePage";
import { SettingsPage } from "../../pages/SettingsPage";

/**
 * 👤 マイページ(ログイン済みユーザー)のテスト
 *
 * 実行プロジェクト: desktop-chrome-authenticated(storageState 注入済み)
 * 前提: e2e-web/.env に TEST_USER_EMAIL / TEST_USER_PASSWORD が設定されていること。
 *       未設定の場合はこの describe 全体をスキップする。
 *
 * ## 注意
 * storageState は同プロジェクトの全テストで共有されるため、
 * 「ログアウトの実行」はセッションを破壊し他テストを巻き込む。
 * ログアウトは「表示されること」の検証にとどめ、実行はしない。
 */
test.skip(
	() => !process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD,
	"TEST_USER_EMAIL / TEST_USER_PASSWORD(e2e-web/.env)が未設定のためスキップ",
);

test.describe("マイページ(ログイン済み)", () => {
	// ─ テストケース: 非匿名ユーザーのプロフィールが表示される ─
	// 手順:
	//   1. "/" で起動(storageState によりログイン済みで起動する)
	//   2. マイページへ遷移し、ログインボタンが表示されないことを検証
	//   3. レビュー投稿タブ(review-tab-grid)が表示されることを検証
	//      (匿名時の保存系のみ構成との差分)
	test("レビュータブを含むプロフィールが表示される", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const profilePage = new ProfilePage(appPage);

		await tabBar.gotoProfile();
		await expect(profilePage.loginButton).toHaveCount(0);
		await expect(profilePage.reviewsGrid).toBeVisible();
	});

	// ─ テストケース: お知らせタブが表示される ─
	// 手順:
	//   1. ログイン済みで起動する
	//   2. タブバーに tab-notifications が表示されることを検証(匿名時は非表示)
	test("お知らせタブが表示される", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		await expect(tabBar.notificationsTab).toBeVisible();
	});

	// ─ テストケース: プロフィール編集がルートとして開き、戻るとマイページへ帰る ─
	// 手順:
	//   1. マイページへ遷移する(ログイン済みなので編集ボタンが出る)
	//   2. 編集ボタンを押し、URL が /profile/edit になることを検証
	//   3. ScreenHeader の戻るを押し、マイページへ帰ることを検証
	//
	// ## なぜ URL を見るのか(#1369)
	// 編集フォームは長らく BlurModal で、URL に何も現れなかった。ルート化の目的は
	// 「編集 UI の寿命 = ルートの寿命」にすることなので、**同じ URL のまま重なって開く**
	// 旧実装へ戻ったらここが赤くなる必要がある。戻る導線まで見るのは、モーダル時代に
	// 「閉じられない」(#498 型)が繰り返し起きた箇所だから。
	test("プロフィール編集がルートとして開き、戻るとマイページへ帰る", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const profilePage = new ProfilePage(appPage);

		await tabBar.gotoProfile();
		await profilePage.openEdit();

		// #1394 ScreenHeader の戻るボタンは `${testID}-back`。共通 id だった頃は、push で背面に残る
		// 画面のヘッダーと 2 件に当たって strict mode violation になった
		await appPage.getByTestId("profile-edit-screen-back").click();
		await expect(appPage).toHaveURL(/\/profile(\?|$)/);
	});

	// ─ テストケース: 設定にログアウトが表示される(実行はしない) ─
	// 手順:
	//   1. ログイン済みで設定画面へ遷移する
	//   2. ログアウト行(settings-logout)が表示されることを検証
	//   3. クリックは行わない(storageState 共有のため — describe コメント参照)
	test("設定にログアウトが表示される", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		await settingsPage.goto();
		await settingsPage.expectLoaded();
		await expect(settingsPage.logoutItem).toBeVisible();
	});
});
