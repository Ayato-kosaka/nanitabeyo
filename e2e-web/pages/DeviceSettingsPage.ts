import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 📱 端末設定画面の Page Object（#1504）
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/profile/device-settings.tsx
 *
 * マイページ（設定項目）の «端末設定» 行（`settings-device-settings`）から push される画面。
 * 「この端末にだけ保存される設定」だけを持つ（今は SET-01 ハプティクスのみ。
 * 以後 SET-02 通知 / SET-05 ダークモード / SET-06 言語切替もここに並ぶ）。
 * マイページ側の行は `pages/SettingsPage.ts` が持つ。
 */
export class DeviceSettingsPage {
	readonly page: Page;
	/** ハプティクスのオン/オフ行（タップ領域全体） */
	readonly hapticsToggleItem: Locator;
	/**
	 * ハプティクストグルの実 DOM 上の `<input type="checkbox" role="switch">`。
	 *
	 * `SettingsToggleItem` の `testID` は react-native-web の `Switch` では中身の `<input>` ではなく
	 * それを包む `<View>` へ `data-testid` として付与される（react-native-web の Switch 実装が
	 * `testID` を除外リストに含めず outer View へスプレッドしているため）。
	 * オン/オフの状態は `<input>` の `checked` にしか出ないので、そこまで一段掘って取得する。
	 */
	readonly hapticsToggleSwitch: Locator;
	/** ScreenHeader の戻るボタン（#1404 の `${testID}-back` 規約） */
	readonly backButton: Locator;

	constructor(page: Page) {
		this.page = page;
		this.hapticsToggleItem = page.getByTestId("settings-haptics-toggle");
		this.hapticsToggleSwitch = page.getByTestId("settings-haptics-toggle-switch").locator("input");
		this.backButton = page.getByTestId("device-settings-screen-back");
	}

	/**
	 * 端末設定画面へ直接遷移する（locale プレフィックス必須）。
	 * 実導線（マイページ →「端末設定」行のタップ）は `SettingsPage.openDeviceSettings()` を使う。
	 */
	async goto(locale = "ja-JP"): Promise<void> {
		await this.page.goto(`/${locale}/profile/device-settings`);
	}

	/**
	 * 端末設定画面が表示されていることを検証する。
	 *
	 * ロケール依存を持ち込まないよう、タイトル文字列ではなく «必ず出る行» の testID を見る
	 * （SettingsPage.expectLoaded と同じ方針）。
	 */
	async expectLoaded(): Promise<void> {
		await expect(this.hapticsToggleItem).toBeVisible();
	}
}
