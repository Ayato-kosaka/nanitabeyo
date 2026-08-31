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
	//      - ブロック済みの料理カテゴリ(settings-blocked-dish-categories) ← #1553 で「トピック」から改称
	//      - 端末設定(settings-device-settings) ← #1504 で追加
	//      - なに食べよについて(settings-about) ← #1583 で追加
	//   3. #1583 で «なに食べよについて» / «端末設定» へ移した行が、
	//      マイページ側に **残っていない** ことを検証（移設であって複製ではない）
	//   4. 「レビューを書く」(ストア誘導)は Web では表示されないことを検証
	test("設定メニューの各項目が表示される", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		await settingsPage.goto();
		await settingsPage.expectLoaded();

		await expect(settingsPage.blockedDishCategoriesItem).toBeVisible();
		await expect(settingsPage.deviceSettingsItem).toBeVisible();
		await expect(settingsPage.aboutItem).toBeVisible();

		// #1583 / #1629 移設であって複製ではないこと。
		// «ご意見・不具合» は #1629 で «なに食べよについて» の 1 ブロック目へ移った
		await expect(settingsPage.feedbackItem).toHaveCount(0);
		await expect(settingsPage.termsItem).toHaveCount(0);
		await expect(settingsPage.privacyItem).toHaveCount(0);
		await expect(settingsPage.themeSelector).toHaveCount(0);
		await expect(settingsPage.versionText).toHaveCount(0);
		// 旧ラベルも新ラベルも Web には出ない（ストアが無いため）
		await expect(appPage.getByText("レビューを書く", { exact: true })).toHaveCount(0);
		await expect(appPage.getByText("なに食べよ を応援する", { exact: true })).toHaveCount(0);
	});

	// ─ テストケース: 分けた 2 画面から «戻る» でマイページへ帰れる ─
	// #1583 で 1 画面を 3 画面に割った以上、**行き止まりを作っていないこと**を見る必要がある。
	// 分割そのものより «帰れなくなる» ほうが起きやすい事故で、
	// 「行が表示される」「遷移できる」だけを見ているテストでは捕まらない。
	//
	// 手順:
	//   1. マイページ → 端末設定 → 戻る → マイページに帰っていること
	//   2. マイページ → なに食べよについて → 戻る → マイページに帰っていること
	test("端末設定 / なに食べよについて から «戻る» でマイページへ帰れる", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		const deviceSettingsPage = new DeviceSettingsPage(appPage);

		await settingsPage.goto();
		await settingsPage.expectLoaded();

		await settingsPage.openDeviceSettings();
		await expect(appPage).toHaveURL(/\/ja-JP\/profile\/device-settings/);
		await deviceSettingsPage.backButton.click();
		await expect(appPage).toHaveURL(/\/ja-JP\/profile$/);
		await settingsPage.expectLoaded();

		await settingsPage.openAbout();
		await expect(appPage).toHaveURL(/\/ja-JP\/profile\/about/);
		await settingsPage.aboutBackButton.click();
		await expect(appPage).toHaveURL(/\/ja-JP\/profile$/);
		await settingsPage.expectLoaded();
	});

	// ─ テストケース: «なに食べよについて» に規約 4 行が揃っている ─
	// #1583 オーナー指示（ページ遷移にする）の検証。
	// 「応援する」は Web には出ない（ストアが無い）ので、その不在も併せて見る。
	test("«なに食べよについて» に規約 4 行が揃っている", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		await settingsPage.goto();
		await settingsPage.expectLoaded();

		await settingsPage.openAbout();

		await expect(appPage).toHaveURL(/\/ja-JP\/profile\/about/);
		await expect(settingsPage.guidelinesItem).toBeVisible();
		await expect(settingsPage.termsItem).toBeVisible();
		await expect(settingsPage.privacyItem).toBeVisible();
		await expect(settingsPage.copyrightItem).toBeVisible();
		await expect(appPage.getByTestId("settings-leave-review")).toHaveCount(0);
	});

	// ─ テストケース: 表示テーマは端末設定の «表示テーマ» 行の先にある ─
	// #1583 オーナー承認（2026-08-25「表示テーマは 端末設定に移して大丈夫ですよ」）。
	// #1629 さらに «1 行 1 設定» へ揃えるため、3 択ラジオは端末設定の直置きをやめて
	// `profile/theme` へ移した（オーナー指示）。端末設定に残るのは «行» だけである。
	test("表示テーマは端末設定の «表示テーマ» 行から開く専用ページにある", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		await settingsPage.goto();
		await settingsPage.expectLoaded();

		await settingsPage.openDeviceSettings();
		await expect(appPage).toHaveURL(/\/ja-JP\/profile\/device-settings/);
		// 端末設定にあるのは行だけ。3 択そのものはここに無い
		await expect(settingsPage.themeItem).toBeVisible();
		await expect(settingsPage.themeSelector).toHaveCount(0);

		await settingsPage.openTheme();
		await expect(appPage).toHaveURL(/\/ja-JP\/profile\/theme/);
		await expect(settingsPage.themeOption("system")).toBeVisible();
		await expect(settingsPage.themeOption("light")).toBeVisible();
		await expect(settingsPage.themeOption("dark")).toBeVisible();

		// 割った以上、帰れることまで見る（#1583 の «戻る» のテストと同じ理由）
		await settingsPage.themeBackButton.click();
		await expect(appPage).toHaveURL(/\/ja-JP\/profile\/device-settings/);
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
		// #1629 ログアウトは «アカウント管理» の先へ移ったので、その入口ごと出ないことを見る。
		// 行だけ残して先が空、という壊れ方を «ログアウトが無い» と読み違えないため
		await expect(settingsPage.accountItem).toHaveCount(0);
	});

	// ─ テストケース: バージョン情報が表示される(#1495 SUP-03) ─
	// 手順:
	//   1. マイページから «なに食べよについて» を開く（#1583 でバージョンはそこへ移った）
	//   2. バージョン行(settings-version-section)が "{version}({短縮コミットID})" 形式
	//      (例: 1.14.0(abc1234) / コミットID未設定時は 1.14.0(dev)) で表示され、
	//      空文字や"undefined"を出していないことを検証する
	test("バージョン情報が «なに食べよについて» に表示される", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		await settingsPage.goto();
		await settingsPage.expectLoaded();
		await settingsPage.openAbout();

		await expect(settingsPage.versionText).toBeVisible();
		const versionText = await settingsPage.versionText.innerText();
		expect(versionText).toMatch(/^\d+\.\d+\.\d+\([^)]+\)$/);
		expect(versionText).not.toMatch(/undefined/i);
	});

	// ─ テストケース: 匿名時は通知カードが表示されない ─
	// 手順:
	//   1. マイページを表示する(匿名状態)
	//   2. 通知カード(settings-notifications-card)が存在しないことを検証
	//
	// #1510 匿名ユーザーは Push Token を登録しない(PushTokenRegistration)ため、
	// 受け取り方を設定させても届く先が無い。ログイン済み側の検証は
	// tests/authenticated/notification-preferences.spec.ts が持つ
	//
	// ⚠️ ベース取り込みの時点で、この test は **中身がバージョン検証のまま**入れ子になっていて、
	//    バージョンも通知カードもどちらも assert されていなかった（構文としては通る）。
	//    2 本の独立した test へ戻してある。
	test("匿名時は通知カテゴリのカードが表示されない", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		await settingsPage.goto();
		await settingsPage.expectLoaded();

		await expect(settingsPage.notificationsCard).toHaveCount(0);
		// #1629 カードは `profile/notifications` へ移った。匿名にはその入口も出ない
		await expect(settingsPage.notificationsItem).toHaveCount(0);
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
