import { useState, useEffect, useCallback } from "react";
import { useNotificationsAPI } from "./useNotificationsAPI";
import { useAuth } from "@/contexts/AuthProvider";
import { useLogger } from "./useLogger";

/**
 * 📬 未読通知数管理フック
 *
 * - GET /v1/notifications/unread-count で未読数を取得
 * - 認証状態が変わったら自動更新
 * - 手動更新用の refresh 関数を提供
 */
export const useUnreadNotifications = () => {
	const { getUnreadCount } = useNotificationsAPI();
	const { isAuthenticated, user } = useAuth();
	const { logFrontendEvent } = useLogger();
	const [unreadCount, setUnreadCount] = useState(0);
	const [isLoading, setIsLoading] = useState(false);

	const fetchUnreadCount = useCallback(async () => {
		// #通知機能 【仕様】匿名ユーザーは未読数を取得しない
		if (!isAuthenticated || !user || user.is_anonymous) {
			setUnreadCount(0);
			return;
		}

		try {
			setIsLoading(true);
			const { unread } = await getUnreadCount();
			setUnreadCount(unread);

			logFrontendEvent({
				event_name: "unread_notifications_fetched",
				error_level: "log",
				payload: { unread },
			});
		} catch (error: any) {
			logFrontendEvent({
				event_name: "unread_notifications_fetch_error",
				error_level: "error",
				payload: { error: error.message },
			});
			// エラー時は未読数を0にリセット
			setUnreadCount(0);
		} finally {
			setIsLoading(false);
		}
	}, [isAuthenticated, user, getUnreadCount, logFrontendEvent]);

	// 認証状態が変わったら自動更新
	useEffect(() => {
		fetchUnreadCount();
	}, [isAuthenticated, user?.id, user?.is_anonymous]); // #通知機能 【バグ】匿名状態の変化も監視する

	return {
		unreadCount,
		isLoading,
		refresh: fetchUnreadCount,
	};
};
