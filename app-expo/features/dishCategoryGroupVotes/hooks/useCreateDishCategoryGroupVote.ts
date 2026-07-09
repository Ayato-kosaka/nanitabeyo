/**
 * #856 【責務】
 * topics 画面から group vote セッションを新規作成する。
 *
 * ここでは visibleTopics を候補スナップショットとして送るだけに留め、
 * 画面遷移や snackbar は呼び出し側に返す。API 呼び出しと request payload の
 * 形を固定することで、topics 以外からも同じ作成ロジックを再利用できる。
 */
import { useCallback, useState } from "react";
import type { CreateDishCategoryGroupVoteDto } from "@shared/api/v1/dto";
import type { CreateDishCategoryGroupVoteResponse } from "@shared/api/v1/res";
import type { SearchParams, Topic } from "@/types/search";
import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";

type CreateGroupVoteInput = {
	searchParams: SearchParams;
	topics: Topic[];
};

export function useCreateDishCategoryGroupVote() {
	const [isCreating, setIsCreating] = useState(false);
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();

	const createGroupVote = useCallback(
		async ({ searchParams, topics }: CreateGroupVoteInput) => {
			const visibleTopics = topics.filter((topic) => !topic.isHidden);
			if (visibleTopics.length === 0) {
				throw new Error("No visible topics to create a group vote");
			}

			const requestPayload: CreateDishCategoryGroupVoteDto = {
				searchContext: {
					location: {
						latitude: searchParams.location.latitude,
						longitude: searchParams.location.longitude,
					},
					radius: searchParams.distance,
					priceLevels: searchParams.priceLevels,
					localLanguageCode: searchParams.localLanguageCode,
				},
				candidates: visibleTopics.map((topic) => ({
					dishCategoryId: topic.categoryId,
					displayName: topic.topicTitle,
					tagline: topic.reason,
					imageUrl: topic.imageUrl,
				})),
			};

			setIsCreating(true);
			try {
				logFrontendEvent({
					event_name: "dish_category_group_vote_create_started",
					error_level: "log",
					payload: { candidateCount: requestPayload.candidates.length },
				});

				const response = await callBackend<CreateDishCategoryGroupVoteDto, CreateDishCategoryGroupVoteResponse>(
					"v1/dish-category-group-votes",
					{
						method: "POST",
						requestPayload,
					},
				);

				logFrontendEvent({
					event_name: "dish_category_group_vote_create_succeeded",
					error_level: "log",
					payload: {
						candidateCount: requestPayload.candidates.length,
						shareToken: response.shareToken,
					},
				});

				return response;
			} catch (error) {
				logFrontendEvent({
					event_name: "dish_category_group_vote_create_failed",
					error_level: "log",
					payload: {
						candidateCount: visibleTopics.length,
						error: error instanceof Error ? error.message : String(error),
					},
				});
				throw error;
			} finally {
				setIsCreating(false);
			}
		},
		[callBackend, logFrontendEvent],
	);

	return {
		createGroupVote,
		isCreating,
	};
}
