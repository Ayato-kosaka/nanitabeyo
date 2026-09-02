/**
 * #856 【責務】
 * group vote の mutation を集約する。
 *
 * submit / delete / dish-media cache 更新は、成功後に detail refresh へ戻す。
 * 自分自身の画面更新を他画面の polling に依存させないため、mutation 成功と refresh を同じ境界に置く。
 */
import { useCallback } from "react";
import type {
	DeleteDishCategoryGroupVoteCandidateResponse,
	RestoreDishCategoryGroupVoteCandidateResponse,
	SubmitDishCategoryGroupVoteResponse,
	UpdateDishCategoryGroupVoteCandidateDishMediaResponse,
} from "@shared/api/v1/res";
import type {
	SubmitDishCategoryGroupVoteDto,
	UpdateDishCategoryGroupVoteCandidateDishMediaDto,
} from "@shared/api/v1/dto";
import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";

type ActionsParams = {
	sessionId?: string;
	refresh: () => Promise<unknown>;
};

export function useDishCategoryGroupVoteActions({ sessionId, refresh }: ActionsParams) {
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();

	const submitVote = useCallback(
		async (dto: SubmitDishCategoryGroupVoteDto) => {
			if (!sessionId) throw new Error("sessionId is required");

			const response = await callBackend<SubmitDishCategoryGroupVoteDto, SubmitDishCategoryGroupVoteResponse>(
				`v1/dish-category-group-votes/${sessionId}/vote`,
				{
					method: "POST",
					requestPayload: dto,
				},
			);
			logFrontendEvent({
				event_name: "dish_category_group_vote_submit_api_succeeded",
				error_level: "log",
				payload: { sessionId, voteCount: dto.votes.length },
			});
			// #856 【設計】自分の mutation は detail を即時再取得する。
			// 他画面の polling を待たずに、自分の整合性はこの refresh で確定させる。
			await refresh();
			return response;
		},
		[callBackend, refresh, sessionId],
	);

	const deleteCandidate = useCallback(
		async (candidateId: string) => {
			if (!sessionId) throw new Error("sessionId is required");

			const response = await callBackend<Record<string, never>, DeleteDishCategoryGroupVoteCandidateResponse>(
				`v1/dish-category-group-votes/${sessionId}/candidates/${candidateId}`,
				{
					method: "DELETE",
					requestPayload: {},
				},
			);
			logFrontendEvent({
				event_name: "dish_category_group_vote_candidate_deleted",
				error_level: "log",
				payload: { sessionId, candidateId },
			});
			await refresh();
			return response;
		},
		[callBackend, refresh, sessionId],
	);

	// #943 【仕様】削除のUndo導線。deleteCandidateと対になる操作で、成功後はrefreshで整合させる。
	const restoreCandidate = useCallback(
		async (candidateId: string) => {
			if (!sessionId) throw new Error("sessionId is required");

			const response = await callBackend<Record<string, never>, RestoreDishCategoryGroupVoteCandidateResponse>(
				`v1/dish-category-group-votes/${sessionId}/candidates/${candidateId}/restore`,
				{
					method: "PATCH",
					requestPayload: {},
				},
			);
			logFrontendEvent({
				event_name: "dish_category_group_vote_candidate_restored",
				error_level: "log",
				payload: { sessionId, candidateId },
			});
			await refresh();
			return response;
		},
		[callBackend, refresh, sessionId],
	);

	const cacheCandidateDishMedia = useCallback(
		async (candidateId: string, dishMediaIds: string[]) => {
			if (!sessionId) throw new Error("sessionId is required");

			const response = await callBackend<
				UpdateDishCategoryGroupVoteCandidateDishMediaDto,
				UpdateDishCategoryGroupVoteCandidateDishMediaResponse
			>(`v1/dish-category-group-votes/${sessionId}/candidates/${candidateId}/dish-media`, {
				method: "PATCH",
				requestPayload: { dishMediaIds },
			});
			logFrontendEvent({
				event_name: "dish_category_group_vote_candidate_dish_media_cached",
				error_level: "log",
				payload: { sessionId, candidateId, dishMediaIdsLength: dishMediaIds.length },
			});
			await refresh();
			return response;
		},
		[callBackend, refresh, sessionId],
	);

	return {
		submitVote,
		deleteCandidate,
		restoreCandidate,
		cacheCandidateDishMedia,
	};
}
