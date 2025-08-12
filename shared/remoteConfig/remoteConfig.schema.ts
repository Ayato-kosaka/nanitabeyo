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
});

export type RemoteConfigValues = z.infer<typeof remoteConfigSchema>;
