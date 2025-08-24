import { useState, useCallback } from "react";
import { Image } from "react-native";
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
import { useLogger } from "@/hooks/useLogger";

export const useTopicSearch = () => {
	const [topics, setTopics] = useState<Topic[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { callBackend } = useAPICall();
	const locale = useLocale();
	const { logFrontendEvent } = useLogger();

	// Helper function to create dishItemsPromise with image preloading (DRY principle)
	const createDishItemsPromise = useCallback(
		(
			categoryId: Topic["categoryId"],
			category: Topic["category"],
			latitude: number,
			longitude: number,
			languageCode: string,
			radius: number = 500, // Default 500m
			priceLevels: string[] = [
				"PRICE_LEVEL_INEXPENSIVE",
				"PRICE_LEVEL_MODERATE",
				"PRICE_LEVEL_EXPENSIVE",
				"PRICE_LEVEL_VERY_EXPENSIVE",
			],
		): Promise<DishMediaEntry[]> => {
			return (async (): Promise<DishMediaEntry[]> => {
				// Get restaurant number from remote config
				const remoteConfig = getRemoteConfig();
				const searchResultRestaurantsNumber = parseInt(remoteConfig?.v1_search_result_restaurants_number!, 10);

				let dishItems: DishMediaEntry[] = [];

				// TODO: GET /v1/dish-media
				if (dishItems.length < searchResultRestaurantsNumber) {
					// if (false) {
					dishItems = await callBackend<BulkImportDishesDto, BulkImportDishesResponse>("v1/dishes/bulk-import", {
						method: "POST",
						requestPayload: {
							location: `${latitude},${longitude}`,
							radius: radius,
							categoryId: categoryId,
							categoryName: category,
							minRating: 3.0, // Fixed value as per requirement
							languageCode: languageCode, // First part of locale (e.g., "ja" from "ja-JP")
							priceLevels: priceLevels,
						},
					});

					// Preload dish media images
					await Promise.allSettled(
						dishItems.map(async (dishItem) => {
							if (dishItem.dish_media.media_type === "image") {
								try {
									await Image.prefetch(dishItem.dish_media.mediaUrl);
								} catch (error) {
									logFrontendEvent({
										event_name: "image_preload_failed",
										error_level: "warn",
										payload: {
											imageType: "dish_media",
											imageUrl: dishItem.dish_media.mediaUrl,
											error: error instanceof Error ? error.message : String(error),
										},
									});
								}
							}
						}),
					);
				}
				return dishItems.slice(0, searchResultRestaurantsNumber);
			})();
		},
		[callBackend, locale, logFrontendEvent],
	);

	const searchTopics = useCallback(
		async (params: SearchParams) => {
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
					.filter((topic) => topic.categoryId && topic.imageUrl)
					.slice(0, searchResultTopicsNumber);

				// Early display: Create topics from initial response and set them immediately
				const createTopicWithImagePreload = async (
					topic: QueryDishCategoryRecommendationsResponse[number],
				): Promise<Topic> => {
					// Preload topic image
					if (topic.imageUrl) {
						try {
							await Image.prefetch(topic.imageUrl);
						} catch (error) {
							logFrontendEvent({
								event_name: "image_preload_failed",
								error_level: "warn",
								payload: {
									imageType: "topic",
									imageUrl: topic.imageUrl,
									error: error instanceof Error ? error.message : String(error),
								},
							});
						}
					}

					return {
						...topic,
						isHidden: false,
						dishItemsPromise: createDishItemsPromise(
							topic.categoryId,
							topic.category,
							params.location.latitude,
							params.location.longitude,
							params.localLanguageCode,
						),
					};
				};

				// Early display: Set topics from initial response with category IDs
				if (topicsResponseWithCategoryIds.length > 0) {
					const initialTopics = await Promise.all(
						topicsResponseWithCategoryIds.map((topic) => createTopicWithImagePreload(topic)),
					);
					setTopics(initialTopics);
					// Set loading to false after early display
					setIsLoading(false);
				}

				// Delayed addition: If we need more topics, create dish category variants and append them
				if (topicsResponseWithCategoryIds.length < searchResultTopicsNumber) {
					const createDishCategoryVariantResponse = await Promise.all(
						topicsResponse
							.filter(
								(topic) => !topicsResponseWithCategoryIds.find((existing) => existing.categoryId === topic.categoryId),
							)
							.map(async (topic, index) => {
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

					const additionalTopicsWithCategoryIds = createDishCategoryVariantResponse
						.filter((topic) => topic.categoryId && topic.imageUrl)
						.slice(0, searchResultTopicsNumber - topicsResponseWithCategoryIds.length);

					// Add additional topics to the array (append to the end)
					if (additionalTopicsWithCategoryIds.length > 0) {
						const additionalTopics = await Promise.all(
							additionalTopicsWithCategoryIds.map((topic) => createTopicWithImagePreload(topic)),
						);
						setTopics((prevTopics) => [...prevTopics, ...additionalTopics]);
					}

					// Update the final list for return value
					topicsResponseWithCategoryIds = [...topicsResponseWithCategoryIds, ...additionalTopicsWithCategoryIds];
				}

				// // Mock API response based on search parameters
				// const toplics = [...mockTopicCards]
				// 	.sort(() => Math.random() - 0.5)
				// 	.slice(0, 6)
				// 	.map((topic) => ({
				// 		...topic,
				// 		id: `${topic.categoryId}_${Date.now()}_${Math.random()}`,
				// 		isHidden: false,
				// 	}));
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : "おすすめ検索に失敗しました";
				setError(errorMessage);
				throw new Error(errorMessage);
			} finally {
				setIsLoading(false);
			}
		},
		[callBackend, locale, createDishItemsPromise, logFrontendEvent],
	);

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
		createDishItemsPromise, // Export the helper function for reuse
	};
};
