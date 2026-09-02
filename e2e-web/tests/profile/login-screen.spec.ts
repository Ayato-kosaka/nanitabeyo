import { test, expect } from "../../fixtures/test";
import { TabBar } from "../../pages/TabBar";
import { ProfilePage } from "../../pages/ProfilePage";
import { LoginPage } from "../../pages/LoginPage";
import { LegalPage } from "../../pages/LegalPage";

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
	//   3. タイトル「アカウントを作成しましょう」・login-google-button・login-apple-button の表示を検証
	test("タイトルと Google/Apple ボタンが表示される", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const profilePage = new ProfilePage(appPage);
		const loginPage = new LoginPage(appPage);

		await tabBar.gotoProfile();
		await profilePage.openLogin();
		await loginPage.expectOpened();
		// #1486 見出しはクラシル型の「アカウントを作成しましょう」へ変わった（ScreenHeader は撤去済み）
		await expect(loginPage.title).toHaveText("アカウントを作成しましょう");
	});

	// ─ テストケース: 同意文言のリンクで法務ドキュメント画面へ «遷移» する ─
	// #1368 【設計】ここはモーダル→ルートの乗り換えを守る検証。
	// かつては「プライバシーポリシー」というテキストの出現数が 1 → 3 に増えること
	// (① 同意文言のリンク ② モーダルのタイトル ③ Markdown の見出し) で
	// «オーバーレイが重なった» ことを見ていた。ルート化後は URL が変わるので、
	// 出現数ではなく URL と本文コンテナで見る。モーダルへ戻すと URL が変わらず落ちる。
	// 手順:
	//   1. ログイン画面を開く
	//   2. 同意文言内の「プライバシーポリシー」リンクをクリックする
	//   3. URL が /legal/privacy へ変わり、本文が表示されることを検証
	//   4. 戻るボタンでログイン画面へ帰れることを検証（同意文言から離脱したまま戻れないと投稿導線が詰まる）
	test("プライバシーポリシーリンクで法務ドキュメント画面へ遷移し、戻れる", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const profilePage = new ProfilePage(appPage);
		const loginPage = new LoginPage(appPage);
		const legalPage = new LegalPage(appPage);

		await tabBar.gotoProfile();
		await profilePage.openLogin();
		await loginPage.expectOpened();

		await loginPage.privacyLink.click();
		await legalPage.expectOpened("privacy");

		await legalPage.goBack();

		await loginPage.expectOpened();
	});

	// ─ テストケース: 利用規約リンクも同じルートの別 doc へ遷移する ─
	// #1368 2 つのリンクは同じハンドラを通るため、doc の取り違えは «リンクごと» に見ないと分からない
	// 手順:
	//   1. ログイン画面を開く
	//   2. 同意文言内の「利用規約」リンクをクリックする
	//   3. URL が /legal/terms へ変わることを検証
	test("利用規約リンクは /legal/terms へ遷移する", async ({ appPage }) => {
		const loginPage = new LoginPage(appPage);
		const legalPage = new LegalPage(appPage);

		await loginPage.goto();
		await loginPage.expectOpened();

		await loginPage.termsLink.click();
		await legalPage.expectOpened("terms");
	});

	// ─ テストケース: ブラウザバックでマイページへ戻る ─
	// #1359 【設計】§1 の「未確認」を CI で固定する唯一の手段。
	// 「`(tabs)` の上に push しても React ツリーから外れない」は native-stack の構造からの
	// 推論でしかなく、実ブラウザで確かめていない。ここで固定する。
	//
	// #1402 【変更】旧版は «いいねタブへ切り替えてから push し、戻ってもタブの選択が残ること» を
	// 見ていた。4 グリッドタブが廃止され «選択タブ» という状態自体が無くなったので、
	// 戻り先がマイページであることと、その中身（縦リスト）が描かれ直していることを見る。
	// 手順:
	//   1. マイページを開く
	//   2. ログインボタンでログイン画面へ push する
	//   3. ブラウザバックする
	//   4. URL が /ja-JP/profile へ戻り、縦リストが出たままであることを検証
	test("ブラウザバックでマイページへ戻る", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const profilePage = new ProfilePage(appPage);
		const loginPage = new LoginPage(appPage);

		await tabBar.gotoProfile();
		await profilePage.expectGuestViewLoaded();

		await profilePage.openLogin();
		await loginPage.expectOpened();

		await appPage.goBack();

		await expect(appPage).toHaveURL(/\/ja-JP\/profile/);
		await profilePage.expectLoaded();
		await expect(profilePage.loginButton).toBeVisible();
	});

	// ─ テストケース: ?next= 付き URL へ直接着地しても戻る導線が効く ─
	// #1359 【設計】§2 の (B)。履歴が無い着地(コールドロード / web の OAuth 全画面リダイレクト)では
	// `router.canGoBack()` が false になり、`?next=` が行き先になる。
	// OAuth を通さずに next を検証できる唯一の形。
	// 手順:
	//   1. /ja-JP/auth/login?next=%2Fja-JP%2Fmy-dishes へ直接遷移する
	//   2. ログイン画面が表示されることを検証
	//   3. ヘッダーの戻るボタンを押す
	//   4. 食べたい/食べたタブ(/ja-JP/my-dishes)へ着地することを検証
	test("?next= 付きで直接着地し、戻る導線で next の画面へ進む", async ({ appPage }) => {
		const loginPage = new LoginPage(appPage);

		await loginPage.goto("ja-JP", "/ja-JP/my-dishes");
		await loginPage.expectOpened();

		await loginPage.goBack();

		await expect(appPage).toHaveURL(/\/ja-JP\/my-dishes/);
	});
});
