import { useState, useCallback } from "react";
import { Topic, SearchParams } from "@/types/search";
// import { mockTopicCards } from "@/data/searchMockData";
import { useAPICall } from "@/hooks/useAPICall";
import type {
	BulkImportDishesDto,
	CreateDishCategoryVariantDto,
	QueryDishCategoryRecommendationsDto,
} from "@shared/api/v1/dto";
import type {
	BulkImportDishesResponse,
	DishMediaEntry,
	QueryDishCategoryRecommendationsResponse,
	CreateDishCategoryVariantResponse,
} from "@shared/api/v1/res";
import { useLocale } from "@/hooks/useLocale";
import { getRemoteConfig } from "@/lib/remoteConfig";

export const useTopicSearch = () => {
	const [topics, setTopics] = useState<Topic[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { callBackend } = useAPICall();
	const locale = useLocale();

	const searchTopics = useCallback(async (params: SearchParams): Promise<Topic[]> => {
		setIsLoading(true);
		setError(null);

		const remoteConfig = getRemoteConfig();
		const searchResultRestaurantsNumber = parseInt(remoteConfig?.v1_search_result_restaurants_number!, 10);
		const searchResultTopicsNumber = parseInt(remoteConfig?.v1_search_result_dish_categories_number!, 10);

		try {
			const topicsResponse = await callBackend<
				QueryDishCategoryRecommendationsDto,
				QueryDishCategoryRecommendationsResponse
			>("v1/dish-categories/recommendations", {
				method: "GET",
				requestPayload: {
					address: params.address,
					timeSlot: params.timeSlot,
					scene: params.scene,
					mood: params.mood,
					restrictions: params.restrictions,
					languageTag: locale,
				},
			});

			let topicsResponseWithCategoryIds: QueryDishCategoryRecommendationsResponse = topicsResponse
				.filter((topic) => topic.categoryId)
				.slice(0, searchResultTopicsNumber);

			if (topicsResponseWithCategoryIds.length < searchResultTopicsNumber) {
				const createDishCategoryVariantResponse = await Promise.all(
					topicsResponse.map(async (topic, index) => {
						if (!!topic.categoryId) return topic;
						try {
							const createDishCategoryVariantResponse = await callBackend<
								CreateDishCategoryVariantDto,
								CreateDishCategoryVariantResponse
							>("v1/dish-category-variants", {
								method: "POST",
								requestPayload: {
									name: topic.category,
								},
							});
							return {
								...topic,
								categoryId: createDishCategoryVariantResponse.id,
								imageUrl: createDishCategoryVariantResponse.image_url,
							};
						} catch (error) {
							console.error(`Error creating dish category variant for topic ${topic.category}:`, error);
							return topic;
						}
					}),
				);
				topicsResponseWithCategoryIds = createDishCategoryVariantResponse
					.filter((topic) => topic.categoryId)
					.slice(0, searchResultTopicsNumber);
			}

			const toplics = topicsResponseWithCategoryIds.map((topic) => ({
				...topic,
				isHidden: false,
				dishItemsPromise: (async (): Promise<DishMediaEntry[]> => {
					let dishItems: DishMediaEntry[] = [];

					// TODO: GET /v1/dish-media
					if (dishItems.length < searchResultRestaurantsNumber) {
						// if (false) {
						dishItems = await callBackend<BulkImportDishesDto, BulkImportDishesResponse>("v1/dishes/bulk-import", {
							method: "POST",
							requestPayload: {
								location: `${params.location.latitude},${params.location.longitude}`,
								radius: params.distance,
								categoryId: topic.categoryId,
								categoryName: topic.category,
								minRating: 3.0, // Fixed value as per requirement
								languageCode: params.localLanguageCode, // Use language resolved from location
								priceLevels: params.priceLevels,
							},
						});
					}
					dishItems.slice(0, searchResultRestaurantsNumber);
					return dishItems;
				})(),
			}));

			// // Mock API response based on search parameters
			// const toplics = [...mockTopicCards]
			// 	.sort(() => Math.random() - 0.5)
			// 	.slice(0, 6)
			// 	.map((topic) => ({
			// 		...topic,
			// 		id: `${topic.categoryId}_${Date.now()}_${Math.random()}`,
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
