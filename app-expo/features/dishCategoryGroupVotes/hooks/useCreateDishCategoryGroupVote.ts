/**
 * #856 【責務】
 * dishCategories 画面から group vote セッションを新規作成する。
 *
 * ここでは visibleDishCategories を候補スナップショットとして送るだけに留め、
 * 画面遷移や snackbar は呼び出し側に返す。API 呼び出しと request payload の
 * 形を固定することで、dishCategories 以外からも同じ作成ロジックを再利用できる。
 */
import { useCallback, useRef, useState } from "react";
import type { CreateDishCategoryGroupVoteDto } from "@shared/api/v1/dto";
import type { CreateDishCategoryGroupVoteResponse } from "@shared/api/v1/res";
import type { SearchParams, DishCategoryRecommendation } from "@/types/search";
import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import { toErrorLogMessage } from "@/lib/errorMessage";

type CreateGroupVoteInput = {
	searchParams: SearchParams;
	dishCategories: DishCategoryRecommendation[];
};

export function useCreateDishCategoryGroupVote() {
	const [isCreating, setIsCreating] = useState(false);
	/**
	 * #1205 【修正】作成中の多重実行を防ぐ同期ガード。
	 *
	 * 表示用の `isCreating`(useState) は多重実行の判定には使えない。React が再レンダリングを
	 * コミットする前に 2 発目の押下が処理されると、両方が `isCreating === false` を読んで
	 * 通過しうるためで、通過すると `POST v1/dish-category-group-votes` が二重に走り、
	 * **別々の shareToken を持つ投票セッションが 2 件作られる**（API 側に冪等化は無い）。
	 *
	 * ref への代入は同期的に確定するため、同一 JS タスク内の連続呼び出しでもレースしない。
	 * search/index.tsx の `isSearchingRef`、map/components/ReviewForm.tsx の `isSubmittingRef` と同じ方式。
	 *
	 * 解除は下の try..finally で行うため、成功・失敗のどちらでも必ず落ちる
	 * （try 側へ散らすと例外経路で解除漏れが起き、一度失敗すると二度と作成できなくなる）。
	 */
	const isCreatingRef = useRef(false);
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();

	/**
	 * 投票セッションを作成する。
	 *
	 * @returns 作成できたレスポンス。**作成中の 2 発目として抑止された場合は `null`**。
	 *          呼び出し側は `null` のとき画面遷移を行わないこと（遷移すると結果画面が二重に開く）。
	 */
	const createGroupVote = useCallback(
		async ({ searchParams, dishCategories }: CreateGroupVoteInput): Promise<CreateDishCategoryGroupVoteResponse | null> => {
			// #1205 作成中の 2 発目は「失敗」ではないので throw せず null で返す。
			// throw にすると呼び出し側のエラー表示（Snackbar）が連打のたびに出てしまう。
			if (isCreatingRef.current) return null;

			const visibleDishCategories = dishCategories.filter((dishCategory) => !dishCategory.isHidden);
			if (visibleDishCategories.length === 0) {
				throw new Error("No visible dishCategories to create a group vote");
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
				candidates: visibleDishCategories.map((dishCategory) => ({
					dishCategoryId: dishCategory.categoryId,
					displayName: dishCategory.title,
					tagline: dishCategory.reason,
					imageUrl: dishCategory.imageUrl,
				})),
			};

			// #1205 ここより後に API 呼び出しを書くこと（ガードより手前へ出すと連打で二重に走る）。
			isCreatingRef.current = true;
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
						candidateCount: visibleDishCategories.length,
						error: toErrorLogMessage(error),
					},
				});
				throw error;
			} finally {
				// #1205 失敗時も必ず解除する。ここを try 側へ移すと「1 回失敗したら二度と押せない」になる。
				isCreatingRef.current = false;
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
