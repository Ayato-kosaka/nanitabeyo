// #1027 【設計】Detox 設定の中核。e2e-web/playwright.config.ts に相当する
// - テスト対象は expo prebuild + Gradle/xcodebuild で生成した release ビルド
//   （dev client ではなくスタンドアロン相当 = e2e-web の「本番同一成果物」方針と整合させる）
// - 接続先 API は EAS の development 環境変数（EXPO_PUBLIC_BACKEND_BASE_URL 等）が
//   JS バンドルへ焼き込まれるため、Detox 側での指定は不要
const path = require("node:path");
const dotenv = require("dotenv");

// #1028 【設計】§4-1: ローカル実行用の設定（DETOX_AVD_NAME / TEST_USER_* 等）を e2e-mobile/.env から読む。
// 無ければ何も起きない（コミット対象は .env.example のみ）。CI は secrets が既に process.env にあるため無害
dotenv.config({ path: path.resolve(__dirname, ".env") });

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

	behavior: {
		// #1028 【設計】§4-1: Detox のグローバル（device / by / element / expect）を注入しない。
		// spec からは必ず fixtures/e2e.ts 経由で import させ、グローバルの `expect` が
		// 「型は Jest・実体は Detox」という食い違いを起こさないようにする（@types/jest 採用との整合）
		init: { exposeGlobals: false },
		// #1030 【設計】3-1: 起動は fixtures の launchAppWithSession() が
		// セッション注入・ロケール・権限まで面倒を見るため、Detox の自動起動は使わない。
		// 自動起動されると launchArgs 無しの起動が先に走り、**匿名サインインのクォータを余計に消費する**
		launchApp: "manual",
	},

	// #1030 【設計】レビュー B-2: launchArgs には refresh_token（長期資格情報）が載る。
	// public リポジトリの Artifact は実質誰でも取得できるため、**device log は既定で無効**にする。
	// 収集する場合は launchArgs を渡さない run に限ること（screenshot / video に token は写らない）
	artifacts: {
		rootDir: "artifacts",
		plugins: {
			log: "none",
			screenshot: "failing",
			video: "none",
			instruments: "none",
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
