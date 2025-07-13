import * as dotenv from "dotenv";
import { ExpoConfig, ConfigContext } from "@expo/config";
import { version } from "./package.json"

export default ({ config }: ConfigContext): ExpoConfig => ({
	...config,
	"name": "dish-scroll",
	"slug": "dish-scroll",
	owner: "dish-scroll",
	runtimeVersion: version.split(".").slice(0, 2).join("."),
	version,
	orientation: "portrait",
	icon: "./assets/images/icon.png",
	scheme: "myapp",
	// updates: {
	// 	url: "https://u.expo.dev/d29cfcb3-535a-4c11-8493-49f7d4c92289",
	// },
	userInterfaceStyle: "automatic",
	newArchEnabled: true,
	ios: {
		// bundleIdentifier: "",
		buildNumber: "1",
		supportsTablet: false,
		infoPlist: {
			ITSAppUsesNonExemptEncryption: false,
		},
		config: {
			googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY,
		},
	},
	android: {
		// package: "",
		versionCode: 1,
		adaptiveIcon: {
			foregroundImage: "./assets/images/adaptive-icon.png",
			backgroundColor: "#ffffff",
		},
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
	"plugins": ["expo-router", "expo-font", "expo-web-browser"],
	"experiments": {
		"typedRoutes": true
	},
	extra: {
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
	},
});
