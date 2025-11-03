import { useCallback } from "react";
import { useAPICall } from "./useAPICall";
import type { MarkAllReadResponse } from "@shared/api/v1/res";

/**
 * 🔔 通知一括既読フック
 *
 * - POST /v1/notifications/mark-all-read を利用
 * - 通知一覧画面入場時に呼び出し
 *
 * @returns { markAllAsRead } - 一括既読関数
 */
export const useMarkNotificationsRead = () => {
	const { callBackend } = useAPICall();

	const markAllAsRead = useCallback(async () => {
		try {
			await callBackend<Record<string, never>, MarkAllReadResponse>("v1/notifications/mark-all-read", {
				method: "POST",
				requestPayload: {},
			});
		} catch (error) {
			// エラー時は黙って失敗させる
			console.error("Failed to mark notifications as read:", error);
		}
	}, [callBackend]);

	return { markAllAsRead };
};
