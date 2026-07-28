import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";

/**
 * 🚀 起動スモークテスト @smoke
 *
 * 目的: 「静的配信 → SPA ブート → ロケールリダイレクト → 匿名認証」という
 *       アプリの起動シーケンス全体が壊れていないことを最小の手数で保証する。
 * 検証範囲: トップページのみ。個別機能には踏み込まない(Tier 1)。
 *
 * 注意: このファイルは「匿名サインインが実際に自動発火すること」自体を検証するため、
 * playwright.config.ts の各プロジェクトが設定する共有匿名セッション(ANON_STORAGE_STATE_PATH)を
 * 使わず、意図的にセッション無しのフレッシュな状態で実行する(storageState を明示的に上書き)。
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("起動 @smoke", () => {
	// ─ テストケース: "/" にアクセスすると ja-JP へリダイレクトされ検索画面が表示される ─
	// 手順:
	//   1. "/" へ遷移する(appPage フィクスチャがリダイレクト完了まで待機する)
	//   2. URL が /ja または /ja-JP になっていることを検証
	//   3. 検索画面のヘッダタイトル「どんな料理を探しましょう？🍽」が表示されることを検証
	test("トップページからロケール付き検索画面へリダイレクトされる", async ({ appPage }) => {
		await expect(appPage).toHaveURL(/\/ja(-JP)?(\/|$)/);
		const searchPage = new SearchPage(appPage);
		await searchPage.expectLoaded();
	});

	// ─ テストケース: 匿名セッションが自動確立される ─
	// 手順:
	//   1. "/" へ遷移する
	//   2. AuthProvider の signInAnonymously() 完了により
	//      localStorage に sb-*-auth-token キーが出現することを検証
	//      (appPage フィクスチャの waitForAnonymousSession が実質の検証になる)
	test("匿名セッションが自動確立される", async ({ appPage }) => {
		const hasSession = await appPage.evaluate(() =>
			Object.keys(window.localStorage).some((key) => key.startsWith("sb-") && key.endsWith("-auth-token")),
		);
		expect(hasSession).toBe(true);
	});

	// ─ テストケース: 起動時に想定外の console error が出ていない ─
	// 手順:
	//   1. "/" へ遷移し検索画面表示まで待つ
	//   2. consoleErrors フィクスチャに収集されたエラーが空であることを検証
	//      (既知ノイズは fixtures/test.ts の KNOWN_CONSOLE_NOISE で許容リスト化する)
	test("起動時に想定外の console error がない", async ({ appPage, consoleErrors }) => {
		const searchPage = new SearchPage(appPage);
		await searchPage.expectLoaded();
		expect(consoleErrors).toEqual([]);
	});
});
