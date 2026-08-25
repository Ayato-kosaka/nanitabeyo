import { useState, useCallback } from "react";
import { DishCategoryRecommendation, SearchParams } from "@/types/search";
// import { mockDishCategoryCards } from "@/data/searchMockData";
import { useAPICall } from "@/hooks/useAPICall";
import { wikimediaThumbFromOriginal } from "@/lib/wikimedia";
import type { CreateDishCategoryVariantDto, QueryDishCategoryRecommendationsDto } from "@shared/api/v1/dto";
import type { QueryDishCategoryRecommendationsResponse, CreateDishCategoryVariantResponse } from "@shared/api/v1/res";
import { useLocale } from "@/hooks/useLocale";
import { getRemoteConfig } from "@/lib/remoteConfig";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import { DEFAULT_SEARCH_RADIUS, DEFAULT_PRICE_LEVELS } from "../constants";
import { useDishCategoryCardSize } from "./useDishCategoryCardSize";
import { createDishItemsForCategory } from "@/lib/dishMediaSearch";
import { deriveBudgetIntentFromPriceLevels } from "@/features/search/constants";

export const useDishCategorySearch = () => {
	const [dishCategories, setDishCategories] = useState<DishCategoryRecommendation[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { callBackend } = useAPICall();
	const { locale } = useLocale();
	const { logFrontendEvent } = useLogger();
	// #958 【修正】CARD_WIDTH(window幅固定、中央カラム幅と不一致)の代わりに
	// useContentWidth ベースの値でサムネイル取得サイズを決める
	const { cardWidth } = useDishCategoryCardSize();

	const createDishCategory = useCallback((dishCategory: QueryDishCategoryRecommendationsResponse[number]): DishCategoryRecommendation => {
		// #633 【設計】DishCategoryRecommendation 生成時に dishItemsPromise を発火しない（ユーザー操作後に限定）
		// #1553 【設計】API 契約のフィールド名は topicTitle のまま（DB 列 topic_title 由来。契約の変更は別課題）。
		// アプリ内の識別子からは topic を排除したので、この境界で title へ読み替える
		const { topicTitle, ...rest } = dishCategory;
		return {
			...rest,
			title: topicTitle,
			deepDiveFeatures: dishCategory.deepDiveFeatures ?? [],
			isHidden: false,
		};
	}, []);

	const fetchDishCategoryCandidates = useCallback(
		async (params: SearchParams): Promise<DishCategoryRecommendation[]> => {
			const remoteConfig = getRemoteConfig();
			const searchResultDishCategoriesNumber = parseInt(remoteConfig?.v1_search_result_dish_categories_number!, 10);

			const fetchRecommendations = () =>
				callBackend<QueryDishCategoryRecommendationsDto, QueryDishCategoryRecommendationsResponse>(
					"v1/dish-categories/recommendations",
					{
						method: "GET",
						requestPayload: {
							address: params.address,
							timeSlot: params.timeSlot,
							scene: params.scene,
							taste: params.taste,
							budgetIntent: deriveBudgetIntentFromPriceLevels(params.priceLevels),
							diningPace: params.diningPace,
							coreIngredient: params.coreIngredient,
							languageTag: locale,
							localLanguageCode: params.localLanguageCode,
						},
					},
				);

			let dishCategoriesResponse = await fetchRecommendations();
			// #897 バックエンドは外部推薦のフォールバックまで失敗した場合、成功応答の空配列を返す。
			// 空配列だけを一時失敗として扱い、別操作を要求せず500ms後に一度だけ再検索する。
			if (dishCategoriesResponse.length === 0) {
				logFrontendEvent({
					event_name: "dish_category_recommendations_empty_retry",
					error_level: "warn",
					payload: {},
				});
				await new Promise((resolve) => setTimeout(resolve, 500));
				dishCategoriesResponse = await fetchRecommendations();
			}

			if (dishCategoriesResponse.length === 0) {
				// hookは表示手段を持たない。呼び出し元へ伝播し、DishCategories画面のSnackbarで通知する。
				throw new Error(i18n.t("DishCategories.errors.fetchFailed"));
			}

			let dishCategoriesResponseWithCategoryIds: QueryDishCategoryRecommendationsResponse = dishCategoriesResponse
				.slice(0, searchResultDishCategoriesNumber)
				.map((dishCategory) => ({
					...dishCategory,
					imageUrl: wikimediaThumbFromOriginal(dishCategory.imageUrl, cardWidth),
				}));

			if (dishCategoriesResponseWithCategoryIds.length < searchResultDishCategoriesNumber) {
				const createDishCategoryVariantResponse = await Promise.all(
					dishCategoriesResponse
						.filter(
							(dishCategory) => !dishCategoriesResponseWithCategoryIds.find((existing) => existing.categoryId === dishCategory.categoryId),
						)
						.map(async (dishCategory) => {
							try {
								const createDishCategoryVariantResponse = await callBackend<
									CreateDishCategoryVariantDto,
									CreateDishCategoryVariantResponse
								>("v1/dish-category-variants", {
									method: "POST",
									requestPayload: {
										name: dishCategory.category,
									},
								});
								return {
									...dishCategory,
									category:
										createDishCategoryVariantResponse.labels &&
										typeof createDishCategoryVariantResponse.labels === "object" &&
										params.localLanguageCode in createDishCategoryVariantResponse.labels
											? (createDishCategoryVariantResponse.labels as Record<string, string>)[params.localLanguageCode]
											: dishCategory.category,
									categoryId: createDishCategoryVariantResponse.id,
									imageUrl: createDishCategoryVariantResponse.image_url,
								};
							} catch (error) {
								console.error(`Error creating dish category variant for dishCategory ${dishCategory.category}:`, error);
								return dishCategory;
							}
						}),
				);

				const additionalDishCategoriesWithCategoryIds = createDishCategoryVariantResponse
					.filter((dishCategory) => dishCategory.categoryId && dishCategory.imageUrl)
					.slice(0, searchResultDishCategoriesNumber - dishCategoriesResponseWithCategoryIds.length)
					.map((dishCategory) => ({
						...dishCategory,
						imageUrl: wikimediaThumbFromOriginal(dishCategory.imageUrl, cardWidth),
					}));

				dishCategoriesResponseWithCategoryIds = [...dishCategoriesResponseWithCategoryIds, ...additionalDishCategoriesWithCategoryIds];
			}

			return dishCategoriesResponseWithCategoryIds.map((dishCategory) => createDishCategory(dishCategory));
		},
		[callBackend, createDishCategory, locale, logFrontendEvent, cardWidth],
	);

	// #633 【設計】料理メディアの取得処理（オンデマンド実行用に export）
	const createDishItemsPromise = useCallback(
		(
			categoryId: DishCategoryRecommendation["categoryId"],
			category: DishCategoryRecommendation["category"],
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
				// #817 【設計】端末言語を第一優先にする
				viewerLanguageCode: locale,
				radius,
				priceLevels,
				searchResultRestaurantsNumber,
			});
		},
		[callBackend, locale],
	);

	const searchDishCategories = useCallback(
		async (params: SearchParams, options?: { pinnedDishCategory?: DishCategoryRecommendation | null }) => {
			setIsLoading(true);
			setError(null);

			try {
				const remoteConfig = getRemoteConfig();
				const searchResultDishCategoriesNumber = parseInt(remoteConfig?.v1_search_result_dish_categories_number!, 10);
				const fetchedDishCategories = await fetchDishCategoryCandidates(params);
				if (options?.pinnedDishCategory) {
					const pinnedDishCategory = { ...options.pinnedDishCategory, isHidden: false };
					const nextDishCategories = [
						pinnedDishCategory,
						...fetchedDishCategories
							.filter((dishCategory) => dishCategory.categoryId !== pinnedDishCategory.categoryId)
							.slice(0, Math.max(0, searchResultDishCategoriesNumber - 1)),
					];
					setDishCategories(nextDishCategories);
				} else {
					setDishCategories(fetchedDishCategories);
				}

				// // Mock API response based on search parameters
				// const toplics = [...mockDishCategoryCards]
				// 	.sort(() => Math.random() - 0.5)
				// 	.slice(0, 6)
				// 	.map((dishCategory) => ({
				// 		...dishCategory,
				// 		id: `${dishCategory.categoryId}_${Date.now()}_${Math.random()}`,
				// 		isHidden: false,
				// 	}));
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : i18n.t("DishCategories.errors.fetchFailed");
				setError(errorMessage);
				throw new Error(errorMessage);
			} finally {
				setIsLoading(false);
			}
		},
		[fetchDishCategoryCandidates],
	);

	const refillDishCategories = useCallback(
		async (params: SearchParams) => {
			setIsLoading(true);
			setError(null);

			const remoteConfig = getRemoteConfig();
			const searchResultDishCategoriesNumber = parseInt(remoteConfig?.v1_search_result_dish_categories_number!, 10);

			try {
				const fetchedDishCategories = await fetchDishCategoryCandidates(params);

				setDishCategories((prevDishCategories) => {
					const visibleDishCategories = prevDishCategories.filter((dishCategory) => !dishCategory.isHidden);
					const hiddenDishCategories = prevDishCategories.filter((dishCategory) => dishCategory.isHidden);

					const existingCategoryIds = new Set(prevDishCategories.map((dishCategory) => dishCategory.categoryId));
					const additionalDishCategories = fetchedDishCategories.filter((dishCategory) => !existingCategoryIds.has(dishCategory.categoryId));

					const neededCount = Math.max(0, searchResultDishCategoriesNumber - visibleDishCategories.length);
					const filledVisibleDishCategories = [...visibleDishCategories, ...additionalDishCategories.slice(0, neededCount)];

					const dedupedVisibleDishCategories = Array.from(
						new Map(filledVisibleDishCategories.map((dishCategory) => [dishCategory.categoryId, dishCategory])).values(),
					).slice(0, searchResultDishCategoriesNumber);

					return [...dedupedVisibleDishCategories, ...hiddenDishCategories];
				});
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : i18n.t("DishCategories.errors.fetchFailed");
				setError(errorMessage);
				throw new Error(errorMessage);
			} finally {
				setIsLoading(false);
			}
		},
		[fetchDishCategoryCandidates],
	);

	const hideDishCategory = useCallback((dishCategoryId: string, reason: string) => {
		setDishCategories((prevDishCategories) =>
			prevDishCategories.map((dishCategory) => (dishCategory.categoryId === dishCategoryId ? { ...dishCategory, isHidden: true } : dishCategory)),
		);

		// Log hide reason for analytics
		const hideReason = {
			dishCategoryId,
			reason: reason.replace(/[^\w\s]/gi, "*"), // Simple PII masking
			timestamp: new Date().toISOString(),
		};

		console.log("DishCategoryRecommendation hidden:", hideReason);
	}, []);

	// #936 【仕様】ブロックのUndo用。元の配列位置を保ったまま isHidden だけを戻す
	// (末尾に追加し直すと表示順が変わり、視聴済みカードの前後関係が崩れるため)。
	const unhideDishCategory = useCallback((dishCategoryId: string) => {
		setDishCategories((prevDishCategories) =>
			prevDishCategories.map((dishCategory) => (dishCategory.categoryId === dishCategoryId ? { ...dishCategory, isHidden: false } : dishCategory)),
		);
	}, []);

	const resetDishCategories = useCallback(() => {
		setDishCategories([]);
		setError(null);
	}, []);

	return {
		dishCategories,
		isLoading,
		error,
		searchDishCategories,
		refillDishCategories,
		hideDishCategory,
		unhideDishCategory,
		resetDishCategories,
		createDishItemsPromise, // Export the helper function for reuse
	};
};
