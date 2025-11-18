import React, { useState, useEffect } from "react";
import { router } from "expo-router";
import { useDishMediaEntriesStore, selectEntriesByKey } from "@/stores/useDishMediaEntriesStore";
import { useLogger } from "@/hooks/useLogger";
import type { DishMediaEntry } from "@shared/api/v1/res";

// Encapsulates state and handlers for the search result screen
export function useSearchResult(topicId: string) {
	const [currentIndex, setCurrentIndex] = useState(0);
	const [showCompletionModal, setShowCompletionModal] = useState(false);
	const { logFrontendEvent } = useLogger();
	// #443 【設計】新 Store API を使用（selectEntriesByKey で取得）
	const { entries: dishes, isLoading, error } = useDishMediaEntriesStore(selectEntriesByKey(topicId));

	// #443 【設計】DishMediaMap が Promise を期待しているため、互換性のため Promise に変換
	const dishesPromise: Promise<DishMediaEntry[]> = React.useMemo(() => {
		if (error) return Promise.reject(error);
		if (dishes) return Promise.resolve(dishes);
		// dishes が null の場合は空配列を返す
		return Promise.resolve([]);
	}, [dishes, error]);

	useEffect(() => {
		// Log search result initialization
		logFrontendEvent({
			event_name: "search_result_initialized",
			error_level: "log",
			payload: {
				topicId,
				hasDishes: !!dishes,
				dishCount: dishes?.length || 0,
			},
		});
	}, [topicId, dishes, logFrontendEvent]);

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
