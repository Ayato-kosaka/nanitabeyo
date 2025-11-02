import { SupabaseNotifications } from "../../../../converters/convert_notifications";
import { DishMediaEntry } from "../dish-media.response";

/**
 * 通知のアクター（先頭3件のユーザー情報）
 */
export interface NotificationActor {
	id: string;
	display_name: string | null;
	avatar: string | null;
}

/**
 * 通知アイテム（アクターとターゲットコンテンツを含む）
 */
export interface NotificationItem {
	notification: SupabaseNotifications;
	actors: NotificationActor[];
	target?: DishMediaEntry;
}

/**
 * GET /v1/notifications レスポンス
 */
export interface QueryNotificationsResponse {
	items: NotificationItem[];
	nextCursor: string | null;
}
