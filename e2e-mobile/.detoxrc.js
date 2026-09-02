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
		// #1027 【重要】launchApp は既定の "auto" のまま使う。"manual" にしてはいけない。
		//
		// Detox の `launchApp: "manual"` は「自動起動をスキップする」設定ではなく
		// 「**あなたが Xcode / Android Studio から手動でアプリを起動する**」ためのモードで、
		// Detox は起動引数を stdout に出力したうえで `Press any key to continue...` と
		// キー入力待ちに入る。GitHub Actions のような非 TTY 環境では
		// `TypeError: process.stdin.setRawMode is not a function` で全 spec が即死する。
		// （加えて、launchArgs = refresh_token がログへ平文出力されてしまう）
		// Android でも「インストールがスキップされ No instrumentation runner found」となる。
		//
		// 代償として init 時に launchArgs 無しの自動起動が 1 回走り、
		// **匿名サインインのクォータを run あたり 1 消費する**（30 回/時/IP のうち 1）。
		// ただしセッションは AsyncStorage に永続化され spec 間で引き継がれるため
		// 消費は run ごとに 1 回で頭打ちになり、許容範囲と判断した（#1030 3-1 の見積内）。
	},

	// #1030 【設計】レビュー B-2: launchArgs には refresh_token（長期資格情報）が載る。
	// public リポジトリの Artifact は実質誰でも取得できるため、**device log は既定で無効**にする。
	// 収集する場合は launchArgs を渡さない run に限ること（screenshot / video に token は写らない）
	artifacts: {
		rootDir: "artifacts",
		plugins: {
			log: "none",
			screenshot: "failing",
			// #1484 エビデンス動画は workflow_dispatch の record_videos 入力で撮る。
			// 入力は DETOX_RECORD_VIDEOS=all を渡し、Detox 自身の env→CLI マッピング
			//（collectCliConfig が argv と同格に DETOX_RECORD_VIDEOS を読む）で有効化される。
			// ⚠️ ここを process.env の三項演算にしてはいけない。CLI 設定は defaultsDeep で
			// この config より優先されるため、"1" のような不正値の env が来た時点で
			// この行の値は黙って上書きされ、動画が出ない（run 32603604105 / 32605810775 で実測）。
			// env の値は必ず none|failing|all のいずれかにすること。
			// #1030 の注意のとおり video に launchArgs のトークンは写らない。既定は "none"
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
		"ios.release": {
			type: "ios.app",
			binaryPath: "../app-expo/ios/build/Build/Products/Release-iphonesimulator/nanitabeyo.app",
			// #1027 【設計】シミュレータ用 Release ビルド（署名不要）。derivedDataPath を ios/build に
			// 固定して binaryPath と対応させる（事前に `expo prebuild --platform ios` + `pod install` が必要）
			build:
				"cd ../app-expo/ios && xcodebuild -workspace nanitabeyo.xcworkspace -scheme nanitabeyo -configuration Release -sdk iphonesimulator -derivedDataPath build",
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
		simulator: {
			type: "ios.simulator",
			device: {
				// #1027 【設計】CI は Xcode 26.2（eas.json の EAS ビルドと同一）固定のため、同梱ランタイムに
				// 存在する機種を指定する。ローカルで別機種を使う場合は DETOX_IOS_DEVICE で上書きする
				type: process.env.DETOX_IOS_DEVICE || "iPhone 16",
			},
		},
	},
	configurations: {
		"android.emu.release": {
			device: "emulator",
			app: "android.release",
		},
		"ios.sim.release": {
			device: "simulator",
			app: "ios.release",
		},
	},
};
