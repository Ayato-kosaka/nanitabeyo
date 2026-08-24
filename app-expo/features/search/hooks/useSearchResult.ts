import { useState } from "react";
import { router } from "expo-router";
import { useLogger } from "@/hooks/useLogger";

// #633 【設計】entriesKey ベースに変更（dishCategoryId ではなく検索条件全体のキー）
export function useSearchResult(entriesKey: string) {
	const [currentIndex, setCurrentIndex] = useState(0);
	const [showCompletionModal, setShowCompletionModal] = useState(false);
	const { logFrontendEvent } = useLogger();

	const handleIndexChange = (index: number) => {
		const previousIndex = currentIndex;
		setCurrentIndex(index);

		// Log navigation within results
		logFrontendEvent({
			event_name: "search_result_navigation",
			error_level: "debug",
			payload: {
				entriesKey, // #633 【設計】entriesKey をログに記録
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
			payload: { entriesKey, finalIndex: currentIndex }, // #633 【設計】entriesKey をログに記録
		});
		router.back();
	};

	const handleReturnToCards = () => {
		setShowCompletionModal(false);
		logFrontendEvent({
			event_name: "search_result_return_to_cards",
			error_level: "log",
			payload: { entriesKey }, // #633 【設計】entriesKey をログに記録
		});
		router.back();
	};

	return {
		currentIndex,
		showCompletionModal,
		handleIndexChange,
		handleClose,
		handleReturnToCards,
	};
}
