import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";
import { ProfilePage } from "../../pages/ProfilePage";

/**
 * 🔗 ディープリンクスモークテスト @smoke
 *
 * 目的: ローカル静的サーバ(scripts/serve-dist.mjs)が本番 Firebase Hosting と同じ
 *       rewrite 挙動([locale] HTML 解決 + SPA fallback)で配信できていること、
 *       つまり「URL 直アクセス」がどの画面でも成立することを保証する。
 * 検証範囲: 代表的な直リンク 2 画面 + 404。
 */
test.describe("ディープリンク @smoke", () => {
	// ─ テストケース: /ja-JP/profile へ直リンクでマイページが表示される ─
	// 手順:
	//   1. page.goto("/ja-JP/profile")(SPA 内遷移ではなく初回ロードで)
	//   2. マイページのゲスト表示(ログインボタン)が表示されることを検証
	test("マイページへの直リンクが表示される", async ({ page }) => {
		const profilePage = new ProfilePage(page);
		await profilePage.goto();
		await profilePage.expectGuestViewLoaded();
	});

	// ─ テストケース: /ja-JP/search へ直リンクで検索画面が表示される ─
	// 手順:
	//   1. page.goto("/ja-JP/search")
	//   2. 検索画面ヘッダが表示されることを検証
	test("検索画面への直リンクが表示される", async ({ page }) => {
		const searchPage = new SearchPage(page);
		await searchPage.goto();
		await searchPage.expectLoaded();
	});

	// ─ テストケース: 存在しないパスで NotFound 画面が表示される ─
	// 手順:
	//   1. page.goto("/ja-JP/this-route-does-not-exist")
	//   2. NotFound 画面(ja-JP: 「おっと！」「この画面は存在しません。」)が表示されることを検証
	//   3. 「ホーム画面へ戻る」リンクが表示されることを検証
	test("存在しないパスで NotFound 画面が表示される", async ({ page }) => {
		await page.goto("/ja-JP/this-route-does-not-exist");
		await expect(page.getByText("この画面は存在しません。")).toBeVisible();
		await expect(page.getByText("ホーム画面へ戻る")).toBeVisible();
	});
});
