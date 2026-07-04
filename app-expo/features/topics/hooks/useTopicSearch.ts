import { useState, useCallback } from "react";
import { Topic, SearchParams } from "@/types/search";
// import { mockTopicCards } from "@/data/searchMockData";
import { useAPICall } from "@/hooks/useAPICall";
import { wikimediaThumbFromOriginal } from "@/lib/wikimedia";
import type {
	CreateDishCategoryVariantDto,
	QueryDishCategoryRecommendationsDto,
} from "@shared/api/v1/dto";
import type {
	QueryDishCategoryRecommendationsResponse,
	CreateDishCategoryVariantResponse,
} from "@shared/api/v1/res";
import { useLocale } from "@/hooks/useLocale";
import { getRemoteConfig } from "@/lib/remoteConfig";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import { CARD_WIDTH, DEFAULT_SEARCH_RADIUS, DEFAULT_PRICE_LEVELS } from "../constants";
import { createDishItemsForCategory } from "@/lib/dishMediaSearch";

export const useTopicSearch = () => {
	const [topics, setTopics] = useState<Topic[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { callBackend } = useAPICall();
	const { locale } = useLocale();
	const { logFrontendEvent } = useLogger();

	const createTopic = useCallback((topic: QueryDishCategoryRecommendationsResponse[number]): Topic => {
		// #633 【設計】Topic 生成時に dishItemsPromise を発火しない（ユーザー操作後に限定）
		return {
			...topic,
			isHidden: false,
		};
	}, []);

	const fetchTopicCandidates = useCallback(
		async (params: SearchParams): Promise<Topic[]> => {
			const remoteConfig = getRemoteConfig();
			const searchResultTopicsNumber = parseInt(remoteConfig?.v1_search_result_dish_categories_number!, 10);

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
				.slice(0, searchResultTopicsNumber)
				.map((topic) => ({
					...topic,
					imageUrl: wikimediaThumbFromOriginal(topic.imageUrl, CARD_WIDTH),
				}));

			if (topicsResponseWithCategoryIds.length < searchResultTopicsNumber) {
				const createDishCategoryVariantResponse = await Promise.all(
					topicsResponse
						.filter(
							(topic) => !topicsResponseWithCategoryIds.find((existing) => existing.categoryId === topic.categoryId),
						)
						.map(async (topic) => {
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

				topicsResponseWithCategoryIds = [...topicsResponseWithCategoryIds, ...additionalTopicsWithCategoryIds];
			}

			return topicsResponseWithCategoryIds.map((topic) => createTopic(topic));
		},
		[callBackend, createTopic, locale],
	);

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
		) => {
			const remoteConfig = getRemoteConfig();
			const searchResultRestaurantsNumber = parseInt(remoteConfig?.v1_search_result_restaurants_number!, 10);

			return createDishItemsForCategory({
				callBackend,
				categoryId,
				categoryName: category,
				latitude,
				longitude,
				searchLocationLanguageCode,
				radius,
				priceLevels,
				searchResultRestaurantsNumber,
			});
		},
		[callBackend],
	);

	const searchTopics = useCallback(
		async (params: SearchParams) => {
			setIsLoading(true);
			setError(null);

			try {
				const fetchedTopics = await fetchTopicCandidates(params);
				setTopics(fetchedTopics);

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
		[fetchTopicCandidates],
	);

	const refillTopics = useCallback(
		async (params: SearchParams) => {
			setIsLoading(true);
			setError(null);

			const remoteConfig = getRemoteConfig();
			const searchResultTopicsNumber = parseInt(remoteConfig?.v1_search_result_dish_categories_number!, 10);

			try {
				const fetchedTopics = await fetchTopicCandidates(params);

				setTopics((prevTopics) => {
					const visibleTopics = prevTopics.filter((topic) => !topic.isHidden);
					const hiddenTopics = prevTopics.filter((topic) => topic.isHidden);

					const existingCategoryIds = new Set(prevTopics.map((topic) => topic.categoryId));
					const additionalTopics = fetchedTopics.filter((topic) => !existingCategoryIds.has(topic.categoryId));

					const neededCount = Math.max(0, searchResultTopicsNumber - visibleTopics.length);
					const filledVisibleTopics = [...visibleTopics, ...additionalTopics.slice(0, neededCount)];

					const dedupedVisibleTopics = Array.from(
						new Map(filledVisibleTopics.map((topic) => [topic.categoryId, topic])).values(),
					).slice(0, searchResultTopicsNumber);

					return [...dedupedVisibleTopics, ...hiddenTopics];
				});
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : i18n.t("Topics.errors.fetchFailed");
				setError(errorMessage);
				throw new Error(errorMessage);
			} finally {
				setIsLoading(false);
			}
		},
		[fetchTopicCandidates],
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
		refillTopics,
		hideTopic,
		resetTopics,
		createDishItemsPromise, // Export the helper function for reuse
	};
};
