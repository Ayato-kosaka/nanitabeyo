/**
 * #856 【責務】
 * 候補の店舗提案用 dish-media キャッシュ状態を解釈する。
 *
 * found は既存キャッシュをそのまま開き、not_searched は共有 search helper で検索してから cache する。
 * 0件だった場合は Google Maps fallback を共通 hook で出す。
 */
import { useCallback, useState } from "react";
import type { DishCategoryGroupVoteCandidate, DishCategoryGroupVoteSearchContext } from "@shared/api/v1/res";
import { useAPICall } from "@/hooks/useAPICall";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { useGoogleMapsFallback } from "@/features/search/hooks/useGoogleMapsFallback";
import { createDishItemsForCategory } from "@/lib/dishMediaSearch";

type UseCandidateDishMediaCacheParams = {
	cacheCandidateDishMedia: (candidateId: string, dishMediaIds: string[]) => Promise<unknown>;
	searchContext?: DishCategoryGroupVoteSearchContext;
	onOpenCachedDishMedia?: (candidate: DishCategoryGroupVoteCandidate, dishMediaIds: string[]) => void;
};

export function useCandidateDishMediaCache({
	cacheCandidateDishMedia,
	searchContext,
	onOpenCachedDishMedia,
}: UseCandidateDishMediaCacheParams) {
	const [loadingCandidateId, setLoadingCandidateId] = useState<string | null>(null);
	const { callBackend } = useAPICall();
	const { locale } = useLocale();
	const { logFrontendEvent } = useLogger();
	const { showGoogleMapsFallbackDialog } = useGoogleMapsFallback({ source: "dish_category_group_vote_result_screen" });

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
				if (searchContext) {
					showGoogleMapsFallbackDialog({
						category: candidate.displayName,
						location: searchContext.location,
						locale,
					});
				}
				return;
			}

			if (!searchContext) {
				logFrontendEvent({
					event_name: "dish_category_group_vote_candidate_dish_media_open_missing_search_context",
					error_level: "error",
					payload: { candidateId: candidate.id },
				});
				return;
			}

			setLoadingCandidateId(candidate.id);
			try {
				// #856 【設計】共有リンク参加者は元の検索画面 params を持たない。
				// そのため session の searchContext と候補の dishCategoryId から既存検索 helper を再利用する。
				const dishItems = await createDishItemsForCategory({
					callBackend,
					categoryId: candidate.dishCategoryId,
					categoryName: candidate.displayName,
					latitude: searchContext.location.latitude,
					longitude: searchContext.location.longitude,
					searchLocationLanguageCode: searchContext.localLanguageCode,
					radius: searchContext.radius,
					priceLevels: searchContext.priceLevels,
				});
				const dishMediaIds = dishItems.map((item) => String(item.dish_media.id));
				await cacheCandidateDishMedia(candidate.id, dishMediaIds);
				if (dishMediaIds.length === 0) {
					showGoogleMapsFallbackDialog({
						category: candidate.displayName,
						location: searchContext.location,
						locale,
					});
					return;
				}
				onOpenCachedDishMedia?.(candidate, dishMediaIds);
			} finally {
				setLoadingCandidateId(null);
			}
		},
		[cacheCandidateDishMedia, callBackend, locale, logFrontendEvent, onOpenCachedDishMedia, searchContext, showGoogleMapsFallbackDialog],
	);

	return {
		loadingCandidateId,
		openCandidateDishMedia,
	};
}
