import { useState } from "react";
import { Topic } from "@/types/search";
import { useBlurModal } from "@/hooks/useBlurModal";

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
        const confirmHideCard = () => {
                const selectedTopic = topics.find((topic) => topic.id === selectedCardId);
                if (selectedCardId && selectedTopic) {
                        hideTopic(selectedCardId, hideReason);
                        showSnackbar(`${selectedTopic?.topicTitle}を非表示にしました`);
                        close();
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
