import { useState, useCallback } from "react";
import { Topic, SearchParams } from "@/types/search";
// import { mockTopicCards } from "@/data/searchMockData";
import { useAPICall } from "@/hooks/useAPICall";
import { wikimediaThumbFromOriginal } from "@/lib/wikimedia";
import type {
	BulkImportDishesDto,
	CreateDishCategoryVariantDto,
	QueryDishCategoryRecommendationsDto,
	SearchDishMediaDto,
} from "@shared/api/v1/dto";
import type {
	BulkImportDishesResponse,
	DishMediaEntry,
	QueryDishCategoryRecommendationsResponse,
	CreateDishCategoryVariantResponse,
	SearchDishMediaResponse,
} from "@shared/api/v1/res";
import { useLocale } from "@/hooks/useLocale";
import { getRemoteConfig } from "@/lib/remoteConfig";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import { CARD_WIDTH, DEFAULT_SEARCH_RADIUS, DEFAULT_PRICE_LEVELS } from "../constants";

export const useTopicSearch = () => {
	const [topics, setTopics] = useState<Topic[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { callBackend } = useAPICall();
	const locale = useLocale();
	const { logFrontendEvent } = useLogger();

	// #633 【設計】料理メディアの取得処理（オンデマンド実行用に export）
	const createDishItemsPromise = useCallback(
		(
			categoryId: Topic["categoryId"],
			category: Topic["category"],
			latitude: number,
			longitude: number,
			searchLocationLanguageCode: string,
			radius: number = DEFAULT_SEARCH_RADIUS,
			priceLevels: string[] = [...DEFAULT_PRICE_LEVELS],
		): Promise<DishMediaEntry[]> => {
			return (async (): Promise<DishMediaEntry[]> => {
				// Get restaurant number from remote config
				const remoteConfig = getRemoteConfig();
				const searchResultRestaurantsNumber = parseInt(remoteConfig?.v1_search_result_restaurants_number!, 10);

				let dishItems: DishMediaEntry[] = [];

				// まずは、GET /v1/dish-media で既存の料理メディアを検索
				dishItems = await callBackend<SearchDishMediaDto, SearchDishMediaResponse>("v1/dish-media/search", {
					method: "GET",
					requestPayload: {
						location: `${latitude},${longitude}`,
						radius: radius,
						categoryId: categoryId,
						limit: searchResultRestaurantsNumber,
					},
				});

				if (dishItems.length < searchResultRestaurantsNumber) {
					// 足りない分は、POST /v1/dishes/bulk-import で新規インポート

					// Check if all price levels are selected - if so, don't send priceLevels parameter
					const allPriceLevels = [
						"PRICE_LEVEL_INEXPENSIVE",
						"PRICE_LEVEL_MODERATE",
						"PRICE_LEVEL_EXPENSIVE",
						"PRICE_LEVEL_VERY_EXPENSIVE",
					];
					const isAllPriceLevelsSelected =
						priceLevels.length === allPriceLevels.length &&
						allPriceLevels.every((level) => priceLevels.includes(level));

					const requestPayload: BulkImportDishesDto = {
						location: `${latitude},${longitude}`,
						radius: radius,
						categoryId: categoryId,
						categoryName: category,
						minRating: 3.0, // Fixed value as per requirement
						languageCode: searchLocationLanguageCode, // First part of locale (e.g., "ja" from "ja-JP")
						// Only include priceLevels if not all are selected
						...(isAllPriceLevelsSelected ? {} : { priceLevels: priceLevels }),
					};

					const importResponse = await callBackend<BulkImportDishesDto, BulkImportDishesResponse>(
						"v1/dishes/bulk-import",
						{
							method: "POST",
							requestPayload,
						},
					);
					dishItems = dishItems.concat(
						importResponse.filter(
							(imported) =>
								!dishItems.find(
									(existing) => existing.restaurant.google_place_id === imported.restaurant.google_place_id,
								),
						),
					);
				}

				// #630 【設計】先読み削除（ロード中 skeleton を見せる方針に統一）
				return dishItems.slice(0, searchResultRestaurantsNumber);
			})();
		},
		[callBackend, locale],
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
						taste: params.taste,
						languageTag: locale,
						localLanguageCode: params.localLanguageCode,
					},
				});

				let topicsResponseWithCategoryIds: QueryDishCategoryRecommendationsResponse = topicsResponse
					.filter((topic) => topic.categoryId && topic.imageUrl)
					.slice(0, searchResultTopicsNumber)
					.map((topic) => ({
						...topic,
						imageUrl: wikimediaThumbFromOriginal(topic.imageUrl, CARD_WIDTH),
					}));

				const createTopic = (topic: QueryDishCategoryRecommendationsResponse[number]): Topic => {
					// #633 【設計】Topic 生成時に dishItemsPromise を発火しない（ユーザー操作後に限定）
					return {
						...topic,
						isHidden: false,
					};
				};

				// Early display: Set topics from initial response with category IDs
				if (topicsResponseWithCategoryIds.length > 0) {
					const initialTopics = topicsResponseWithCategoryIds.map((topic) => createTopic(topic));
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
										category:
											createDishCategoryVariantResponse.labels &&
											typeof createDishCategoryVariantResponse.labels === "object" &&
											params.localLanguageCode in createDishCategoryVariantResponse.labels
												? (createDishCategoryVariantResponse.labels as Record<string, string>)[params.localLanguageCode]
												: topic.category,
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
						.slice(0, searchResultTopicsNumber - topicsResponseWithCategoryIds.length)
						.map((topic) => ({
							...topic,
							imageUrl: wikimediaThumbFromOriginal(topic.imageUrl, CARD_WIDTH),
						}));

					// Add additional topics to the array (append to the end)
					if (additionalTopicsWithCategoryIds.length > 0) {
						const additionalTopics = additionalTopicsWithCategoryIds.map((topic) => createTopic(topic));
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
				const errorMessage = err instanceof Error ? err.message : i18n.t("Topics.errors.fetchFailed");
				setError(errorMessage);
				throw new Error(errorMessage);
			} finally {
				setIsLoading(false);
			}
		},
		[callBackend, locale, createDishItemsPromise],
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
