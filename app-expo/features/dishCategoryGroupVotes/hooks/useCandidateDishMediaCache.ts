/**
 * #856 【責務】
 * 候補の店舗提案用 dish-media キャッシュ状態を解釈する。
 *
 * 今は接続スケルトンで、未検索/0件/候補ありの分岐だけを画面に渡す。
 * 実検索の実装は topics 側の既存検索ロジックをどう共通化するかに依存する。
 */
import { useCallback, useState } from "react";
import type { DishCategoryGroupVoteCandidate } from "@shared/api/v1/res";
import { useLogger } from "@/hooks/useLogger";

type UseCandidateDishMediaCacheParams = {
	cacheCandidateDishMedia: (candidateId: string, dishMediaIds: string[]) => Promise<unknown>;
	onOpenCachedDishMedia?: (candidate: DishCategoryGroupVoteCandidate, dishMediaIds: string[]) => void;
};

export function useCandidateDishMediaCache({
	cacheCandidateDishMedia,
	onOpenCachedDishMedia,
}: UseCandidateDishMediaCacheParams) {
	const [loadingCandidateId, setLoadingCandidateId] = useState<string | null>(null);
	const { logFrontendEvent } = useLogger();

	const openCandidateDishMedia = useCallback(
		async (candidate: DishCategoryGroupVoteCandidate) => {
			logFrontendEvent({
				event_name: "dish_category_group_vote_candidate_dish_media_open_requested",
				error_level: "log",
				payload: { candidateId: candidate.id, status: candidate.dishMediaSearchStatus },
			});
			if (candidate.dishMediaSearchStatus === "found") {
				logFrontendEvent({
					event_name: "dish_category_group_vote_candidate_dish_media_open_cached",
					error_level: "log",
					payload: { candidateId: candidate.id, dishMediaCount: candidate.dishMediaIds.length },
				});
				onOpenCachedDishMedia?.(candidate, candidate.dishMediaIds);
				return;
			}

			if (candidate.dishMediaSearchStatus === "empty") {
				logFrontendEvent({
					event_name: "dish_category_group_vote_candidate_dish_media_open_empty",
					error_level: "log",
					payload: { candidateId: candidate.id },
				});
				return;
			}

			setLoadingCandidateId(candidate.id);
			try {
				// #856 【設計】共有リンク参加者は元の検索画面 params を持たない。
				// 実装時は detail.session.searchContext と candidate.dishCategoryId を使って
				// 既存 dish-media 検索を実行し、その結果IDを PATCH で固定する。
				await cacheCandidateDishMedia(candidate.id, []);
			} finally {
				setLoadingCandidateId(null);
			}
		},
		[cacheCandidateDishMedia, onOpenCachedDishMedia],
	);

	return {
		loadingCandidateId,
		openCandidateDishMedia,
	};
}
