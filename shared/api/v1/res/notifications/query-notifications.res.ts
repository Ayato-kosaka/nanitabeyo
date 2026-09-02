import { SupabaseNotifications } from "../../../../converters/convert_notifications";
import { DishMediaEntry } from "../dish-media.response";
import { PaginatedResponse } from "../paginated-response";
import { UserProfile } from "../users.response";

/**
 * 通知レスポンス（SupabaseNotifications から actionType と targetTable を抽出）
 */
export type NotificationResponse = Omit<SupabaseNotifications, "action_type" | "target_table"> & {
	action_type: "like" | "save" | "vote";
	target_table: "dish_media" | "dish_reviews" | "dish_category_group_vote_sessions";
};

/**
 * 通知のアクター（先頭3件のユーザー情報）
 */
export type NotificationActor = Pick<UserProfile, "id" | "display_name" | "avatarUrls">;

/**
 * GRP-04 投票通知タップ時の遷移先解決に使う、投票セッションの最小情報。
 * shareToken は結果画面 `/[locale]/(tabs)/search/dish-category-group-votes/[shareToken]` の
 * route param そのもの。
 */
export type NotificationDishCategoryGroupVoteSession = {
	id: string;
	shareToken: string;
};

/**
 * 通知アイテム（アクターとターゲットコンテンツを含む）
 */
export interface NotificationItem {
	notification: NotificationResponse;
	actors: NotificationActor[];
	dishMediaEntries?: DishMediaEntry;
	dishCategoryGroupVoteSession?: NotificationDishCategoryGroupVoteSession;
}

/**
 * GET /v1/notifications レスポンス
 */
export type QueryNotificationsResponse = PaginatedResponse<NotificationItem>;
