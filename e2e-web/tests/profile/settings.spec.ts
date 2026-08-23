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
});

/**
 * #1504 SET-01 ハプティクスのオン/オフトグル(匿名ユーザー)のテスト
 *
 * 対象: app-expo/features/settings/hapticsSettingsStore.ts の永続化(AsyncStorage キー
 * `haptics_enabled_v1`)。実際に振動が鳴る/鳴らないはネイティブでしか観測できないため、
 * web 側では「表示 → 操作で状態が変わる → リロード後も保持される」までを保証する
 * (発火そのものの検証は e2e-mobile/tests/profile/settings.test.ts が担当)。
 */
test.describe("設定画面のハプティクストグル(匿名ユーザー)", () => {
	// ─ テストケース: トグルが表示され、既定でオンである ─
	// 手順:
	//   1. 設定画面を表示する
	//   2. トグル行(settings-haptics-toggle)が表示されることを検証
	//   3. 既定値(未設定時はオン。hapticsSettingsStore.ts の仕様)であることを検証
	test("トグルが表示され、既定でオンである", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		await settingsPage.goto();
		await settingsPage.expectLoaded();

		await expect(settingsPage.hapticsToggleItem).toBeVisible();
		await expect(settingsPage.hapticsToggleSwitch).toBeChecked();
	});

	// ─ テストケース: タップすると状態が変わり、リロード後も保持される ─
	// 手順:
	//   1. 設定画面を表示する(既定オン)
	//   2. トグル行をタップしてオフにする → スイッチの状態がオフになることを検証
	//   3. 設定画面へ明示的に goto (reload ではなく goto の理由は recent-locations.spec.ts と同じ:
	//      expo-router の静的書き出しでは page.reload() だとブラウザの URL バーとズレた別ルートの
	//      静的 HTML が読み込まれることがあるため)し、オフが保持されていることを検証(永続化)
	//   4. 後始末: もう一度タップしてオンへ戻す
	test("タップすると状態が変わり、リロード後も保持される", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		await settingsPage.goto();
		await settingsPage.expectLoaded();
		await expect(settingsPage.hapticsToggleSwitch).toBeChecked();

		await settingsPage.hapticsToggleItem.click();
		await expect(settingsPage.hapticsToggleSwitch).not.toBeChecked();

		await appPage.goto("/ja-JP/profile/settings");
		await settingsPage.expectLoaded();
		await expect(settingsPage.hapticsToggleSwitch).not.toBeChecked();

		// 後始末: 既定値(オン)へ戻す
		await settingsPage.hapticsToggleItem.click();
		await expect(settingsPage.hapticsToggleSwitch).toBeChecked();
	});
});
