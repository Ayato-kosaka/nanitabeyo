import { useAPICall } from "@/hooks/useAPICall";
import { useCallback } from "react";
import type { QueryNotificationsDto } from "@shared/v1/dto";
import type {
	QueryNotificationsResponse,
	MarkAllReadResponse,
	UnreadCountResponse,
} from "@shared/v1/res";

/**
 * 📬 通知 API サービスフック
 *
 * - GET /v1/notifications - 通知一覧取得（キーセットページング）
 * - POST /v1/notifications/mark-all-read - 通知を一括既読
 * - GET /v1/notifications/unread-count - 未読通知数を取得
 */
export const useNotificationsAPI = () => {
	const { callBackend } = useAPICall();

	/**
	 * 通知一覧を取得
	 */
	const fetchNotifications = useCallback(
		async (params: QueryNotificationsDto): Promise<QueryNotificationsResponse> => {
			return callBackend<QueryNotificationsDto, QueryNotificationsResponse>("v1/notifications", {
				method: "GET",
				requestPayload: params,
			});
		},
		[callBackend],
	);

	/**
	 * 通知を一括既読にする
	 */
	const markAllAsRead = useCallback(async (): Promise<MarkAllReadResponse> => {
		return callBackend<{}, MarkAllReadResponse>("v1/notifications/mark-all-read", {
			method: "POST",
			requestPayload: {},
		});
	}, [callBackend]);

	/**
	 * 未読通知数を取得
	 */
	const getUnreadCount = useCallback(async (): Promise<UnreadCountResponse> => {
		return callBackend<{}, UnreadCountResponse>("v1/notifications/unread-count", {
			method: "GET",
			requestPayload: {},
		});
	}, [callBackend]);

	return {
		fetchNotifications,
		markAllAsRead,
		getUnreadCount,
	};
};
