import { useCallback } from "react";
import { useAPICall } from "./useAPICall";
import { useLogger } from "./useLogger";
import { useHaptics } from "./useHaptics";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import type { DishMediaReactionBodyDto } from "@shared/api/v1/dto";

// #433 【設計】いいね操作ロジックの一本化（楽観的更新＋失敗時ロールバック）
export function useDishLike() {
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const { lightImpact } = useHaptics();
	const { toggleLike: storeToggleLike, dishEntriesById } = useDishMediaEntriesStore();

	const toggleLike = useCallback(
		async (dishMediaId: string) => {
			lightImpact();

			// 現在の状態を取得
			const currentEntry = dishEntriesById[dishMediaId];
			if (!currentEntry) {
				console.warn(`Dish media entry not found: ${dishMediaId}`);
				return;
			}

			const currentLikeState = currentEntry.isLiked;
			const willLike = !currentLikeState;

			// #433 【設計】楽観的更新：即座に UI に反映
			storeToggleLike(dishMediaId, willLike);

			logFrontendEvent({
				event_name: willLike ? "dish_liked" : "dish_unliked",
				error_level: "log",
				payload: {
					dishMediaId,
					previousLikeCount: currentEntry.dish_media.likeCount,
					newLikeCount: willLike ? currentEntry.dish_media.likeCount + 1 : currentEntry.dish_media.likeCount - 1,
				},
			});

			try {
				if (willLike) {
					await callBackend<DishMediaReactionBodyDto, void>(`v1/dish-media/${dishMediaId}/reaction`, {
						method: "POST",
						requestPayload: { action_type: "like" },
					});
				} else {
					await callBackend<DishMediaReactionBodyDto, void>(`v1/dish-media/${dishMediaId}/reaction`, {
						method: "DELETE",
						requestPayload: { action_type: "like" },
					});
				}
			} catch (error) {
				// #433 【設計】エラー時のロールバック：元の状態に戻す
				storeToggleLike(dishMediaId, currentLikeState);
				
				logFrontendEvent({
					event_name: "dish_like_reaction_failed",
					error_level: "error",
					payload: {
						error: error instanceof Error ? error.message : String(error),
						target_id: dishMediaId,
						action_type: "like",
						willReact: willLike,
					},
				});
			}
		},
		[callBackend, logFrontendEvent, lightImpact, storeToggleLike, dishEntriesById],
	);

	return { toggleLike };
}
