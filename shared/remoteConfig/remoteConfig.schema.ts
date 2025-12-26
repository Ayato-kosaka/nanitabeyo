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
	dish_category_recommendation_weight_market_salience: z.string(),
	dish_category_recommendation_weight_dine_out_orderability: z.string(),
	dish_category_recommendation_weighted_random_eps: z.string(),
	dish_category_recommendation_weighted_random_alpha: z.string(),
});

export type RemoteConfigValues = z.infer<typeof remoteConfigSchema>;
