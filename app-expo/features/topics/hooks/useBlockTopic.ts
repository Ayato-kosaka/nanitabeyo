import { useState } from "react";
import { Topic } from "@/types/search";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { insertReaction } from "@/lib/reactions";
import i18n from "@/lib/i18n";

export const useBlockTopic = (
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

	const handleBlockCard = (cardId: string) => {
		setSelectedCardId(cardId);
		open();
	};

	const confirmBlockCard = async () => {
		const selectedTopic = topics.find((topic) => topic.categoryId === selectedCardId);
		if (!selectedCardId || !selectedTopic) return;

		try {
			await insertReaction({
				target_type: "dish_categories",
				target_id: selectedCardId,
				action_type: "block",
			});
		} catch (error) {
			console.error("Failed to insert block reaction:", error);
		}

		hideTopic(selectedCardId, "block");
		showSnackbar(i18n.t("Topics.blockedMessage", { title: selectedTopic.topicTitle }));
		close();
	};

	return {
		BlurModal,
		close,
		handleBlockCard,
		confirmBlockCard,
	};
};
