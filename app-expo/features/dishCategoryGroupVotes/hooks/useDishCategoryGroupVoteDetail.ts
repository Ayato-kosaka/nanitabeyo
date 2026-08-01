/**
 * #856 【責務】
 * group vote の detail を取得・再取得する。
 *
 * 画面更新はこの hook の refresh を通じた再取得で揃える。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DishCategoryGroupVoteDetailResponse } from "@shared/api/v1/res";
import { useAPICall } from "@/hooks/useAPICall";
import { toErrorLogMessage } from "@/lib/errorMessage";

export function useDishCategoryGroupVoteDetail(shareToken?: string) {
	const { callBackend } = useAPICall();
	const [detail, setDetail] = useState<DishCategoryGroupVoteDetailResponse | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const detailRef = useRef<DishCategoryGroupVoteDetailResponse | null>(null);

	useEffect(() => {
		detailRef.current = detail;
	}, [detail]);

	const refresh = useCallback(async () => {
		if (!shareToken) return null;

		const hadDetail = detailRef.current !== null;
		setIsLoading(true);
		if (!hadDetail) {
			setError(null);
		}
		try {
			const nextDetail = await callBackend<Record<string, never>, DishCategoryGroupVoteDetailResponse>(
				`v1/dish-category-group-votes/${shareToken}`,
				{
					method: "GET",
					requestPayload: {},
				},
			);
			setDetail(nextDetail);
			setError(null);
			return nextDetail;
		} catch (err) {
			const message = toErrorLogMessage(err);
			if (!hadDetail) {
				setError(message);
			}
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
