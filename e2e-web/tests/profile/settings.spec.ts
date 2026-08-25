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
	//      - ブロック済みの料理カテゴリ(settings-blocked-topics) ← #1132 で「トピック」から改称
	//      - 端末設定(settings-device-settings) / なに食べよについて(settings-about) ← #1583 で新設
	//   3. #1583 で «なに食べよについて» ページへ移った規約 4 行が、設定画面には無いことを検証
	test("設定メニューの各項目が表示される", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		await settingsPage.goto();
		await settingsPage.expectLoaded();

		await expect(settingsPage.feedbackItem).toBeVisible();
		await expect(settingsPage.blockedTopicsItem).toBeVisible();
		await expect(settingsPage.deviceSettingsItem).toBeVisible();
		await expect(settingsPage.aboutItem).toBeVisible();

		// #1583 «移した» のであって «両方に置いた» のではないこと
		await expect(settingsPage.termsItem).toHaveCount(0);
		await expect(settingsPage.privacyItem).toHaveCount(0);
		await expect(settingsPage.themeSelector).toHaveCount(0);
	});

	// ─ テストケース: 端末設定ページへ遷移し、表示テーマが置かれている ─
	// #1583 «見出しを付けて 1 画面に並べる» のではなく画面を割った、という指示の検証。
	// 手順:
	//   1. 設定画面から「端末設定」行をタップする
	//   2. URL が /profile/device-settings になり、表示テーマ 3 択が出ることを検証
	test("端末設定ページへ遷移して表示テーマを置いている", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		await settingsPage.goto();
		await settingsPage.expectLoaded();

		await settingsPage.openDeviceSettingsFromSettings();

		await expect(appPage).toHaveURL(/\/ja-JP\/profile\/device-settings/);
		await expect(settingsPage.themeOption("system")).toBeVisible();
		await expect(settingsPage.themeOption("light")).toBeVisible();
		await expect(settingsPage.themeOption("dark")).toBeVisible();
	});

	// ─ テストケース: «なに食べよについて» ページに規約とバージョンが揃っている ─
	// #1583 オーナー指定の中身（応援する / 利用規約、、、 / バージョン番号）。
	// 「応援する」は Web には出ない（ストアが無いため）ので、ここでは検証しない。
	// 手順:
	//   1. 設定画面から「なに食べよについて」行をタップする
	//   2. URL が /profile/about になり、規約 4 行とバージョン行が出ることを検証
	test("«なに食べよについて» に規約 4 行とバージョンが揃っている", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		await settingsPage.goto();
		await settingsPage.expectLoaded();

		await settingsPage.openAboutFromSettings();

		await expect(appPage).toHaveURL(/\/ja-JP\/profile\/about/);
		await expect(settingsPage.guidelinesItem).toBeVisible();
		await expect(settingsPage.termsItem).toBeVisible();
		await expect(settingsPage.privacyItem).toBeVisible();
		await expect(settingsPage.copyrightItem).toBeVisible();

		// 版数は «1.14.0» の形。押せない行なので testID で掴む
		await expect(settingsPage.versionRow).toBeVisible();
		await expect(settingsPage.versionRow).toContainText(/\d+\.\d+\.\d+/);

		// Web にストアは無いので «応援する» は出さない
		await expect(appPage.getByTestId("settings-leave-review")).toHaveCount(0);
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
