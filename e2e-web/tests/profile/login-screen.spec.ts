import { test, expect } from "../../fixtures/test";
import { TabBar } from "../../pages/TabBar";
import { ProfilePage } from "../../pages/ProfilePage";
import { LoginPage } from "../../pages/LoginPage";

/**
 * 🔑 ログイン画面のテスト
 *
 * 目的: ログイン導線の入口(画面遷移・OAuth ボタン・リーガルリンク・復帰)を保証する。
 *
 * ## なぜ実 OAuth はテストしないのか
 * ログイン手段は Google/Apple OAuth のみで、外部 IdP のログイン画面は bot 検知により
 * 自動化がブロックされる上、プロバイダの利用規約にも抵触しうる。
 * Playwright のベストプラクティスに従い「自分のアプリの責務(画面遷移・遷移開始)」までを
 * テストし、ログイン済み状態はセッション注入(tests/setup/auth.setup.ts)で作る。
 *
 * ## #1359 モーダルからルートへ移した
 * ここが守るのは「ログイン UI の寿命 = ルートの寿命」という構造そのもの。
 * `expectOpened()` の `toHaveURL` と、下の「ブラウザバックで戻れる」検証が、
 * オーバーレイへ戻す変更を赤で止める。
 */
test.describe("ログイン画面", () => {
	// ─ テストケース: 画面にタイトルと Google/Apple ボタンが表示される ─
	// 手順:
	//   1. appPage で起動し、マイページのログインボタンをタップする
	//   2. URL が /auth/login へ変わり、login-screen が表示されることを検証
	//   3. タイトル「ログイン」・login-google-button・login-apple-button の表示を検証
	test("タイトルと Google/Apple ボタンが表示される", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const profilePage = new ProfilePage(appPage);
		const loginPage = new LoginPage(appPage);

		await tabBar.gotoProfile();
		await profilePage.openLogin();
		await loginPage.expectOpened();
		await expect(loginPage.title).toHaveText("ログイン");
	});

	// ─ テストケース: プライバシーポリシーリンクでリーガルモーダルが開く ─
	// 手順:
	//   1. ログイン画面を開く
	//   2. 同意文言内の「プライバシーポリシー」リンクをタップする
	//      (「利用規約」はリーガルモーダルのタイトルとしても表示され曖昧になるため、
	//      一意にセレクトできる「プライバシーポリシー」で検証する)
	//   3. 「プライバシーポリシー」の出現数が増える(リーガルモーダルが開く)ことを検証
	//      開いた後は 3 箇所に出現する: ① 同意文言内のリンク自身
	//      ② LegalDocument コンポーネントのタイトル
	//      ③ プライバシーポリシー本文(Markdown)の見出し(# プライバシーポリシー)
	//      #1359 LegalDocumentModal は BlurModal のまま(B 群は別 Issue)なので内訳は変わらない
	test("プライバシーポリシーリンクでリーガルモーダルが開く", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const profilePage = new ProfilePage(appPage);
		const loginPage = new LoginPage(appPage);

		await tabBar.gotoProfile();
		await profilePage.openLogin();
		await loginPage.expectOpened();

		const privacyText = appPage.getByText("プライバシーポリシー", { exact: true });
		await expect(privacyText).toHaveCount(1);

		await loginPage.container.getByText("プライバシーポリシー", { exact: true }).click();
		await expect(privacyText).toHaveCount(3);
	});

	// ─ テストケース: ブラウザバックでマイページへ戻り、タブの選択が保たれる ─
	// #1359 【設計】§1 の「未確認」を CI で固定する唯一の手段。
	// 「`(tabs)` の上に push しても React ツリーから外れないのでタブの選択は保たれる」は
	// native-stack の構造からの推論でしかなく、実ブラウザで確かめていない。ここで固定する。
	// 手順:
	//   1. マイページで「いいね」タブへ切り替える
	//   2. ログインボタンでログイン画面へ push する
	//   3. ブラウザバックする
	//   4. URL が /ja-JP/profile へ戻り、「いいね」タブの内容が出たままであることを検証
	test("ブラウザバックでマイページへ戻り、選択していたタブが保たれる", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const profilePage = new ProfilePage(appPage);
		const loginPage = new LoginPage(appPage);

		await tabBar.gotoProfile();
		await profilePage.expectGuestViewLoaded();

		await appPage.getByTestId("profile-tab-group-liked").click();
		await expect(profilePage.likedGrid).toBeVisible();

		await profilePage.openLogin();
		await loginPage.expectOpened();

		await appPage.goBack();

		await expect(appPage).toHaveURL(/\/ja-JP\/profile/);
		await expect(profilePage.likedGrid).toBeVisible();
	});

	// ─ テストケース: ?next= 付き URL へ直接着地しても戻る導線が効く ─
	// #1359 【設計】§2 の (B)。履歴が無い着地(コールドロード / web の OAuth 全画面リダイレクト)では
	// `router.canGoBack()` が false になり、`?next=` が行き先になる。
	// OAuth を通さずに next を検証できる唯一の形。
	// 手順:
	//   1. /ja-JP/auth/login?next=%2Fja-JP%2Freview へ直接遷移する
	//   2. ログイン画面が表示されることを検証
	//   3. ヘッダーの戻るボタンを押す
	//   4. レビュータブ(/ja-JP/review)へ着地することを検証
	test("?next= 付きで直接着地し、戻る導線で next の画面へ進む", async ({ appPage }) => {
		const loginPage = new LoginPage(appPage);

		await loginPage.goto("ja-JP", "/ja-JP/review");
		await loginPage.expectOpened();

		await loginPage.goBack();

		await expect(appPage).toHaveURL(/\/ja-JP\/review/);
	});
});
