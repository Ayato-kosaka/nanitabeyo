import type { NotificationCategory } from "../../constants/notificationCategories";

/**
 * 通知カテゴリ 1 件の受信設定。
 *
 * `enabled` は **必ず解決済みの値**（行が無ければカテゴリの既定値で埋めたもの）。
 * クライアントに既定値ロジックを持たせないため、API 側で埋めてから返す。
 */
export interface NotificationPreference {
	category: NotificationCategory;
	enabled: boolean;
}

/**
 * GET /v1/users/me/notification-preferences レスポンス
 *
 * `NOTIFICATION_CATEGORIES` の全カテゴリを、その並び順で返す。
 */
export interface QueryMeNotificationPreferencesResponse {
	data: NotificationPreference[];
}

/**
 * PATCH /v1/users/me/notification-preferences/{category} レスポンス
 *
 * 更新後の値をそのまま返す（クライアントは楽観更新の確定に使う）。
 */
export type UpdateMeNotificationPreferenceResponse = NotificationPreference;
