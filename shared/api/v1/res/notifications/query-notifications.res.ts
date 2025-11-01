import { SupabaseNotifications } from "../../../../converters/convert_notifications";

/**
 * GET /v1/notifications レスポンス
 */
export interface QueryNotificationsResponse {
	items: SupabaseNotifications[];
	nextCursor: string | null;
}
