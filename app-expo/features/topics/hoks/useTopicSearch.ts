import { useState, useCallback } from "react";
import { Topic, SearchParams } from "@/types/search";
// import { mockTopicCards } from "@/data/searchMockData";
import { useAPICall } from "@/hooks/useAPICall";
import type { BulkImportDishesDto, QueryDishCategoryRecommendationsDto } from "@shared/dist/api/v1/dto";
import type { BulkImportDishesResponse, QueryDishCategoryRecommendationsResponse } from "@shared/api/v1/res";
import { useLocale } from "@/hooks/useLocale";

export const useTopicSearch = () => {
	const [topics, setTopics] = useState<Topic[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { callBackend } = useAPICall();
	const locale = useLocale();

	const searchTopics = useCallback(async (params: SearchParams): Promise<Topic[]> => {
		setIsLoading(true);
		setError(null);

		try {
			const topicsResponse = await callBackend<
				QueryDishCategoryRecommendationsDto,
				QueryDishCategoryRecommendationsResponse
			>("/v1/dish-categories/recommendations", {
				method: "GET",
				requestPayload: { ...params, languageTag: locale },
			});
			const toplics = topicsResponse.map((topic) => ({
				...topic,
				isHidden: false,
				dishItemsPromise: callBackend<BulkImportDishesDto, BulkImportDishesResponse>(`/v1/dishes/bulk-import`, {
					method: "POST",
					requestPayload: {
						location: params.location,
						radius: params.distance,
						categoryId: topic.categoryId,
						categoryName: topic.category,
					},
				}),
			}));

			// Mock API response based on search parameters
			// const shuffledTopics = [...mockTopicCards]
			// 	.sort(() => Math.random() - 0.5)
			// 	.slice(0, 6)
			// 	.map((topic) => ({
			// 		...topic,
			// 		id: `${topic.id}_${Date.now()}_${Math.random()}`,
			// 		isHidden: false,
			// 	}));

			setTopics(toplics);
			return toplics;
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : "おすすめ検索に失敗しました";
			setError(errorMessage);
			throw new Error(errorMessage);
		} finally {
			setIsLoading(false);
		}
	}, []);

	const hideTopic = useCallback((topicId: string, reason: string) => {
		setTopics((prevTopics) =>
			prevTopics.map((topic) => (topic.categoryId === topicId ? { ...topic, isHidden: true } : topic)),
		);

		// Log hide reason for analytics
		const hideReason = {
			topicId,
			reason: reason.replace(/[^\w\s]/gi, "*"), // Simple PII masking
			timestamp: new Date().toISOString(),
		};

		console.log("Topic hidden:", hideReason);
	}, []);

	const resetTopics = useCallback(() => {
		setTopics([]);
		setError(null);
	}, []);

	return {
		topics,
		isLoading,
		error,
		searchTopics,
		hideTopic,
		resetTopics,
	};
};
