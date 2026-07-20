import { useCallback } from "react";
import type { Topic } from "@/types/search";
import { useDialog } from "@/contexts/DialogProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { insertReaction } from "@/lib/reactions";
import i18n from "@/lib/i18n";

export const useBlockTopic = (
	hideTopic: (id: string, reason: string) => void,
	showSnackbar: (message: string) => void,
) => {
	const { showDialog } = useDialog();
	const { lightImpact, errorNotification } = useHaptics();
	const { logFrontendEvent } = useLogger();

	/**
	 * ブロック対象を確認ダイアログのコールバックへ固定する。
	 * 副作用はリアクション保存・カード非表示・完了通知で、保存失敗時は例外を再送出してダイアログを維持する。
	 *
	 * @param topic - ブロック確認を開始したtopic
	 * @returns 戻り値なし。ユーザーの確定後に非同期保存を開始する
	 */
	const handleBlockCard = useCallback(
		(topic: Topic) => {
			errorNotification();
			// #907 【設計】対象を state で持たずクロージャへ固定し、前回モーダルの close と次回選択の競合を防ぐ。
			showDialog(`${i18n.t("Topics.BlockTopicModal.description")}\n\n${i18n.t("Topics.BlockTopicModal.note")}`, {
				title: i18n.t("Topics.BlockTopicModal.title"),
				okLabel: i18n.t("Topics.BlockTopicModal.confirm"),
				cancelLabel: i18n.t("Common.cancel"),
				errorMessage: i18n.t("Common.error"),
				debugId: "block-topic",
				onCancel: lightImpact,
				onConfirm: async () => {
					errorNotification();
					logFrontendEvent({
						event_name: "topic_block_confirmed",
						error_level: "log",
						payload: { topic_id: topic.categoryId },
					});

					try {
						// #907 【仕様】永続化成功をブロック成立条件とし、失敗したtopicを画面だけから消さない。
						await insertReaction({
							target_type: "dish_categories",
							target_id: topic.categoryId,
							action_type: "block",
						});

						hideTopic(topic.categoryId, "block");
						showSnackbar(i18n.t("Topics.blockedMessage", { title: topic.topicTitle }));
						logFrontendEvent({
							event_name: "topic_block_success",
							error_level: "log",
							payload: { topic_id: topic.categoryId },
						});
					} catch (error) {
						logFrontendEvent({
							event_name: "topic_block_failed",
							error_level: "error",
							payload: {
								topic_id: topic.categoryId,
								error: error instanceof Error ? error.message : String(error),
							},
						});

						// #907 【設計】DialogProvider に失敗を伝え、再試行可能なままエラーを表示する。
						throw error;
					}
				},
			});
		},
		[errorNotification, hideTopic, lightImpact, logFrontendEvent, showDialog, showSnackbar],
	);

	return {
		handleBlockCard,
	};
};
