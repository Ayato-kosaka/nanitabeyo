import { test, expect } from "../../fixtures/test";
import { SettingsPage } from "../../pages/SettingsPage";

/**
 * 🗑️ アカウント削除の導線 — 匿名ユーザー側（#1511 ACC-01）
 *
 * ## 目的
 * **ゲストに削除行を出さないこと**を守る。ゲスト（匿名サインイン）には `users` 行が無く、
 * API 側も `AuthUserGuard` で 403 を返す（`DELETE /v1/users/me`）。押せる導線だけ残ると、
 * 押すたびに必ずエラーになる行を設定画面に置くことになる。
 *
 * ログイン済み側（削除行が出る・二段確認が挟まる）は
 * `tests/authenticated/account-delete.spec.ts` が受け持つ。
 * プロジェクトの storageState が違う（匿名 / ログイン済み）ため、
 * 1 ファイルにまとめられない（playwright.config.ts の testMatch / testIgnore を参照）。
 *
 * ## Tier
 * Tier 1（無タグ・`desktop-chrome`）。DB に一切書き込まないため `@mutation` ではない。
 */
test.describe("アカウント削除の導線(匿名ユーザー)", () => {
	// ─ テストケース: 匿名時はアカウント削除行が表示されない ─
	// 手順:
	//   1. 設定画面を開く（匿名状態）
	//   2. アカウント削除行(settings-delete-account)が存在しないことを検証
	//   3. ログアウト行も無いことを併せて確認する
	//      ここを見ないと「まだ auth が解決していないから出ていないだけ」と区別が付かない
	test("匿名時はアカウント削除が表示されない", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		await settingsPage.goto();
		await settingsPage.expectLoaded();

		await expect(settingsPage.deleteAccountItem).toHaveCount(0);
		await expect(settingsPage.logoutItem).toHaveCount(0);
	});
});
