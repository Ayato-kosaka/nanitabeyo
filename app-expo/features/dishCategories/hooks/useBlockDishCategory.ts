import { useCallback } from "react";
import type { DishCategoryRecommendation } from "@/types/search";
import { useDialog } from "@/contexts/DialogProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useAPICall } from "@/hooks/useAPICall";
import { insertReaction } from "@/lib/reactions";
import i18n from "@/lib/i18n";
import type { ShowSnackbarOptions } from "@/contexts/SnackbarProvider";
import type { UnblockDishCategoryResponse } from "@shared/api/v1/res";
import { toErrorLogMessage } from "@/lib/errorMessage";

export const useBlockDishCategory = (
	hideDishCategory: (id: string, reason: string) => void,
	unhideDishCategory: (id: string) => void,
	showSnackbar: (message: string, options?: ShowSnackbarOptions) => void,
) => {
	const { showDialog } = useDialog();
	const { lightImpact, errorNotification } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();

	// #936 【仕様】ブロックを元に戻す。ブロック解除は既存の設定画面と同じ DELETE API を使い、
	// 成功したら初めてカードを isHidden=false に戻す(APIとUIの状態を必ず一致させる)。
	const handleUndoBlock = useCallback(
		async (dishCategory: DishCategoryRecommendation) => {
			try {
				await callBackend<Record<string, never>, UnblockDishCategoryResponse>(
					`/v1/users/me/blocked-dish-categories/${dishCategory.categoryId}`,
					{ method: "DELETE", requestPayload: {} },
				);
				unhideDishCategory(dishCategory.categoryId);
				logFrontendEvent({
					event_name: "topic_block_undo",
					error_level: "log",
					payload: { topic_id: dishCategory.categoryId },
				});
			} catch (error) {
				logFrontendEvent({
					event_name: "topic_block_undo_failed",
					error_level: "error",
					payload: {
						topic_id: dishCategory.categoryId,
						error: toErrorLogMessage(error),
					},
				});
				showSnackbar(i18n.t("Common.error"));
			}
		},
		[callBackend, unhideDishCategory, logFrontendEvent, showSnackbar],
	);

	/**
	 * ブロック対象を確認ダイアログのコールバックへ固定する。
	 * 副作用はリアクション保存・カード非表示・完了通知で、保存失敗時は例外を再送出してダイアログを維持する。
	 *
	 * @param dishCategory - ブロック確認を開始したdishCategory
	 * @returns 戻り値なし。ユーザーの確定後に非同期保存を開始する
	 */
	const handleBlockCard = useCallback(
		(dishCategory: DishCategoryRecommendation) => {
			errorNotification();
			// #907 【設計】対象を state で持たずクロージャへ固定し、前回モーダルの close と次回選択の競合を防ぐ。
			showDialog(`${i18n.t("DishCategories.BlockDishCategoryModal.description")}\n\n${i18n.t("DishCategories.BlockDishCategoryModal.note")}`, {
				title: i18n.t("DishCategories.BlockDishCategoryModal.title"),
				okLabel: i18n.t("DishCategories.BlockDishCategoryModal.confirm"),
				cancelLabel: i18n.t("Common.cancel"),
				errorMessage: i18n.t("Common.error"),
				debugId: "block-dishCategory",
				onCancel: lightImpact,
				onConfirm: async () => {
					errorNotification();
					logFrontendEvent({
						event_name: "topic_block_confirmed",
						error_level: "log",
						payload: { topic_id: dishCategory.categoryId },
					});

					try {
						// #907 【仕様】永続化成功をブロック成立条件とし、失敗したdishCategoryを画面だけから消さない。
						await insertReaction({
							target_type: "dish_categories",
							target_id: dishCategory.categoryId,
							action_type: "block",
						});

						hideDishCategory(dishCategory.categoryId, "block");
						// #936 【仕様】誤ブロックからの回復導線として、10秒間Undo可能なスナックバーを出す
						showSnackbar(i18n.t("DishCategories.blockedMessage", { title: dishCategory.title }), {
							action: {
								label: i18n.t("Common.undo"),
								onPress: () => handleUndoBlock(dishCategory),
							},
							duration: 10000,
						});
						logFrontendEvent({
							event_name: "topic_block_success",
							error_level: "log",
							payload: { topic_id: dishCategory.categoryId },
						});
					} catch (error) {
						logFrontendEvent({
							event_name: "topic_block_failed",
							error_level: "error",
							payload: {
								topic_id: dishCategory.categoryId,
								error: toErrorLogMessage(error),
							},
						});

						// #907 【設計】DialogProvider に失敗を伝え、再試行可能なままエラーを表示する。
						throw error;
					}
				},
			});
		},
		[errorNotification, handleUndoBlock, hideDishCategory, lightImpact, logFrontendEvent, showDialog, showSnackbar],
	);

	return {
		handleBlockCard,
	};
};
