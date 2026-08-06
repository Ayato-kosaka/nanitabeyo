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
 * 料理提案画面スポットライトチュートリアルの表示済みフラグ。
 * app-expo/features/topics/hooks/useTopicsTutorial.ts と必ず一致させる。
 */
export const TOPICS_TUTORIAL_STORAGE_KEY = "topics_spotlight_tutorial_seen_v1";

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

/**
 * 料理提案画面チュートリアルを「表示済み」としてシードする。
 *
 * 料理提案画面を操作する既存E2Eがスポットライトに遮られないよう、
 * 専用spec以外ではfixtureから既定で適用する。
 */
export async function seedTopicsTutorialAsSeen(context: BrowserContext): Promise<void> {
	await context.addInitScript((key) => {
		window.localStorage.setItem(key, "true");
	}, TOPICS_TUTORIAL_STORAGE_KEY);
}

/**
 * 「最近使った場所」の保存キー。
 * app-expo/features/search/hooks/useRecentLocations.ts の RECENT_LOCATIONS_STORAGE_KEY と一致させること。
 *
 * ⚠️ ホーム（さがすタブ）と保存料理カテゴリの地点検索モーダルは **同じキー** を共有する（#1133）。
 * ここを片方だけ変えると「ホームで選んだ地点がモーダルに出ない」不具合になる。
 */
export const RECENT_LOCATIONS_STORAGE_KEY = "recent_locations_v1";

/**
 * 「最近使った場所」1件分の最小形。
 *
 * 実体は app-expo の `RecentLocation`（= LocationDetailsResponse から viewport を除いたもの
 *  + locationQuery）だが、e2e-web からは @shared/app-expo の型を参照できないため、
 * 画面が実際に読む項目だけをここで定義する。
 * - `locationQuery`: パネルに表示される文字列
 * - `location`: 再選択時に details API を呼ばずに検索へ進むための緯度経度
 */
export type SeededRecentLocation = {
	locationQuery: string;
	location: { latitude: number; longitude: number };
	address?: string;
	localLanguageCode?: string;
};

/**
 * 「最近使った場所」を事前シードする（#1133）。
 *
 * 実 API（autocomplete → details）を経由して 1 件積むこともできるが、
 * 「パネルが何件で、どんな文字列で描画されるか」を固定したいテストでは
 * 実 API の候補文言に依存させたくないため、localStorage を直接シードする。
 * 「ホームと本当に共有されているか」を見るテストだけは実 API 経由で積むこと
 * （シードだと共有そのものを検証したことにならない）。
 *
 * @param context ブラウザコンテキスト（ページ生成前に呼ぶこと）
 * @param locations 新しい順に並べた地点（先頭が最新。アプリ側の上限は5件）
 */
export async function seedRecentLocations(
	context: BrowserContext,
	locations: SeededRecentLocation[],
): Promise<void> {
	await context.addInitScript(
		([key, value]) => {
			window.localStorage.setItem(key as string, value as string);
		},
		[RECENT_LOCATIONS_STORAGE_KEY, JSON.stringify(locations)] as const,
	);
}
