// #1027 【設計】Detox 設定の中核。e2e-web/playwright.config.ts に相当する
// - テスト対象は expo prebuild + Gradle/xcodebuild で生成した release ビルド
//   （dev client ではなくスタンドアロン相当 = e2e-web の「本番同一成果物」方針と整合させる）
// - 接続先 API は EAS の development 環境変数（EXPO_PUBLIC_BACKEND_BASE_URL 等）が
//   JS バンドルへ焼き込まれるため、Detox 側での指定は不要
/** @type {Detox.DetoxConfig} */
module.exports = {
	testRunner: {
		args: {
			$0: "jest",
			config: "jest.config.js",
		},
		jest: {
			// #1027 【設計】初回起動はエミュレータへの APK インストールを含むため長めに確保する
			setupTimeout: 300000,
		},
	},
	apps: {
		"android.release": {
			type: "android.apk",
			binaryPath: "../app-expo/android/app/build/outputs/apk/release/app-release.apk",
			testBinaryPath: "../app-expo/android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk",
			// #1027 【設計】エミュレータ実行専用のため x86_64 のみビルドして時間を短縮する
			// （事前に `app-expo` で E2E_DETOX=1 を付けた `expo prebuild --platform android` が必要）
			build:
				"cd ../app-expo/android && ./gradlew :app:assembleRelease :app:assembleAndroidTest -DtestBuildType=release -PreactNativeArchitectures=x86_64",
		},
	},
	devices: {
		emulator: {
			type: "android.emulator",
			device: {
				// #1027 【設計】CI (reactivecircus/android-emulator-runner) が起動する AVD 名と一致させる。
				// ローカルで別名の AVD を使う場合は DETOX_AVD_NAME で上書きする
				avdName: process.env.DETOX_AVD_NAME || "e2e_avd",
			},
		},
	},
	configurations: {
		"android.emu.release": {
			device: "emulator",
			app: "android.release",
		},
	},
};
