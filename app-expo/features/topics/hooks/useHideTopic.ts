import { useState } from "react";
import { Topic } from "@/types/search";

// Manage hide topic modal state and actions
export const useHideTopic = (
        topics: Topic[],
        hideTopic: (id: string, reason: string) => void,
        showSnackbar: (message: string) => void,
) => {
        const [showHideModal, setShowHideModal] = useState(false);
        const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
        const [hideReason, setHideReason] = useState("");

        // Open modal for a specific card
        const handleHideCard = (cardId: string) => {
                setSelectedCardId(cardId);
                setShowHideModal(true);
        };

        // Confirm hiding the selected card
        const confirmHideCard = () => {
                const selectedTopic = topics.find((topic) => topic.id === selectedCardId);
                if (selectedCardId && selectedTopic) {
                        hideTopic(selectedCardId, hideReason);
                        setShowHideModal(false);
                        setHideReason("");
                        setSelectedCardId(null);
                        showSnackbar(`${selectedTopic?.topicTitle}を非表示にしました`);
                }
        };

        return {
                showHideModal,
                setShowHideModal,
                hideReason,
                setHideReason,
                handleHideCard,
                confirmHideCard,
        };
};
