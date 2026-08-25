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
import { generateUUID } from "@/lib/uuid";

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
	/**
	 * #1507 【修正】再送をまたいで同じ値になる冪等キー。
	 *
	 * 上の `isCreatingRef` が守れるのは「同一 JS タスク内の連打」だけで、
	 * 通信のリトライ・オフライン復帰後の再送・再マウントでは POST が二重に届く。
	 * API 側は body の `idempotencyKey` が同じなら新しいセッションを作らず既存の
	 * セッション（同じ shareToken）を返すので、**同じ作成意図のあいだキーを固定する**。
	 *
	 * - 生成は「作成意図」につき 1 回。初回呼び出し時に lazy 生成して ref に保持する
	 * - **成功したら破棄する**。次は別の作成意図なので、新しいキーで新しいセッションを作る
	 * - **失敗しても保持する**。ユーザーの再タップや自動再送が同じキーで飛び、
	 *   「サーバーには届いていたがレスポンスが落ちた」ケースで既存セッションが返る
	 */
	const idempotencyKeyRef = useRef<string | null>(null);
	/**
	 * #1507 キーを紐付けている作成意図の中身。
	 *
	 * 失敗後に候補や検索条件を変えて再試行すると「同じキー・別の payload」になり、
	 * サーバーは**古い内容の既存セッション**を返してしまう。入力が変わったら
	 * 別の作成意図として扱い、キーを作り直す。
	 */
	const idempotencyPayloadRef = useRef<string | null>(null);
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

			const requestBody = {
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

			// #1507 入力が前回と同じなら「同じ作成意図の再試行」としてキーを使い回し、
			// 違うなら新しい作成意図としてキーを作り直す。
			// 署名は body そのものから採るので、候補や検索条件の追加漏れが起きない。
			const payloadSignature = JSON.stringify(requestBody);
			if (idempotencyPayloadRef.current !== payloadSignature) {
				idempotencyPayloadRef.current = payloadSignature;
				idempotencyKeyRef.current = generateUUID();
			}

			const requestPayload: CreateDishCategoryGroupVoteDto = {
				...requestBody,
				idempotencyKey: idempotencyKeyRef.current ?? undefined,
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

				// #1507 成功したらキーを捨てる。ここを消すと、次の「別の作成意図」まで
				// 同じキーで飛んで、サーバーが前回のセッションを返し続ける（新規作成できなくなる）。
				idempotencyKeyRef.current = null;
				idempotencyPayloadRef.current = null;

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
