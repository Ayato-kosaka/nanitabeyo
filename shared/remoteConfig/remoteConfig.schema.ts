import { z } from "zod";
import { $Enums } from "../prisma";

export const remoteConfigSchema = z.object({
	is_maintenance: z.string(),
	minimum_supported_version: z.string(),
	v1_min_frontend_log_level: z.enum(
		Object.values($Enums.backend_event_logs_error_level) as [
			keyof typeof $Enums.backend_event_logs_error_level,
			...(keyof typeof $Enums.backend_event_logs_error_level)[],
		],
	),
	v1_min_backend_log_level: z.enum(
		Object.values($Enums.backend_event_logs_error_level) as [
			keyof typeof $Enums.backend_event_logs_error_level,
			...(keyof typeof $Enums.backend_event_logs_error_level)[],
		],
	),
	v1_enable_prisma_query_logs: z.string(),
	v1_search_result_dish_categories_number: z.string(),
	v1_search_result_restaurants_number: z.string(),
	v1_dish_comment_review_show_number: z.string(),
	v1_dish_media_image_completion_threshold_ms: z.string(),
	TOOLS_DISH_CATEGORIES_POPULAR_EXCLUDED_CATEGORY_IDS: z.string(),
	dish_category_recommendation_weight_time_slot: z.string(),
	dish_category_recommendation_weight_scene: z.string(),
	dish_category_recommendation_weight_satiety: z.string(),
	dish_category_recommendation_weight_taste: z.string(),
	dish_category_recommendation_weight_budget_intent: z.string(),
	dish_category_recommendation_weight_dining_pace: z.string(),
	dish_category_recommendation_weight_core_ingredient: z.string(),
	dish_category_recommendation_weight_market_salience: z.string(),
	dish_category_recommendation_weight_dine_out_orderability: z.string(),
	/**
	 * #737 季節補正の重み。`final_score × (1 - w + w × season_score)` の w。
	 *
	 * season_score は `dish_category_features(feature_type='season')` の値で、
	 * 平常月 = 1.0。**行が無いカテゴリは COALESCE で 1.0 になり係数もちょうど 1.0** なので、
	 * データ未投入でも既存の挙動は一切変わらない。`"0"` にすると季節補正を完全に無効化できる。
	 *
	 * 【値の根拠】既定 0.25。8 月の実測季節指数を入れて 3 条件 × 各 2 万回シミュレートし、
	 * 「冬型 13 件が 6 枚に入る確率」で決めた（#737）。効き方は検索条件で 10 倍違う。
	 *
	 *   条件         w=0.1    w=0.2   w=0.25   w=0.3
	 *   昼×一人       0.40%   0.00%   0.00%   0.00%
	 *   深夜×飲み    25.89%   4.60%   0.73%   0.04%   ← ここが最も効きにくい
	 *   条件なし      0.03%   0.00%   0.00%   0.00%
	 *
	 * 0.25 は最悪条件でも 0.73%（≒137回に1回）まで落ちつつ、「たまには鍋も」を残す値。
	 * 0.3 以上は実質 0 になり、0.1 以下は深夜×飲みで 4 回に 1 回おでんが出る。
	 *
	 * ⚠️ #880 は市場性/注文しやすさの重みを 0.02〜0.1 と決めたが、あれは**全 134 件に付く
	 * feature** の話。season はレビューで承認した約 20 件にしか付かず、残り 114 件の順位は
	 * w に関係なく 1 つも動かない（係数がちょうど 1.0）。
	 * 重みの大小は feature の密度とセットで判断する。
	 *
	 * ⚠️ 必ず optional + default にすること（下の v1_bulk_import_preflight_enabled と同じ理由）。
	 * 必須キーを足すと、GCS の config.json を更新するまで**実在する他キーの読み取りまで全部 throw する**。
	 */
	dish_category_recommendation_weight_season: z.string().optional().default("0.25"),
	dish_category_recommendation_score_jitter_ratio: z.string(),
	dish_category_recommendation_penalty_weight_core_ingredient: z.string(),
	dish_category_recommendation_penalty_weight_taste: z.string(),
	dish_category_recommendation_penalty_weight_cooking_method: z.string(),
	/**
	 * #1053 bulk-import の preflight lookup（既存 dish_media の再利用）を on/off する。
	 *
	 * `"false"` で従来の「常に新規作成」へ戻せる。DB 由来の不具合が出たときに
	 * コードデプロイなしで退避するための逃げ道。
	 *
	 * ⚠️ 必ず optional + default にすること。このスキーマは要求されたキーだけでなく
	 * config 全体を safeParse するため、**必須キーを1つでも足すと、GCS の config.json を
	 * 同時に更新するまで「実在する他のキーの読み取りまで全部 throw する」**。
	 * バックエンドは全 RemoteConfig 呼び出しが落ち、一方フロントは Zod を通さず
	 * キャストしているだけなので無症状のまま——という気づきにくい壊れ方をする。
	 */
	v1_bulk_import_preflight_enabled: z.string().optional().default("true"),
});

export type RemoteConfigValues = z.infer<typeof remoteConfigSchema>;
