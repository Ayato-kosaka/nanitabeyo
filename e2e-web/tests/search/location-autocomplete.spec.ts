import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";

/**
 * 📍 場所オートコンプリートのテスト(実 API)
 *
 * 目的: 「静的ビルド → CORS プリフライト → Supabase 匿名 JWT → NestJS API → Google Places」
 *       というフル E2E 経路が疎通していることを保証する、最重要のスモーク的機能テスト。
 * 前提: api-development の CORS_ORIGIN にテストオリジン(http://localhost:4173)が
 *       含まれていること(e2e-web/README.md の運用手順を参照)。
 */
test.describe("場所オートコンプリート(実 API)", () => {
	// ─ テストケース: 「渋谷」入力でサジェストが表示される ─
	// 手順:
	//   1. appPage で起動(匿名セッション確立済み = API を叩ける状態)
	//   2. 場所入力欄に「渋谷」と入力する(入力後 300ms のデバウンスを待つ)
	//   3. サジェストリスト(search-location-autocomplete-suggestions)が表示され、
	//      先頭項目(-suggestion-0)が存在することを検証
	test("「渋谷」入力でサジェストが 1 件以上表示される", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		await searchPage.typeLocation("渋谷");

		await expect(searchPage.locationSuggestions).toBeVisible();
		await expect(searchPage.locationSuggestion(0)).toBeVisible();
	});

	// ─ テストケース: クリアボタンで入力とサジェストがリセットされる ─
	// 手順:
	//   1. 「渋谷」と入力しサジェストを表示させる
	//   2. クリアボタン(search-location-autocomplete-clear)をクリック
	//   3. 入力欄が空になり、サジェストリストが非表示になることを検証
	test("クリアボタンで入力とサジェストがリセットされる", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		await searchPage.typeLocation("渋谷");
		await expect(searchPage.locationSuggestions).toBeVisible();

		await searchPage.locationClearButton.click();
		await expect(searchPage.locationInput).toHaveValue("");
		await expect(searchPage.locationSuggestions).toHaveCount(0);
	});
});
