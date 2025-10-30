import { SupabaseNotifications } from "../../../../supabase/database.types";

/**
 * GET /v1/notifications レスポンス
 */
export interface QueryNotificationsResponse {
	items: SupabaseNotifications[];
	nextCursor: string | null;
}
