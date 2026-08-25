import { test, expect } from "../../fixtures/test";
import { DeviceSettingsPage } from "../../pages/DeviceSettingsPage";
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
	//      - 端末設定(settings-device-settings) ← #1504 で追加。規約カードの直上
	//   3. 「レビューを書く」(ストア誘導)は Web では表示されないことを検証
	test("設定メニューの各項目が表示される", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		await settingsPage.goto();
		await settingsPage.expectLoaded();

		await expect(settingsPage.feedbackItem).toBeVisible();
		await expect(settingsPage.termsItem).toBeVisible();
		await expect(settingsPage.privacyItem).toBeVisible();
		await expect(settingsPage.blockedTopicsItem).toBeVisible();
		// #1504 端末設定は規約カードの直上に置いた行
		await expect(settingsPage.deviceSettingsItem).toBeVisible();
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

	// ─ テストケース: バージョン情報が表示される(#1495 SUP-03) ─
	// 手順:
	//   1. 設定画面を表示する
	//   2. バージョン行(settings-version-section)が "{version}({短縮コミットID})" 形式
	//      (例: 1.14.0(abc1234) / コミットID未設定時は 1.14.0(dev)) で表示され、
	//      空文字や"undefined"を出していないことを検証する
	test("バージョン情報が表示される", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		await settingsPage.goto();
		await settingsPage.expectLoaded();

		await expect(settingsPage.versionText).toBeVisible();
		const versionText = await settingsPage.versionText.innerText();
		expect(versionText).toMatch(/^\d+\.\d+\.\d+\([^)]+\)$/);
		expect(versionText).not.toMatch(/undefined/i);
	});
});

/**
 * #1504 SET-01 端末設定画面（ハプティクスのオン/オフ）のテスト
 *
 * 対象: app-expo/features/settings/hapticsSettingsStore.ts の永続化(AsyncStorage キー
 * `haptics_enabled_v1`)。実際に振動が鳴る/鳴らないはネイティブでしか観測できないため、
 * web 側では「実導線で開ける → 表示される → 操作で状態が変わる → 再遷移後も保持される」までを保証する
 * (発火そのものの検証は app-expo/hooks/useHaptics.test.tsx が担当)。
 *
 * トグルはマイページ直置きではなく «端末設定» 行から push される別画面にある
 * （オーナー指示。理由は app-expo/app/[locale]/(tabs)/profile/device-settings.tsx の冒頭）。
 */
test.describe("端末設定画面のハプティクストグル(匿名ユーザー)", () => {
	// ─ テストケース: 端末設定行から開くと、トグルが表示され既定でオンである ─
	// 手順:
	//   1. マイページ(設定項目)を表示する
	//   2. 端末設定行(settings-device-settings)が表示されることを検証し、タップする
	//   3. 端末設定画面でトグル行(settings-haptics-toggle)が表示されることを検証
	//   4. 既定値(未設定時はオン。hapticsSettingsStore.ts の仕様)であることを検証
	test("端末設定行から開くと、トグルが表示され既定でオンである", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		const deviceSettingsPage = new DeviceSettingsPage(appPage);

		await settingsPage.goto();
		await settingsPage.expectLoaded();

		await expect(settingsPage.deviceSettingsItem).toBeVisible();
		await settingsPage.openDeviceSettings();

		await deviceSettingsPage.expectLoaded();
		await expect(deviceSettingsPage.hapticsToggleSwitch).toBeChecked();
	});

	// ─ テストケース: タップすると状態が変わり、再遷移後も保持される ─
	// 手順:
	//   1. 端末設定画面を表示する(既定オン)
	//   2. トグル行をタップしてオフにする → スイッチの状態がオフになることを検証
	//   3. 端末設定画面へ明示的に goto (reload ではなく goto の理由は recent-locations.spec.ts と同じ:
	//      expo-router の静的書き出しでは page.reload() だとブラウザの URL バーとズレた別ルートの
	//      静的 HTML が読み込まれることがあるため)し、オフが保持されていることを検証(永続化)
	//   4. 後始末: もう一度タップしてオンへ戻す
	test("タップすると状態が変わり、再遷移後も保持される", async ({ appPage }) => {
		const deviceSettingsPage = new DeviceSettingsPage(appPage);

		await deviceSettingsPage.goto();
		await deviceSettingsPage.expectLoaded();
		await expect(deviceSettingsPage.hapticsToggleSwitch).toBeChecked();

		await deviceSettingsPage.hapticsToggleItem.click();
		await expect(deviceSettingsPage.hapticsToggleSwitch).not.toBeChecked();

		await deviceSettingsPage.goto();
		await deviceSettingsPage.expectLoaded();
		await expect(deviceSettingsPage.hapticsToggleSwitch).not.toBeChecked();

		// 後始末: 既定値(オン)へ戻す
		await deviceSettingsPage.hapticsToggleItem.click();
		await expect(deviceSettingsPage.hapticsToggleSwitch).toBeChecked();
	});
});
