import { test, expect } from "../../fixtures/test";
import { SettingsPage } from "../../pages/SettingsPage";

/**
 * 🗑️ アカウント削除の確認ダイアログ（#1511 ACC-01・ログイン済み）
 *
 * ## 目的
 * **確認ダイアログに「取り消せない」と書いてあること**を守る。
 * この機能には猶予期間が無い（#1511 リーダー判断: 即時実行）。アプリ DB 側は匿名化だが
 * Supabase Auth のアカウントは物理削除するため、同じ資格情報での再ログイン経路は残らない。
 * つまり **誤操作を戻す手段は UI の文言と二段確認しかない**。文言が消えても画面は正常に
 * 見えるので、目視レビューでは落ちる種類の退行である。
 *
 * ## ⚠️ 実際の削除は実行しない（確定ボタンを押さない）
 * この spec は 2 枚目のダイアログを **キャンセル**して終わる。dev の Supabase Auth ユーザーを
 * 本当に消すと `TEST_USER_EMAIL` のテストユーザーが失われ、`tests/authenticated/` 全体が
 * 二度と走らなくなる（復旧には Supabase 側でのユーザー再作成が要る）。
 * 削除の «実行» まで検証したい場合は、使い捨てユーザーを作る仕組みを先に用意すること。
 * 現状ここが押さえるのは「導線が出る」「確認が二段で挟まる」「キャンセルで何も起きない」。
 *
 * ## Tier / セッション
 * Tier 2（無タグ・`desktop-chrome-authenticated`）。
 * 共有 storageState をそのまま使ってよい — **セッションを破壊しない**（確定しないので
 * `signOut` を通らない）。`tests/authenticated/logout.spec.ts` が専用セッションを発行して
 * いるのは、あちらがサーバ側でセッションを失効させるからで、こちらはその条件に当たらない。
 */
test.skip(
	() => !process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD,
	"TEST_USER_EMAIL / TEST_USER_PASSWORD(e2e-web/.env)が未設定のためスキップ",
);

test.describe("アカウント削除の確認(ログイン済み)", () => {
	// ─ テストケース: 削除は二段の確認を挟み、取り消せない旨を明記する ─
	// 手順:
	//   1. 設定画面を開く（共有 storageState = ログイン済み）
	//   2. ログアウト行の表示で「ログイン済みで決着した」ことを確かめてから削除行を見る
	//   3. 削除行を押し、1 枚目に影響範囲（写真・動画の削除まで）と「取り消せません」があることを検証
	//   4. 「削除に進む」で 2 枚目へ進み、こちらにも復元不可の明記があることを検証
	//   5. **キャンセル**して閉じ、設定画面に留まる（＝ 何も起きない）ことを検証
	test("削除は二段の確認を挟み、取り消せない旨を明記する", async ({ appPage }, testInfo) => {
		const settingsPage = new SettingsPage(appPage);
		await settingsPage.goto();
		await settingsPage.expectLoaded();

		// ログアウト行の表示 ＝ AuthProvider が「ログイン済み(非匿名)」で決着した合図。
		// これを待たずに削除行を探すと、未解決状態の「まだ出ていない」と区別が付かない
		await expect(settingsPage.logoutItem).toBeVisible();
		await expect(settingsPage.deleteAccountItem).toBeVisible();

		// ── 1 枚目: 何が起きるかの説明 ──────────────────────────────
		await settingsPage.openDeleteAccountDialog();
		await expect(settingsPage.deleteAccountConfirmMessage).toBeVisible();
		// 「写真と動画は削除され」= ストレージ実体の削除まで説明していること（#1511 の確定事項）
		await expect(appPage.getByText("写真と動画は削除され")).toBeVisible();

		if (process.env.PW_FORCE_VISUALS) {
			await appPage.screenshot({ path: testInfo.outputPath("delete-confirm-1.png"), fullPage: true });
		}

		// ── 2 枚目: 取り消せないことへの明示的な同意 ────────────────────
		await settingsPage.dialogConfirmButton.click();
		await expect(settingsPage.deleteAccountFinalTitle).toBeVisible();
		await expect(appPage.getByText("復元できません")).toBeVisible();

		if (process.env.PW_FORCE_VISUALS) {
			await appPage.screenshot({ path: testInfo.outputPath("delete-confirm-2.png"), fullPage: true });
		}

		// ── キャンセルすると何も起きない ────────────────────────────
		// ⚠️ ここで確定ボタンを押してはいけない（ファイル冒頭の注意を参照）
		await settingsPage.dialogCancelButton.click();
		await expect(settingsPage.deleteAccountFinalTitle).toHaveCount(0);

		// 設定画面に留まり、削除行もログアウト行も «押せるまま» であること
		// = セッションが生きている（削除も サインアウトも走っていない）ことの確認
		await settingsPage.expectLoaded();
		await expect(settingsPage.deleteAccountItem).toBeVisible();
		await expect(settingsPage.logoutItem).toBeVisible();
	});
});
