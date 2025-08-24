import * as dotenv from "dotenv";
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
		associatedDomains: [`applinks:food-scroll.web.app`],
		infoPlist: {
			ITSAppUsesNonExemptEncryption: false,
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
			foregroundImage: "./assets/images/adaptive-icon.png",
			backgroundColor: "#ffffff",
		},
		intentFilters: [
			{
				action: "VIEW",
				autoVerify: true,
				data: [
					{
						scheme: "https",
						host: "food-scroll.web.app",
						pathPrefix: "/",
					},
				],
				category: ["BROWSABLE", "DEFAULT"],
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
		favicon: "./assets/images/favicon.png",
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
		[
			"expo-splash-screen",
			{
				image: "./assets/images/splash-icon.png",
				resizeMode: "contain",
				backgroundColor: "#ffffff",
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
		EXPO_PUBLIC_GCS_BUCKET_NAME: process.env.EXPO_PUBLIC_GCS_BUCKET_NAME,
		EXPO_PUBLIC_GCS_STATIC_MASTER_DIR_PATH: process.env.EXPO_PUBLIC_GCS_STATIC_MASTER_DIR_PATH,
		EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL_UNIT_ID: process.env.EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL_UNIT_ID,
		EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL_UNIT_ID: process.env.EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL_UNIT_ID,
		EXPO_PUBLIC_ADMOB_ANDROID_BANNER_UNIT_ID: process.env.EXPO_PUBLIC_ADMOB_ANDROID_BANNER_UNIT_ID,
		EXPO_PUBLIC_ADMOB_IOS_BANNER_UNIT_ID: process.env.EXPO_PUBLIC_ADMOB_IOS_BANNER_UNIT_ID,
		EXPO_PUBLIC_WEB_BASE_URL: process.env.EXPO_PUBLIC_WEB_BASE_URL,
	},
});
