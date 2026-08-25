import { test, expect } from "../../fixtures/test";
import { SettingsPage } from "../../pages/SettingsPage";

/**
 * ⚙️ 設定画面(匿名ユーザー)のテスト
 *
 * 目的: 設定メニューの項目構成と、匿名ユーザーへの表示制御を保証する。
 */
test.describe("設定画面(匿名ユーザー)", () => {
	// ─ テストケース: 設定メニューの各項目が表示される ─
	// 手順:
	//   1. appPage で起動し、/ja-JP/profile/settings へ遷移する
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
	//   1. 設定画面を表示する(匿名状態)
	//   2. ログアウト行(settings-logout)が存在しないことを検証
	//      (ログアウトは非匿名ユーザーのみに表示される仕様)
	test("匿名時はログアウトが表示されない", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		await settingsPage.goto();
		await settingsPage.expectLoaded();

		await expect(settingsPage.logoutItem).toHaveCount(0);
	});

	// ─ テストケース: 匿名時は通知カードが表示されない ─
	// 手順:
	//   1. 設定画面を表示する(匿名状態)
	//   2. 通知カード(settings-notifications-card)が存在しないことを検証
	//
	// #1510 匿名ユーザーは Push Token を登録しない(PushTokenRegistration)ため、
	// 受け取り方を設定させても届く先が無い。ログイン済み側の検証は
	// tests/authenticated/notification-preferences.spec.ts が持つ
	test("匿名時は通知カテゴリのカードが表示されない", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		await settingsPage.goto();
		await settingsPage.expectLoaded();

		await expect(settingsPage.notificationsCard).toHaveCount(0);
	});
});
