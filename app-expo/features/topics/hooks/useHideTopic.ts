import { useState } from "react";
import { Topic } from "@/types/search";
import { useBlurModal } from "@/hooks/useBlurModal";
import { insertReaction } from "@/lib/reactions";

// Manage hide topic modal state and actions
export const useHideTopic = (
	topics: Topic[],
	hideTopic: (id: string, reason: string) => void,
	showSnackbar: (message: string) => void,
) => {
	const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
	const [hideReason, setHideReason] = useState("");
	const { BlurModal, open, close } = useBlurModal({
		intensity: 100,
		onClose: () => {
			setHideReason("");
			setSelectedCardId(null);
		},
	});

	// Open modal for a specific card
	const handleHideCard = (cardId: string) => {
		setSelectedCardId(cardId);
		open();
	};

	// Confirm hiding the selected card
	const confirmHideCard = async () => {
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
				showSnackbar(`${selectedTopic?.topicTitle}を非表示にしました`);
				close();
			} catch (error) {
				// If reaction insertion fails, still proceed with hiding locally
				console.error("Failed to insert hide reaction:", error);
				hideTopic(selectedCardId, hideReason);
				showSnackbar(`${selectedTopic?.topicTitle}を非表示にしました`);
				close();
			}
		}
	};

	return {
		BlurModal,
		close,
		hideReason,
		setHideReason,
		handleHideCard,
		confirmHideCard,
	};
};
