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
