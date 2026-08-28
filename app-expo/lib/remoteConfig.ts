import AsyncStorage from "@react-native-async-storage/async-storage";

import { Env } from "../constants/Env";
import type { RemoteConfigValues } from "@shared/remoteConfig/remoteConfig.schema";
import { Database } from "@shared/supabase/database.types";
import { TableRow } from "@shared/utils/devDB.types";

/**
 * #1092 Remote Config の値の出所。
 * - `default`: CDN からも端末の保存領域からも値を得ていない。`DEFAULT_REMOTE_CONFIG` で動いている
 * - `cache`: 前回の起動で CDN から取得し AsyncStorage に保存しておいた値で動いている（stale）
 * - `network`: この起動で CDN の config.json を取得済み（fresh）
 *
 * `SplashHandler` の `remote_config_resolved` ログでこの内訳を送っており、
 * 「CDN へ到達できないまま古い値で動いている端末」の割合を後から BigQuery で追える。
 */
export type RemoteConfigSource = "default" | "cache" | "network";

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
 * 【既知の限界】(#1110)
 * ここの値の根拠は**本番**の config.json だが、CI ゲート
 * （`scripts/assert-remote-config-defaults.mjs`）が突き合わせるのは、同じ job の E2E が叩くのと
 * 同じ **development** の config.json である。両環境の値がずれると
 * 「本番の既定値は正しいのに CI が落ちる」偽陽性が起こりうる。
 * それでも development を見るのは、この job で守りたいのが「E2E が実際に読む値」との一致だから。
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
	/** `features/dishCategories/hooks/useDishCategorySearch.ts` — 検索結果に出す料理カテゴリ数 */
	v1_search_result_dish_categories_number: "6",
	/** `lib/dishMediaSearch.ts` / `useDishCategorySearch.ts` — 検索結果に出すレストラン数 */
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
	// config.json には存在しないキー。schema 側で `.optional().default(...)` を持つので同値にする
	v1_bulk_import_preflight_enabled: "true",
	dish_category_recommendation_weight_season: "0.25",
});

/**
 * #1092 PR3 CDN から取得した値を端末へ残す AsyncStorage のキー。
 *
 * 保存フォーマットを変えるときは末尾の版番号を上げること。読めない形式は黙って捨てて
 * 既定値へフォールバックする（`hydrateFromStorage`）ので、移行コードは要らない。
 */
export const REMOTE_CONFIG_STORAGE_KEY = "@nanitabeyo/remote_config/v1";

/** 保存フォーマットの版。`REMOTE_CONFIG_STORAGE_KEY` の版番号と対で管理する */
const PERSISTED_FORMAT_VERSION = 1;

/**
 * #1092 PR3 CDN の config.json 取得に掛ける上限時間(ms)。
 *
 * `retry()` は **reject でしか再試行しない**ので、settle しない fetch（プロキシや
 * キャプティブポータルに吸われた接続など）が 1 本あると初期化がそこで永久に止まる。
 * PR3 で描画はこれを待たなくなったため起動不能にはならないが、
 * 「いつまでも network へ昇格しない端末」が生まれるので上限を置いて再試行へ回す。
 */
export const REMOTE_CONFIG_FETCH_TIMEOUT_MS = 8000;

/** AsyncStorage へ保存する形。`values` は **CDN から実際に取得できたキーだけ** */
type PersistedRemoteConfig = {
	version: number;
	values: Record<string, string>;
};

// キャッシュ用のローカル変数（#1092 初期値は null ではなく埋め込みの既定値）
let cachedValues: RemoteConfigValues = DEFAULT_REMOTE_CONFIG;
let currentSource: RemoteConfigSource = "default";
/** AsyncStorage の読み出しを 1 プロセスに 1 回だけにする（`retry()` で再入するため） */
let hasHydratedFromStorage = false;

/**
 * 未知の値から「文字列の値だけを持つ辞書」を取り出す。
 *
 * 保存領域の中身は前のアプリ版が書いたものかもしれず、壊れていることもある。
 * 数値や null が紛れ込むと `parseInt` 経路が NaN になるので、ここで型を絞る。
 *
 * @param input - JSON.parse の結果など、素性の分からない値
 * @returns 文字列の値だけを残した辞書（取り出せなければ空）
 */
const toStringRecord = (input: unknown): Record<string, string> => {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
	return Object.fromEntries(
		Object.entries(input as Record<string, unknown>).filter(([, value]) => typeof value === "string"),
	) as Record<string, string>;
};

/**
 * #1092 PR3 stale-while-revalidate の "stale" 側。
 * 前回の起動で保存しておいた CDN の値を読み、既定値へ重ねて即座に使えるようにする。
 *
 * 失敗（未保存 / 壊れた JSON / ストレージ障害）はすべて握り潰す。
 * ここで throw すると CDN 取得まで巻き添えで落ちるし、既定値で動けるので実害が無い。
 *
 * ⚠️ ここでログを出さないこと（`DEFAULT_REMOTE_CONFIG` の注意書きを参照）。
 */
const hydrateFromStorage = async (): Promise<void> => {
	if (hasHydratedFromStorage) return;
	hasHydratedFromStorage = true;

	try {
		const raw = await AsyncStorage.getItem(REMOTE_CONFIG_STORAGE_KEY);
		if (!raw) return;

		const parsed = JSON.parse(raw) as Partial<PersistedRemoteConfig> | null;
		if (!parsed || parsed.version !== PERSISTED_FORMAT_VERSION) return;

		const values = toStringRecord(parsed.values);
		if (Object.keys(values).length === 0) return;

		// 🛑 読み出しを待っている間に CDN の取得が先に終わっていたら、新しい値を古い値で潰さない
		if (currentSource === "network") return;

		cachedValues = { ...DEFAULT_REMOTE_CONFIG, ...(values as Partial<RemoteConfigValues>) };
		currentSource = "cache";
	} catch {
		// 保存領域が読めなくても既定値で動ける。ここで落ちる理由は無い
	}
};

