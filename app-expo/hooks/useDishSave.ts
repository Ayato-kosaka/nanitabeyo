import { useCallback } from "react";
import { useAPICall } from "./useAPICall";
import { useLogger } from "./useLogger";
import { useHaptics } from "./useHaptics";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import type { DishMediaReactionBodyDto } from "@shared/api/v1/dto";

// #433 【設計】保存操作ロジックの一本化（楽観的更新＋失敗時ロールバック）
export function useDishSave() {
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const { lightImpact } = useHaptics();
	const { toggleSave: storeToggleSave, dishEntriesById } = useDishMediaEntriesStore();

	const toggleSave = useCallback(
		async (dishMediaId: string) => {
			lightImpact();

			// 現在の状態を取得
			const currentEntry = dishEntriesById[dishMediaId];
			if (!currentEntry) {
				console.warn(`Dish media entry not found: ${dishMediaId}`);
				return;
			}

			const currentSaveState = currentEntry.isSaved;
			const willSave = !currentSaveState;

			// #433 【設計】楽観的更新：即座に UI に反映
			storeToggleSave(dishMediaId, willSave);

			logFrontendEvent({
				event_name: willSave ? "dish_saved" : "dish_unsaved",
				error_level: "log",
				payload: {
					dishMediaId,
				},
			});

			try {
				if (willSave) {
					await callBackend<DishMediaReactionBodyDto, void>(`v1/dish-media/${dishMediaId}/reaction`, {
						method: "POST",
						requestPayload: { action_type: "save" },
					});
				} else {
					await callBackend<DishMediaReactionBodyDto, void>(`v1/dish-media/${dishMediaId}/reaction`, {
						method: "DELETE",
						requestPayload: { action_type: "save" },
					});
				}
			} catch (error) {
				// #433 【設計】エラー時のロールバック：元の状態に戻す
				storeToggleSave(dishMediaId, currentSaveState);

				logFrontendEvent({
					event_name: "dish_save_reaction_failed",
					error_level: "error",
					payload: {
						error: error instanceof Error ? error.message : String(error),
						target_id: dishMediaId,
						action_type: "save",
						willReact: willSave,
					},
				});
			}
		},
		[callBackend, logFrontendEvent, lightImpact, storeToggleSave, dishEntriesById],
	);

	return { toggleSave };
}
