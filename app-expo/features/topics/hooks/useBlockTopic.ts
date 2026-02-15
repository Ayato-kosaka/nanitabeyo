import { useState } from "react";
import { Topic } from "@/types/search";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { insertReaction } from "@/lib/reactions";
import i18n from "@/lib/i18n";

// #[TICKET] 【設計】block 機能用フック（理由入力なし、確認ダイアログのみ）
export const useBlockTopic = (
	topics: Topic[],
	blockTopic: (id: string) => void,
	showSnackbar: (message: string) => void,
) => {
	const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
	const { BlurModal, open, close } = useBlurModal({
		intensity: 100,
		onClose: () => {
			setSelectedCardId(null);
		},
	});

	// Open modal for a specific card
	const handleBlockCard = (cardId: string) => {
		setSelectedCardId(cardId);
		open();
	};

	// Confirm blocking the selected card
	const confirmBlockCard = async () => {
		const selectedTopic = topics.find((topic) => topic.categoryId === selectedCardId);
		if (selectedCardId && selectedTopic) {
			try {
				// #[TICKET] 【設計】action_type: "block" で保存（meta なし）
				await insertReaction({
					target_type: "dish_categories",
					target_id: selectedCardId,
					action_type: "block",
				});

				blockTopic(selectedCardId);
				showSnackbar(i18n.t("Topics.blockedMessage", { title: selectedTopic?.topicTitle }));
				close();
			} catch (error) {
				// If reaction insertion fails, still proceed with blocking locally
				console.error("Failed to insert block reaction:", error);
				blockTopic(selectedCardId);
				showSnackbar(i18n.t("Topics.blockedMessage", { title: selectedTopic?.topicTitle }));
				close();
			}
		}
	};

	return {
		BlurModal,
		close,
		handleBlockCard,
		confirmBlockCard,
	};
};
