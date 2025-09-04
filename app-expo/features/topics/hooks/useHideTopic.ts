import { useState } from "react";
import { Topic } from "@/types/search";
import { useBlurModal } from "@/hooks/useBlurModal";
import { insertReaction } from "@/lib/reactions";
import i18n from "@/lib/i18n";

// Manage hide topic modal state and actions
export const useHideTopic = (
	topics: Topic[],
	hideTopic: (id: string, reason: string) => void,
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
	const handleHideCard = (cardId: string) => {
		setSelectedCardId(cardId);
		open();
	};

	// Confirm hiding the selected card
	const confirmHideCard = async (hideReason: string) => {
		const selectedTopic = topics.find((topic) => topic.categoryId === selectedCardId);
		if (selectedCardId && selectedTopic) {
			try {
				// Insert reaction with hideReason in meta
				await insertReaction({
					target_type: "dish_categories",
					target_id: selectedCardId,
					action_type: "hide",
					meta: { hideReason },
				});

				hideTopic(selectedCardId, hideReason);
				showSnackbar(i18n.t("Topics.hiddenMessage", { title: selectedTopic?.topicTitle }));
				close();
			} catch (error) {
				// If reaction insertion fails, still proceed with hiding locally
				console.error("Failed to insert hide reaction:", error);
				hideTopic(selectedCardId, hideReason);
				showSnackbar(i18n.t("Topics.hiddenMessage", { title: selectedTopic?.topicTitle }));
				close();
			}
		}
	};

	return {
		BlurModal,
		close,
		handleHideCard,
		confirmHideCard,
	};
};
