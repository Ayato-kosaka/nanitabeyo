/**
 * #856 【責務】
 * group vote の mutation を集約する。
 *
 * submit / delete / dish-media cache 更新は、成功後に detail refresh へ戻す。
 * Realtime に自分自身の結果を依存させないため、mutation 成功と refresh を同じ境界に置く。
 */
import { useCallback } from "react";
import type {
	DeleteDishCategoryGroupVoteCandidateResponse,
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
			// #856 【設計】自分の mutation は Realtime 到着を待たずに detail を再取得する。
			// participants INSERT 購読は他参加者の更新通知であり、自分の整合性の根拠にはしない。
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
		cacheCandidateDishMedia,
	};
}
