import { Env } from "../constants/Env";
import type { RemoteConfigValues } from "@shared/remoteConfig/remoteConfig.schema";
import { Database } from "@shared/supabase/database.types";
import { TableRow } from "@shared/utils/devDB.types";

/**
 * #1092 Remote Config の値の出所。
 * - `default`: CDN からまだ取得できていない（未初期化 or 取得失敗）。`DEFAULT_REMOTE_CONFIG` で動いている
 * - `network`: CDN の config.json を取得済み
 */
export type RemoteConfigSource = "default" | "network";

/**
 * #1092 アプリへ埋め込む Remote Config の既定値。
 *
 * 【なぜ必要か】
 * これまで `getRemoteConfig()` は初期化前に null を返し、呼び出し側は
 * `parseInt(getRemoteConfig()?.v1_search_result_restaurants_number!, 10)` のように
 * 値が在ることを前提に書いていた。null のまま参照されると `parseInt(undefined) = NaN` になり、
 * その NaN が API の DTO（件数）へ渡って 400 になりうる。
 * 現状は `SplashHandler` が Remote Config の確定を待ってから描画するので表面化しないが、
 * 「描画を先行させる」設計（#1092 の後続 PR）には null 耐性が前提になる。
 *
 * 【値の根拠】
 * 2026-07-29 版（`meta.version: "v2026.07.29"`）の本番 config.json と同値。
 * 「サーバ側で値を変えてもアプリが古い既定で動く」経路を新設することになるため、
 * 既定値は現行値と一致させ、かつ安全側（= 現行運用と同じ挙動）に倒す。
 *
 * ⚠️ この module から `enqueueLog()` / `useLogger().logFrontendEvent()` を呼んではならない。
 *    `hooks/useLogger.ts` はログレベル判定のため `getRemoteConfig()` を読んでおり、
 *    ここでログを出すと logFrontendEvent → getRemoteConfig → logFrontendEvent の相互再帰になる
 *    （#1079 の `lib/logQueue.ts` sendBatch と同じ規律）。
 *    値の出所は `getRemoteConfigSource()` を公開するに留め、ログ送信は
 *    ログ経路の外側（`components/SplashHandler.tsx`）で 1 回だけ行う。
 */
export const DEFAULT_REMOTE_CONFIG: RemoteConfigValues = Object.freeze({
	// ── (a) app-expo が実際に読むキー（`getRemoteConfig` の参照箇所は以下の 5 つだけ）──
	//    ここが古いと実害が出うるので config.json と同値を維持すること。

	/**
	 * `hooks/useLogger.ts` — フロントログの送信閾値。
	 * 既存のフォールバックは `?? "debug"` だが、既定値は本番 config.json と同じ "log" にする。
	 * "debug" のままだと CDN へ到達できない端末だけがより多くのログを送ることになり、
	 * ログ送信のレート制限（#1089 / #1101 の 429）を踏みやすくなる。少ない側が安全側。
	 */
	v1_min_frontend_log_level: "log",
	/** `features/topics/hooks/useTopicSearch.ts` — 検索結果に出す料理カテゴリ数 */
	v1_search_result_dish_categories_number: "6",
	/** `lib/dishMediaSearch.ts` / `useTopicSearch.ts` — 検索結果に出すレストラン数 */
	v1_search_result_restaurants_number: "5",
	/** `features/dishMedia/components/DishReviewsSection.tsx` — コメントを省略する文字数 */
	v1_dish_comment_review_show_number: "140",
	/** `features/dishMedia/hooks/useMediaTracking.ts` — 画像の閲覧完了とみなす滞在時間(ms) */
	v1_dish_media_image_completion_threshold_ms: "3000",

	// ── (b) app-expo からは 1 箇所も参照されていないキー ──
	//    バックエンド専用。`RemoteConfigValues` 型を満たすために置いているだけで、
	//    フロントがこの値を読む経路は無い（= 古くなっても無害）。値は上記と同じ 2026-07-29 版。
	//    特に is_maintenance / minimum_supported_version をフロントは読まない。メンテナンスと
	//    強制アップデートは API の 503 / 426（`hooks/useAPICall.ts`）で検知しているので、
	//    既定値を持つことでメンテ告知が漏れることはない。
	is_maintenance: "false",
	minimum_supported_version: "1.0.0",
	v1_min_backend_log_level: "verbose",
	v1_enable_prisma_query_logs: "true",
	TOOLS_DISH_CATEGORIES_POPULAR_EXCLUDED_CATEGORY_IDS:
		"Q177378,Q1063096,Q471866,Q1061856,Q220964,Q188788,Q11771087,Q549713,Q182940,Q134992253,Q187495,Q1827035,Q112818476,Q1381277,Q1317601,Q2089240,Q1051155,Q182940,Q30524428,Q2089240,Q842566,Q202677,Q4833218,Q2078349,Q1477592,Q614448,Q866153,Q29330,Q477248,Q1105215",
	dish_category_recommendation_weight_time_slot: "1.5",
	dish_category_recommendation_weight_scene: "1.1",
	dish_category_recommendation_weight_satiety: "1",
	dish_category_recommendation_weight_taste: "5",
	dish_category_recommendation_weight_budget_intent: "2.2",
	dish_category_recommendation_weight_dining_pace: "2.2",
	dish_category_recommendation_weight_core_ingredient: "8",
	dish_category_recommendation_weight_market_salience: "0.05",
	dish_category_recommendation_weight_dine_out_orderability: "0.1",
	dish_category_recommendation_score_jitter_ratio: "0.12",
	dish_category_recommendation_penalty_weight_core_ingredient: "0.003",
	dish_category_recommendation_penalty_weight_taste: "0.0005",
	dish_category_recommendation_penalty_weight_cooking_method: "0.003",
	// config.json には存在しないキー。schema 側で `.optional().default("true")` を持つので同値にする
	v1_bulk_import_preflight_enabled: "true",
});

