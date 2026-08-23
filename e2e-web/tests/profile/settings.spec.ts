import { test, expect } from "../../fixtures/test";
import { SettingsPage } from "../../pages/SettingsPage";

/**
 * ⚙️ 設定項目(匿名ユーザー)のテスト
 *
 * 目的: 設定メニューの項目構成と、匿名ユーザーへの表示制御を保証する。
 *
 * #1402 で独立した設定画面は無くなり、項目はマイページ（/[locale]/profile）の縦リストへ移った。
 * 見るもの（項目の構成・匿名時のログアウト非表示）は変わらないので、この spec はそのまま残す。
 */
test.describe("設定項目(匿名ユーザー)", () => {
	// ─ テストケース: 設定メニューの各項目が表示される ─
	// 手順:
	//   1. appPage で起動し、/ja-JP/profile へ遷移する（#1402 以前は /ja-JP/profile/settings）
	//   2. 以下の項目が表示されることを検証:
	//      - ご意見・不具合(settings-feedback)
	//      - 利用規約(settings-terms)
	//      - プライバシーポリシー(settings-privacy)
	//      - ブロック済みの料理カテゴリ(settings-blocked-topics) ← #1132 で「トピック」から改称
	//   3. 「レビューを書く」(ストア誘導)は Web では表示されないことを検証
	test("設定メニューの各項目が表示される", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		await settingsPage.goto();
		await settingsPage.expectLoaded();

		await expect(settingsPage.feedbackItem).toBeVisible();
		await expect(settingsPage.termsItem).toBeVisible();
		await expect(settingsPage.privacyItem).toBeVisible();
		await expect(settingsPage.blockedTopicsItem).toBeVisible();
		await expect(appPage.getByText("レビューを書く", { exact: true })).toHaveCount(0);
	});

	// ─ テストケース: 匿名時はログアウトが表示されない ─
	// 手順:
	//   1. マイページを表示する(匿名状態)
	//   2. ログアウト行(settings-logout)が存在しないことを検証
	//      (ログアウトは非匿名ユーザーのみに表示される仕様)
	test("匿名時はログアウトが表示されない", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		await settingsPage.goto();
		await settingsPage.expectLoaded();

		await expect(settingsPage.logoutItem).toHaveCount(0);
	});
});
