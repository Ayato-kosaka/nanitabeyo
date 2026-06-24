/**
 * #856 【責務】
 * group vote の detail を取得・再取得する。
 *
 * 画面更新は Realtime の差分適用ではなく、この hook の refresh を通じた再取得で揃える。
 */
import { useCallback, useEffect, useState } from "react";
import type { DishCategoryGroupVoteDetailResponse } from "@shared/api/v1/res";
import { useAPICall } from "@/hooks/useAPICall";

export function useDishCategoryGroupVoteDetail(shareToken?: string) {
	const { callBackend } = useAPICall();
	const [detail, setDetail] = useState<DishCategoryGroupVoteDetailResponse | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		if (!shareToken) return null;

		setIsLoading(true);
		setError(null);
		try {
			const nextDetail = await callBackend<Record<string, never>, DishCategoryGroupVoteDetailResponse>(
				`v1/dish-category-group-votes/${shareToken}`,
				{
					method: "GET",
					requestPayload: {},
				},
			);
			setDetail(nextDetail);
			return nextDetail;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setError(message);
			throw err;
		} finally {
			setIsLoading(false);
		}
	}, [callBackend, shareToken]);

	useEffect(() => {
		refresh().catch(() => {
			// #856 【設計】画面側は error state を読む。初回取得失敗をここで再throwすると
			// Expo Router の画面ライフサイクル外に例外が漏れるため握る。
		});
	}, [refresh]);

	return {
		detail,
		isLoading,
		error,
		refresh,
	};
}