/**
 * #1092 PR3 次回起動のために CDN の値を端末へ残す。
 *
 * 既定値とマージした後の値ではなく **CDN から取得できたキーだけ**を保存する。
 * こうしておくと、アプリを更新して `DEFAULT_REMOTE_CONFIG` が新しくなったときに、
 * CDN が返していないキーは新しい既定値の方が使われる（古い既定値が保存領域に居座らない）。
 *
 * @param values - CDN の config.json から得たキーと値
 */
const persistToStorage = async (values: Record<string, string>): Promise<void> => {
	try {
		const payload: PersistedRemoteConfig = { version: PERSISTED_FORMAT_VERSION, values };
		await AsyncStorage.setItem(REMOTE_CONFIG_STORAGE_KEY, JSON.stringify(payload));
	} catch {
		// 保存できなくても今回の起動には影響しない（次回また CDN から取り直すだけ）
	}
};

/**
 * タイムアウト付きで JSON を取得する。
 *
 * `AbortSignal.timeout()` は Hermes を含む一部の実行環境に無いので、AbortController を自前で回す。
 * 中断されると fetch は reject するため、呼び出し側の `retry()` がそのまま再試行に乗る。
 *
 * ⚠️ **ボディの読み取り（`res.json()`）までを上限の内側に入れること。**
 *    fetch の解決はヘッダ受信時点なので、そこで `clearTimeout` してしまうと
 *    「ヘッダだけ返してボディで止まるサーバ / プロキシ」に当たったときに
 *    この Promise が永遠に settle せず、`retry()` にも乗らない。
 *    そうなるとその端末は二度と `network` へ昇格できない（保存値か既定値のまま固定される）。
 *    描画自体は #1092 PR3 でブロックされなくなったが、無期限に待つ理由は無い。
 *
 * @param url - 取得先 URL
 * @param timeoutMs - ヘッダ受信からボディ読み取り完了までの上限時間(ms)
 * @returns HTTP ステータスが ok なら解析済み JSON、そうでなければ `ok: false`
 */
const fetchJsonWithTimeout = async (
	url: string,
	timeoutMs: number,
): Promise<{ ok: true; json: unknown } | { ok: false; json?: undefined }> => {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, { signal: controller.signal });
		if (!res.ok) return { ok: false };
		return { ok: true, json: await res.json() };
	} finally {
		clearTimeout(timeoutId);
	}
};

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

	const res = await fetchJsonWithTimeout(cdnUrl, REMOTE_CONFIG_FETCH_TIMEOUT_MS);
	if (!res.ok) {
		throw new Error(`Failed to load static master from CDN. ${tableName}.json is not found.`);
	}

	const jsonData = res.json as { data?: unknown } | null;

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
 * 静的マスタから設定データを取得（#1092 PR3 stale-while-revalidate）
 *
 * 1. まず AsyncStorage に保存された前回の CDN 値を既定値へ重ねて **即座に使えるようにする**（stale）
 * 2. 続いて CDN を取りに行き、取れたら上書きして保存する（revalidate）
 *
 * 描画はこの完了を待たない（`components/SplashHandler.tsx`）。取得に成功するまでは
 * 保存値 or 既定値のままなので、失敗しても呼び出し側は値を読める（例外は throw する）。
 *
 * @returns 設定データ
 */
export const initRemoteConfig = async (): Promise<RemoteConfigValues> => {
	// #1092 既定値は常に truthy なので、`cachedValues` の有無ではなく
	// 「CDN から取得済みか」でキャッシュ判定する（従来どおりプロセス内で 1 回だけ取得する）
	if (currentSource === "network") return cachedValues;

	// 💾 保存済みの値を先に反映する。CDN より桁違いに速いので、これで「起動直後は既定値、
	//    数秒後に本番値」ではなく「起動直後から前回の本番値」になる。
	//    ⚠️ 呼び出し側は `retry()` でここへ再入するが、読み出しは 1 回だけ（hasHydratedFromStorage）
	await hydrateFromStorage();

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
	// 取得できたキーは常に CDN の値が既定値・保存値を上書きする
	cachedValues = { ...DEFAULT_REMOTE_CONFIG, ...(config as Partial<RemoteConfigValues>) };
	currentSource = "network";

	// 次回起動でこの値を即座に使えるようにする。保存に失敗しても握り潰す（今回の起動には影響しない）
	await persistToStorage(config);

	return cachedValues;
};

/**
 * キャッシュされた Remote Config の値を取得する。
 *
 * #1092 初期化前・初期化失敗時は保存値、それも無ければ `DEFAULT_REMOTE_CONFIG` を返す（null は返さない）。
 * 最新値が要るなら起動時に `initRemoteConfig` を呼び出すこと。
 *
 * @returns Remote Config 値（未取得なら保存値 or 埋め込みの既定値）
 */
export const getRemoteConfig = (): RemoteConfigValues => cachedValues;

/**
 * #1092 いま返している値の出所。
 * 「既定値／古い保存値のまま動いている端末がどれだけ在るか」を観測するために公開している。
 *
 * ⚠️ ここでログを出さないこと（上の `DEFAULT_REMOTE_CONFIG` の注意書きを参照）。
 *
 * @returns `default` / `cache` / `network`
 */
export const getRemoteConfigSource = (): RemoteConfigSource => currentSource;
