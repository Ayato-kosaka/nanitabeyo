import { ExpoConfig, ConfigContext } from "@expo/config";
import { version } from "./package.json";

export default ({ config }: ConfigContext): ExpoConfig => ({
	...config,
	name: "nanitabeyo",
	slug: "dish-scroll",
	owner: "dish-scroll",
	runtimeVersion: version.split(".").slice(0, 2).join("."),
	version,
	orientation: "portrait",
	icon: "./assets/images/icon.png",
	scheme: "nanitabeyo",
	updates: {
		url: "https://u.expo.dev/e01a92f1-0341-4eb5-84cc-61b8cef1a8f1",
	},
	userInterfaceStyle: "automatic",
	newArchEnabled: true,
	ios: {
		bundleIdentifier: "com.nanitabeyo",
		buildNumber: "1",
		supportsTablet: false,
		googleServicesFile: "./GoogleService-Info.plist",
		associatedDomains: [`applinks:app.nanitabeyo.net`],
		// #688 【設計】Universal Links のための entitlements 設定
		entitlements: {
			"com.apple.developer.associated-domains": ["applinks:app.nanitabeyo.net"],
		},
		infoPlist: {
			ITSAppUsesNonExemptEncryption: false,
			CFBundleURLTypes: [
				{
					CFBundleURLName: "nanitabeyo",
					CFBundleURLSchemes: ["nanitabeyo"],
				},
				// #492 【設計】Meta SDK OAuth 用 URL スキーム（環境変数が設定されている場合のみ）
				...(process.env.EXPO_PUBLIC_FACEBOOK_APP_ID
					? [{ CFBundleURLSchemes: [`fb${process.env.EXPO_PUBLIC_FACEBOOK_APP_ID}`] }]
					: []),
			],
			CFBundleAllowMixedLocalizations: true,
			CFBundleLocalizations: ["en", "ja", "ar", "es", "fr", "hi", "ko", "zh"],
			CFBundleDisplayName: "$(CFBundleDisplayName)",
		},
		config: {
			googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY,
		},
	},
	android: {
		package: "com.nanitabeyo",
		versionCode: 1,
		adaptiveIcon: {
			// Adaptive icon の前景は 108dp キャンバスのうち内側 72dp しか表示されず、さらにランチャーのマスク
			// （円 / squircle）で切り抜かれる。icon.png（フチまで絵柄がある全面画像）をそのまま使うと端が欠けるため、
			// adaptive-icon.png は絵柄をセーフゾーン（中央 68dp 相当の円）内に収めた専用アセットにしている。
			// icon.png で置き換えないこと。
			foregroundImage: "./assets/images/adaptive-icon.png",
			backgroundColor: "#ffffff",
		},
		googleServicesFile: "./google-services.json",
		intentFilters: [
			{
				action: "VIEW",
				autoVerify: true,
				data: [
					{
						scheme: "https",
						host: "app.nanitabeyo.net",
						pathPrefix: "/",
					},
					{
						scheme: "https",
						host: "*.supabase.co",
					},
					{
						scheme: "nanitabeyo",
					},
				],
				category: ["BROWSABLE", "DEFAULT"],
			},
			// #1400 (PR2) 他アプリの共有シート（ACTION_SEND）から text/plain を受け取る入口。
			//
			// これを足すと MainActivity が Android の「共有」の候補に並ぶ。上の VIEW（App Links /
			// カスタムスキーム）とは **別の intent-filter として並べる**こと。同じ filter に action を
			// 足すと SEND にも VIEW の data（scheme / host）条件が掛かり、共有シートに出なくなる。
			//
			// ⚠️ 共有は URL ではなく `Intent.EXTRA_TEXT`（文字列 extra）で来るので
			// `Linking.getInitialURL()` では拾えない。読み取りは `lib/sharedTextSource.android.ts`。
			//
			// mimeType を `text/*` ではなく `text/plain` に絞っているのは、扱えるのが
			// 「SNS の URL を含む素のテキスト」だけだからである。広げると共有シートには出るのに
			// 「取り込めません」しか返せない経路が増える。
			{
				action: "SEND",
				category: ["DEFAULT"],
				data: [{ mimeType: "text/plain" }],
			},
		],
		config: {
			googleMaps: {
				apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY,
			},
		},
	},
	web: {
		bundler: "metro",
		output: "static",
		favicon: "./assets/images/favicon.20260207.png",
	},
	locales: {
		ar: "./languages/ar-SA.json",
		en: "./languages/en-US.json",
		es: "./languages/es-ES.json",
		fr: "./languages/fr-FR.json",
		hi: "./languages/hi-IN.json",
		ja: "./languages/ja-JP.json",
		ko: "./languages/ko-KR.json",
		zh: "./languages/zh-CN.json",
	},
	plugins: [
		"expo-router",
		"expo-video",
		"expo-audio",
		"expo-notifications",
		// #1016 【設計】Androidは既存のgoogle-services.json(android.googleServicesFile)を利用する。
		// iOS用GoogleService-Info.plistは未配置のため、ios.googleServicesFileは未設定のまま。
		// prebuild/EASビルドでiOSネイティブプロジェクトを生成する場合はオーナー確認のうえ配置が必要。
		"@react-native-firebase/app",
		"@react-native-firebase/perf",
		[
			"expo-splash-screen",
			{
				backgroundColor: "#ffffff",
				ios: {
					image: "./assets/images/splash-icon.png",
					resizeMode: "cover",
					enableFullScreenImage_legacy: true,
				},
				android: {
					image: "./assets/images/icon.png",
				},
			},
		],
		[
			"expo-camera",
			{
				cameraPermission: "$(PRODUCT_NAME) uses the camera to identify spots and give audio guides.",
			},
		],
		[
			"expo-image-picker",
			{
				photosPermission: "Used to save captured spot photos to your library.",
			},
		],
		[
			"expo-location",
			{
				locationAlwaysAndWhenInUsePermission:
					"Allow $(PRODUCT_NAME) to use your location to find nearby places and provide location-based guides.",
				locationAlwaysPermission:
					"Allow $(PRODUCT_NAME) to use your location to find nearby places and provide location-based guides.",
				locationWhenInUsePermission:
					"Allow $(PRODUCT_NAME) to use your location to find nearby places and provide location-based guides.",
				isIosBackgroundLocationEnabled: false,
				isAndroidBackgroundLocationEnabled: false,
			},
		],
		[
			"react-native-google-mobile-ads",
			{
				androidAppId: "ca-app-pub-8992436220024710~7855939059",
				iosAppId: "ca-app-pub-8992436220024710~3141802451",
				skAdNetworkItems: [
					"cstr6suwn9.skadnetwork",
					"4fzdc2evr5.skadnetwork",
					"2fnua5tdw4.skadnetwork",
					"ydx93a7ass.skadnetwork",
					"p78axxw29g.skadnetwork",
					"v72qych5uu.skadnetwork",
					"ludvb6z3bs.skadnetwork",
					"cp8zw746q7.skadnetwork",
					"3sh42y64q3.skadnetwork",
					"c6k4g5qg8m.skadnetwork",
					"s39g8k73mm.skadnetwork",
					"3qy4746246.skadnetwork",
					"hs6bdukanm.skadnetwork",
					"mlmmfzh3r3.skadnetwork",
					"v4nxqhlyqp.skadnetwork",
					"wzmmz9fp6w.skadnetwork",
					"su67r6k2v3.skadnetwork",
					"yclnxrl5pm.skadnetwork",
					"7ug5zh24hu.skadnetwork",
					"gta9lk7p23.skadnetwork",
					"vutu7akeur.skadnetwork",
					"y5ghdn5j9k.skadnetwork",
					"v9wttpbfk9.skadnetwork",
					"n38lu8286q.skadnetwork",
					"47vhws6wlr.skadnetwork",
					"kbd757ywx3.skadnetwork",
					"9t245vhmpl.skadnetwork",
					"a2p9lx4jpn.skadnetwork",
					"22mmun2rn5.skadnetwork",
					"4468km3ulz.skadnetwork",
					"2u9pt9hc89.skadnetwork",
					"8s468mfl3y.skadnetwork",
					"ppxm28t8ap.skadnetwork",
					"uw77j35x4d.skadnetwork",
					"pwa73g5rt2.skadnetwork",
					"578prtvx9j.skadnetwork",
					"4dzt52r2t5.skadnetwork",
					"tl55sbb4fm.skadnetwork",
					"e5fvkxwrpn.skadnetwork",
					"8c4e2ghe7u.skadnetwork",
					"3rd42ekr43.skadnetwork",
					"3qcr597p9d.skadnetwork",
				],
			},
		],
		// #1156 【設計】use_frameworks! 環境で React Native Core の非モジュラーヘッダ include が
		// -Werror になるのを抑止する（react-native-maps が SDK 54 で踏んだ）。詳細はプラグイン内のコメント参照。
		"./plugins/withNonModularHeaders",
		// #1156 【設計】release ビルドの lint が metaspace 不足で OOM になるのを防ぐ。
		// EAS の development は debug ビルドなので踏まないが、Detox E2E と preview/production は踏む。
		"./plugins/withAndroidGradleMemory",
		[
			"expo-build-properties",
			{
				ios: {
					useFrameworks: "static",
				},
			},
		],
		"expo-font",
		"expo-web-browser",
		"expo-localization",
		[
			// #1400（親 #1375）PR3: iOS の共有シートから nanitabeyo へ取り込むための Share Extension。
			// Android は android.intentFilters（ACTION_SEND）が別に担当しており、ここでは iOS だけ有効化する
			// （disableAndroid: true）。識別子は #1472 でオーナーが Apple Developer 側に登録済みの値
			// と一致させること — ずれると Share Extension のプロビジョニングが解決できない。
			"expo-share-intent",
			{
				disableAndroid: true,
				iosAppGroupIdentifier: "group.com.nanitabeyo",
				iosShareExtensionBundleIdentifier: "com.nanitabeyo.ShareExtension",
				// 既定は Web URL/Web ページのみ。SNS アプリの共有シートはプレーンテキスト（キャプション等）で
				// 渡してくることも多いため、text も受け付ける（Android の text/plain と同じ対象範囲に揃える）
				iosActivationRules: {
					NSExtensionActivationSupportsWebURLWithMaxCount: 1,
					NSExtensionActivationSupportsWebPageWithMaxCount: 1,
					NSExtensionActivationSupportsText: true,
				},
			},
		],
		...(process.env.EXPO_PUBLIC_FACEBOOK_APP_ID && process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN
			? [
				[
					// #492 【設計】Meta SDK (react-native-fbsdk-next) プラグイン設定
					// expo config は eas build 実行の際に走るため、環境変数がないと落ちる。そのため、env が無ければスキップにする
					"react-native-fbsdk-next",
					{
						appID: process.env.EXPO_PUBLIC_FACEBOOK_APP_ID,
						clientToken: process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN,
						displayName: "nanitabeyo",
						advertiserIDCollectionEnabled: true,
						autoLogAppEventsEnabled: true,
						isAutoInitEnabled: true,
					},
				] as [string, any],
			]
			: []),
		...(process.env.E2E_DETOX === "1"
			? [
				// #1027 【設計】Detox E2E 用プラグイン（androidTest 設定・Network Security Config を注入する）
				// 通常の EAS ビルドへ混入させないため、E2E ビルド時のみ E2E_DETOX=1 で有効化する
				"@config-plugins/detox",
				// #1016 【設計】Detox の androidTest APK が持ち込む古い protobuf が firebase-perf と衝突し、
				// JS が動く前に FirebaseInitProvider で NoSuchMethodError を起こすのを防ぐ。
				// 必ず @config-plugins/detox の後に置く（androidTest の依存が入ってから除外する）
				"./plugins/withDetoxProtobufFix",
			]
			: []),
		[
			// #492 【設計】ATT (App Tracking Transparency) ダイアログ設定
			"expo-tracking-transparency",
			{
				userTrackingPermission:
					"This identifier will be used to deliver personalized ads to you. By allowing, you help us improve our service.",
			},
		],
	],
	experiments: {
		typedRoutes: true,
	},
	extra: {
		eas: {
			projectId: "e01a92f1-0341-4eb5-84cc-61b8cef1a8f1",
		},
		EXPO_PUBLIC_COMMIT_ID: process.env.EXPO_PUBLIC_COMMIT_ID,
		EXPO_PUBLIC_NODE_ENV: process.env.EXPO_PUBLIC_NODE_ENV,
		EXPO_PUBLIC_APP_STORE_URL: process.env.EXPO_PUBLIC_APP_STORE_URL,
		EXPO_PUBLIC_PLAY_STORE_URL: process.env.EXPO_PUBLIC_PLAY_STORE_URL,
		EXPO_PUBLIC_BACKEND_BASE_URL: process.env.EXPO_PUBLIC_BACKEND_BASE_URL,
		EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY: process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY,
		EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
		EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
		EXPO_PUBLIC_DB_SCHEMA: process.env.EXPO_PUBLIC_DB_SCHEMA,
		EXPO_PUBLIC_CDN_PUBLIC_HOST: process.env.EXPO_PUBLIC_CDN_PUBLIC_HOST,
		EXPO_PUBLIC_GCS_STATIC_MASTER_DIR_PATH: process.env.EXPO_PUBLIC_GCS_STATIC_MASTER_DIR_PATH,
		EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL_UNIT_ID: process.env.EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL_UNIT_ID,
		EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL_UNIT_ID: process.env.EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL_UNIT_ID,
		EXPO_PUBLIC_ADMOB_ANDROID_BANNER_UNIT_ID: process.env.EXPO_PUBLIC_ADMOB_ANDROID_BANNER_UNIT_ID,
		EXPO_PUBLIC_ADMOB_IOS_BANNER_UNIT_ID: process.env.EXPO_PUBLIC_ADMOB_IOS_BANNER_UNIT_ID,
		EXPO_PUBLIC_WEB_BASE_URL: process.env.EXPO_PUBLIC_WEB_BASE_URL,
		EXPO_PUBLIC_FACEBOOK_APP_ID: process.env.EXPO_PUBLIC_FACEBOOK_APP_ID,
		EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN: process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN,
	},
});
