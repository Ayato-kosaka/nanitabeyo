import { useState, useCallback } from "react";
import { useAPICall } from "../../../hooks/useAPICall";
import { useAuth } from "@/contexts/AuthProvider";
import { isGuestUser } from "@/lib/authGuest";
import type { UnreadCountResponse } from "@shared/api/v1/res";

/**
 * 🔔 未読通知数取得フック
 *
 * - GET /v1/notifications/unread-count を利用
 * - 認証済みユーザーのみ取得
 * - 定期的にポーリングを行わず、手動更新のみ
 *
 * @returns { unreadCount, refresh, loading } - 未読数とリフレッシュ関数
 */
export const useNotificationUnreadCount = () => {
	const { callBackend } = useAPICall();
	const { user } = useAuth();
	const [unreadCount, setUnreadCount] = useState<number>(0);
	const [loading, setLoading] = useState(false);

	const refresh = useCallback(async () => {
		// #通知機能 【設計】匿名ユーザーは未読数を取得しない
		// #1092 PR4b 判定は共通化（lib/authGuest.ts）。通知タブの表示可否と同じ式にしておく
		if (isGuestUser(user)) {
			setUnreadCount(0);
			return;
		}

		try {
			setLoading(true);
			const response = await callBackend<Record<string, never>, UnreadCountResponse>("v1/notifications/unread-count", {
				method: "GET",
				requestPayload: {},
			});
			setUnreadCount(response.unread);
		} catch (error) {
			// エラー時は黙って 0 にする
			setUnreadCount(0);
		} finally {
			setLoading(false);
		}
	}, [user, callBackend]);

	return { unreadCount, refresh, loading };
};
