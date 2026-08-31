import { DEFAULT_TIMEOUT, by, element, expect, tapWhenVisible, waitUntilVisible } from "../fixtures/e2e";

/**
 * 📱 端末設定画面の Screen Object（#1504、e2e-web の pages/DeviceSettingsPage.ts に対応）
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/profile/device-settings.tsx
 *
 * マイページ（設定項目）の «端末設定» 行（`settings-device-settings`）から push される画面。
 * 「この端末にだけ保存される設定」だけを持つ（今は SET-01 ハプティクスのみ。
 * 以後 SET-02 通知 / SET-05 ダークモード / SET-06 言語切替もここに並ぶ）。
 * マイページ側の行は `screens/SettingsScreen.ts` が持つ。
 */
export class DeviceSettingsScreen {
	/**
	 * ハプティクスのオン/オフ行（タップ領域全体）。
	 * `SettingsToggleItem` はラベルタップでも切り替わるようこの行全体を `TouchableOpacity` にしている。
	 */
	readonly hapticsToggleItem = by.id("settings-haptics-toggle");
	/**
	 * ハプティクストグルの実体（`Switch`、testID は `${testID}-switch`）。
	 *
	 * e2e-web と違い、ネイティブでは `testID` がこの `Switch` 自体へそのまま乗るため
	 * （react-native-web のように外側の `View` へ逃げない）、状態確認はこの要素へ直接行える。
	 * Detox はこの用途のために `toHaveToggleValue()` を提供している
	 * （公式ドキュメントの参照実装が React Native の Switch そのもの）。
	 */
	readonly hapticsToggleSwitch = by.id("settings-haptics-toggle-switch");
	/** ScreenHeader の戻るボタン（#1404 の `${testID}-back` 規約） */
	readonly backButton = by.id("device-settings-screen-back");

	/**
	 * 端末設定画面が表示されていることを検証する。
	 *
	 * ロケール依存を持ち込まないよう、タイトル文字列（`by.text`）ではなく «必ず出る行» の
	 * testID を見る（SettingsScreen.expectLoaded と同じ方針。#1031 B4 で Android の端末ロケールに
	 * 引きずられて落ちた経路をこれ以上増やさないため）。
	 */
	async expectLoaded(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.hapticsToggleItem, timeout);
	}

	/**
	 * ハプティクストグル行をタップしてオン/オフを切り替える。
	 * ラベル部分も含めた行全体が `TouchableOpacity` なので、`Switch` 自体ではなく行をタップする
	 * （行タップとスイッチ直接タップの両方が効くが、後者は端末によってヒット領域が小さく
	 * 安定しないため、既存 spec と同じ「行をタップする」流儀に揃える）。
	 */
	async toggleHaptics(): Promise<void> {
		await tapWhenVisible(this.hapticsToggleItem);
	}

	/**
	 * ハプティクストグルが期待するオン/オフ状態になっていることを検証する。
	 * `useHaptics` 自体（実際に鳴る/鳴らないか）は Detox のブラックボックス e2e から観測できないため
	 * （ネイティブモジュール呼び出しを差し替える手段がこのリポジトリの e2e-mobile 基盤に無い）、
	 * ここでは「設定 UI の状態が正しく切り替わり、期待どおり反映されていること」までを担保する。
	 */
	async expectHapticsToggleValue(value: boolean, timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.hapticsToggleSwitch, timeout);
		await expect(element(this.hapticsToggleSwitch)).toHaveToggleValue(value);
	}

	/** ヘッダーの戻るボタンでマイページへ戻る */
	async goBack(): Promise<void> {
		await tapWhenVisible(this.backButton);
	}
}
