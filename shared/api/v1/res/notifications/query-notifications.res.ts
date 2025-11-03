import { SupabaseNotifications } from "../../../../converters/convert_notifications";
import { DishMediaEntry } from "../dish-media.response";

/**
 * 通知レスポンス（SupabaseNotifications から actionType と targetTable を抽出）
 */
export type NotificationResponse = Omit<SupabaseNotifications, 'action_type' | 'target_table'> & {
	action_type: 'like' | 'save';
	target_table: 'dish_media' | 'dish_reviews';
};

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
	notification: NotificationResponse;
	actors: NotificationActor[];
	dishMediaEntiries?: DishMediaEntry;
}

/**
 * GET /v1/notifications レスポンス
 */
export interface QueryNotificationsResponse {
	items: NotificationItem[];
	nextCursor: string | null;
}
