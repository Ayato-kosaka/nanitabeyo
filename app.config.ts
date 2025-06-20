import * as dotenv from "dotenv";
import { ExpoConfig, ConfigContext } from "@expo/config";
import { version } from "./package.json"

export default ({ config }: ConfigContext): ExpoConfig => ({
	...config,
	"name": "dish-scroll",
	"slug": "dish-scroll",
	version,
	"orientation": "portrait",
	"icon": "./assets/images/icon.png",
	"scheme": "myapp",
	"userInterfaceStyle": "automatic",
	"newArchEnabled": true,
	"ios": {
		"supportsTablet": true
	},
	"web": {
		"bundler": "metro",
		"output": "single",
		"favicon": "./assets/images/favicon.png"
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
		EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
		EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL_UNIT_ID: process.env.EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL_UNIT_ID,
		EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL_UNIT_ID: process.env.EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL_UNIT_ID,
		EXPO_PUBLIC_ADMOB_ANDROID_BANNER_UNIT_ID: process.env.EXPO_PUBLIC_ADMOB_ANDROID_BANNER_UNIT_ID,
		EXPO_PUBLIC_ADMOB_IOS_BANNER_UNIT_ID: process.env.EXPO_PUBLIC_ADMOB_IOS_BANNER_UNIT_ID,
	},
});
