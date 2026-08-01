import Constants from "expo-constants";
import { UNKNOWN_BUILD_META_CLIENT } from "@shared/api/v1/constants/build-meta";

const extra = Constants.expoConfig?.extra ?? {};

export const Env = {
	// ⚠️ #1078 APP_VERSION には絶対にフォールバック値を入れないこと。
	// この値は lib/fetchWithAuth.ts の x-app-version ヘッダ（全 API リクエスト共通）に乗る。
	// x-app-version が "unknown-client" のような非バージョン文字列になると
	// api/src/core/guards/maintenance.guard.ts の isVersionGreaterOrEqual が NaN 比較で
	// 常に false になり、全 API が 426 Upgrade Required で死ぬ。
	// ここが今まで無事なのは「undefined なら安全」だからではなく、APP_VERSION が
	// package.json 由来（app.config.ts）で常に値を持つから。ログ用の既定値は
	// hooks/useLogger.ts のログ組み立て時に限定する。
	APP_VERSION: Constants.expoConfig?.version as string,
	EAS_PROJECT_ID: extra.eas.projectId as string,
	// #1078 EXPO_PUBLIC_COMMIT_ID を注入しない環境（ローカル開発 / E2E CI）で undefined になり、
	// フロントログが 400 で全滅した（#1076）。参照元は useLogger のみなので Env 側で既定値を持たせて良い。
	// ?? ではなく || を使う: eas-cli env:pull が `EXPO_PUBLIC_COMMIT_ID=` を書き出すと空文字になり、
	// 空文字は @IsString() を通過して BigQuery に "" が入り 'unknown-' 述語から漏れるため。
	// ⚠️ APP_VERSION には同じことをしないこと（下記コメント参照）
	//
	// #1076 process.env を第1候補にする。web と native で config の作られ方が違うため:
	//   web    … babel-preset-expo の expo-inline-manifest-plugin がバンドラのプロセス内で
	//            getConfig() を評価するので extra 経由で確実に届く
	//   native … Gradle の :expo-constants:createExpoConfig が別プロセスで app.config アセットを
	//            生成するため、`.env` 追記が黙って落ちうる（@expo/env は空文字を truthy チェックで
	//            捨て、.env.local を .env より優先する）。実際に E2E Mobile で unknown-client になった
	// process.env.EXPO_PUBLIC_* は babel-preset-expo の inline-env-vars が production バンドル時に
	// リテラルへ置換するため、app.config アセット経路とは独立した第2の供給路になる。
	// 片方が壊れてももう片方で拾えるようにしておく（両経路とも同じ値が入る想定）。
	COMMIT_ID:
		process.env.EXPO_PUBLIC_COMMIT_ID ||
		(extra.EXPO_PUBLIC_COMMIT_ID as string | undefined) ||
		UNKNOWN_BUILD_META_CLIENT,
	NODE_ENV: extra.EXPO_PUBLIC_NODE_ENV as string,
	APP_STORE_URL: extra.EXPO_PUBLIC_APP_STORE_URL as string,
	PLAY_STORE_URL: extra.EXPO_PUBLIC_PLAY_STORE_URL as string,
	BACKEND_BASE_URL: extra.EXPO_PUBLIC_BACKEND_BASE_URL as string,
	GOOGLE_MAPS_WEB_API_KEY: extra.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY as string,
	SUPABASE_URL: extra.EXPO_PUBLIC_SUPABASE_URL as string,
	SUPABASE_ANON_KEY: extra.EXPO_PUBLIC_SUPABASE_ANON_KEY as string,
	// DB_SCHEMA: extra.EXPO_PUBLIC_DB_SCHEMA as keyof Database,
	DB_SCHEMA: extra.EXPO_PUBLIC_DB_SCHEMA as string,
	CDN_PUBLIC_HOST: extra.EXPO_PUBLIC_CDN_PUBLIC_HOST as string,
	GCS_STATIC_MASTER_DIR_PATH: extra.EXPO_PUBLIC_GCS_STATIC_MASTER_DIR_PATH as string,
	ADMOB_ANDROID_INTERSTITIAL_UNIT_ID: extra.EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL_UNIT_ID as string,
	ADMOB_IOS_INTERSTITIAL_UNIT_ID: extra.EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL_UNIT_ID as string,
	ADMOB_ANDROID_BANNER_UNIT_ID: extra.EXPO_PUBLIC_ADMOB_ANDROID_BANNER_UNIT_ID as string,
	ADMOB_IOS_BANNER_UNIT_ID: extra.EXPO_PUBLIC_ADMOB_IOS_BANNER_UNIT_ID as string,
	WEB_BASE_URL: extra.EXPO_PUBLIC_WEB_BASE_URL as string,
	FACEBOOK_APP_ID: extra.EXPO_PUBLIC_FACEBOOK_APP_ID as string,
	FACEBOOK_CLIENT_TOKEN: extra.EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN as string,
};
