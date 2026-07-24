import type { BrowserContext } from "@playwright/test";

/**
 * 💾 localStorage シード用ユーティリティ
 *
 * アプリは `@react-native-async-storage/async-storage` を使用しており、
 * Web ビルドでは localStorage がバックエンドになる。
 * テストの前提状態（チュートリアル済みなど）は addInitScript で事前にシードする。
 */

/**
 * 検索チュートリアルの表示済みフラグのキー。
 * app-expo/features/search/hooks/useSearchTutorial.ts の TUTORIAL_STORAGE_KEY と一致させること。
 */
export const TUTORIAL_STORAGE_KEY = "search_tutorial_seen_v1";

/**
 * 検索チュートリアルを「表示済み」としてシードする。
 *
 * ja-JP ロケールでは検索タブ初回フォーカス時にチュートリアル BottomSheet が自動表示され、
 * 他のテストの操作を妨げるため、既定では全テストでこのシードを行う
 * （チュートリアル自体のテストのみ意図的にシードを外す）。
 *
 * @param context ブラウザコンテキスト（ページ生成前に呼ぶこと）
 */
export async function seedTutorialAsSeen(context: BrowserContext): Promise<void> {
	await context.addInitScript((key) => {
		window.localStorage.setItem(key, "true");
	}, TUTORIAL_STORAGE_KEY);
}