// キャッシュ用のローカル変数（#1092 初期値は null ではなく埋め込みの既定値）
let cachedValues: RemoteConfigValues = DEFAULT_REMOTE_CONFIG;
let currentSource: RemoteConfigSource = "default";

/**
 * CDN から静的マスタを取得
 *
 * @param tableName - テーブル名
 * @returns テーブルのデータ
 */
const fetchStaticMasterFromCDN = async <T extends keyof Database["dev"]["Tables"]>(
	tableName: T,
): Promise<TableRow<T>[]> => {
	// CDN の URL を組み立て
	const cdnUrl = `https://${Env.CDN_PUBLIC_HOST}/${Env.GCS_STATIC_MASTER_DIR_PATH}${tableName}.json`;

	const res = await fetch(cdnUrl);
	if (!res.ok) {
		throw new Error(`Failed to load static master from CDN. ${tableName}.json is not found.`);
	}

	const jsonData = await res.json();

	if (!jsonData) {
		throw new Error(`Failed to load static master from CDN. ${tableName}.json is empty.`);
	} else if (jsonData.data === undefined) {
		throw new Error(`Failed to load static master from CDN. ${tableName}.json is undefined.`);
	} else if (!Array.isArray(jsonData.data)) {
		throw new Error(`Failed to load static master from CDN. ${tableName} is invalid.`);
	}

	return jsonData.data as unknown as TableRow<T>[];
};

/**
 * 静的マスタから設定データを取得
 *
 * 取得に成功するまでは既定値のままなので、失敗しても呼び出し側は値を読める（例外は throw する）。
 *
 * @returns 設定データ
 */
export const initRemoteConfig = async (): Promise<RemoteConfigValues> => {
	// #1092 既定値は常に truthy なので、`cachedValues` の有無ではなく
	// 「CDN から取得済みか」でキャッシュ判定する（従来どおりプロセス内で 1 回だけ取得する）
	if (currentSource === "network") return cachedValues;

	// 🔄 静的マスタから設定データを取得
	const configJson = await fetchStaticMasterFromCDN("config");
	const config = configJson.reduce(
		(acc, config) => {
			acc[config.key] = config.value;
			return acc;
		},
		{} as Record<string, string>,
	);

	// #1092 CDN 側にキーが欠けていても undefined を配らない（従来は undefined → parseInt で NaN）。
	// 取得できたキーは常に CDN の値が既定値を上書きする
	cachedValues = { ...DEFAULT_REMOTE_CONFIG, ...(config as Partial<RemoteConfigValues>) };
	currentSource = "network";
	return cachedValues;
};

/**
 * キャッシュされた Remote Config の値を取得する。
 *
 * #1092 初期化前・初期化失敗時は `DEFAULT_REMOTE_CONFIG` を返す（null は返さない）。
 * 最新値が要るなら起動時に `initRemoteConfig` を呼び出すこと。
 *
 * @returns Remote Config 値（未取得なら埋め込みの既定値）
 */
export const getRemoteConfig = (): RemoteConfigValues => cachedValues;

/**
 * #1092 いま返している値の出所。
 * 「既定値のまま動いている端末がどれだけ在るか」を観測するために公開している。
 *
 * ⚠️ ここでログを出さないこと（上の `DEFAULT_REMOTE_CONFIG` の注意書きを参照）。
 *
 * @returns `default` or `network`
 */
export const getRemoteConfigSource = (): RemoteConfigSource => currentSource;
