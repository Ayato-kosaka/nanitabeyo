import React, { useState, useEffect } from "react";
import { router } from "expo-router";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { useLogger } from "@/hooks/useLogger";

// Encapsulates state and handlers for the search result screen
export function useSearchResult(topicId: string) {
	const [currentIndex, setCurrentIndex] = useState(0);
	const [showCompletionModal, setShowCompletionModal] = useState(false);
	const { logFrontendEvent } = useLogger();
	const dishesPromise = useDishMediaEntriesStore((state) => state.dishPromisesMap[topicId] || []);

	useEffect(() => {
		// Log search result initialization
		logFrontendEvent({
			event_name: "search_result_initialized",
			error_level: "log",
			payload: {
				topicId,
				hasDishPromise: !!dishesPromise,
			},
		});
	}, [topicId, dishesPromise, logFrontendEvent]);

	const handleIndexChange = (index: number) => {
		const previousIndex = currentIndex;
		setCurrentIndex(index);

		// Log navigation within results
		logFrontendEvent({
			event_name: "search_result_navigation",
			error_level: "debug",
			payload: {
				topicId,
				fromIndex: previousIndex,
				toIndex: index,
				direction: index > previousIndex ? "next" : "previous",
			},
		});

		// Completion modal logic preserved from original component
	};

	const handleClose = () => {
		logFrontendEvent({
			event_name: "search_result_exit",
			error_level: "log",
			payload: { topicId, finalIndex: currentIndex },
		});
		router.back();
	};

	const handleReturnToCards = () => {
		setShowCompletionModal(false);
		logFrontendEvent({
			event_name: "search_result_return_to_cards",
			error_level: "log",
			payload: { topicId },
		});
		router.back();
	};

	return {
		currentIndex,
		showCompletionModal,
		dishesPromise,
		handleIndexChange,
		handleClose,
		handleReturnToCards,
	};
}
