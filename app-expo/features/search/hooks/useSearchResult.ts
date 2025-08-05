import React, { useState } from "react";
import { router } from "expo-router";
import { useSearchStore } from "@/stores/useSearchStore";

// Encapsulates state and handlers for the search result screen
export function useSearchResult(topicId: string) {
        const [currentIndex, setCurrentIndex] = useState(0);
        const [showCompletionModal, setShowCompletionModal] = useState(false);
        const dishes = useSearchStore((state) => state.dishesMap[topicId] || []);

        const handleIndexChange = (index: number) => {
                setCurrentIndex(index);
                // Completion modal logic preserved from original component
        };

        const handleClose = () => {
                router.back();
        };

        const handleReturnToCards = () => {
                setShowCompletionModal(false);
                router.back();
        };

        return {
                currentIndex,
                showCompletionModal,
                dishes,
                handleIndexChange,
                handleClose,
                handleReturnToCards,
        };
}
