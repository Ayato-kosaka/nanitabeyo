import { useCallback } from "react";
import { asApiList } from "@/lib/apiList";
import { useCursorPagination } from "../../../hooks/useCursorPagination";
import { useAPICall } from "../../../hooks/useAPICall";
import type { QueryNotificationsResponse, NotificationItem } from "@shared/api/v1/res";
import type { QueryNotificationsDto } from "@shared/api/v1/dto";

/**
 * 🔔 通知一覧取得フック
 *
 * - GET /v1/notifications を利用してキーセットページング
 * - useCursorPagination でスクロール管理
 * - 無限スクロールに対応
 *
 * @returns CursorPaginationResult - 通知一覧とページング制御
 */
export const useNotifications = () => {
	const { callBackend } = useAPICall();

	const fetcher = useCallback(
		async ({ cursor }: { cursor?: string | null }) => {
			const params: Record<string, string> = {};
			if (cursor) {
				params.cursor = cursor;
			}
			params.limit = "30";

			const response = await callBackend<QueryNotificationsDto, QueryNotificationsResponse>("v1/notifications", {
				method: "GET",
				requestPayload: params,
			});
			return {
				data: asApiList(response.data),
				nextCursor: response.nextCursor,
			};
		},
		[callBackend],
	);

	return useCursorPagination<QueryNotificationsDto, NotificationItem>(fetcher);
};
