import React, { useCallback, useEffect } from "react";
import { asApiList } from "@/lib/apiList";
import { router } from "expo-router";
import { SaveDishCategoryTab } from "./save/SaveDishCategoryTab";
import i18n from "@/lib/i18n";
import { useAPICall } from "@/hooks/useAPICall";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useLocale } from "@/hooks/useLocale";
import type { QueryMeSavedDishCategoriesDto } from "@shared/api/v1/dto";
import type { QueryMeSavedDishCategoriesResponse } from "@shared/api/v1/res";
import { useDishCategoriesStore, selectDishCategoryIdsByKey, DishCategory } from "@/stores/useDishCategoriesStore";
import { shallow } from "zustand/shallow";

export const profileSavedDishCategoriesEntriesKey = "profileSavedDishCategories";

/**
 * 保存した料理カテゴリのグリッド。
 *
 * #1402 【設計】マイページの 4 グリッドタブを廃止し、このグリッドは
 * `/[locale]/profile/saved-dish-categories` という «単独のルート» の中身になった。
 * それに伴い `isOwnProfile` 分岐（他人のプロフィールでの非公開表示）を落としている。
 * このアプリには他ユーザーのプロフィールを開く導線が存在せず（#1402 で調査済み）、
 * 呼び出し側は常に自分のマイページだったため、常に false になり得ない分岐だった。
 */
export function SavedDishCategoriesTab() {
	const { locale } = useLocale();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();

	const {
		ids: dishCategoryIds,
		isLoading,
		error,
		hasNextPage,
		isLoadingMore,
	} = useDishCategoriesStore(selectDishCategoryIdsByKey(profileSavedDishCategoriesEntriesKey), shallow);

	// #472 【設計】初回マウント時にストアから保存トピックを取得
	useEffect(() => {
		const { fetchInitialByKey, hasFetchedInitialByKey } = useDishCategoriesStore.getState();

		// 既に取得済みの場合はスキップ
		if (hasFetchedInitialByKey[profileSavedDishCategoriesEntriesKey]) {
			return;
		}

		fetchInitialByKey(profileSavedDishCategoriesEntriesKey, {} as QueryMeSavedDishCategoriesDto, async ({ cursor }) => {
			const response = await callBackend<QueryMeSavedDishCategoriesDto, QueryMeSavedDishCategoriesResponse>(
				"v1/users/me/saved-dish-categories",
				{
					method: "GET",
					requestPayload: cursor ? { cursor } : {},
				},
			);
			return {
				data: asApiList(response.data),
				nextCursor: response.nextCursor,
			};
		});
	}, [callBackend]);

	// #472 【設計】リフレッシュハンドラ（初期データを再取得）
	const handleRefresh = useCallback(async () => {
		const { fetchInitialByKey } = useDishCategoriesStore.getState();
		await fetchInitialByKey(profileSavedDishCategoriesEntriesKey, {} as QueryMeSavedDishCategoriesDto, async ({ cursor }) => {
			const response = await callBackend<QueryMeSavedDishCategoriesDto, QueryMeSavedDishCategoriesResponse>(
				"v1/users/me/saved-dish-categories",
				{
					method: "GET",
					requestPayload: cursor ? { cursor } : {},
				},
			);
			return {
				data: asApiList(response.data),
				nextCursor: response.nextCursor,
			};
		});
	}, [callBackend]);

	// #472 【設計】追加ページ取得ハンドラ
	const handleLoadMore = useCallback(async () => {
		if (!hasNextPage || isLoadingMore) return;

		const { fetchMoreByKey } = useDishCategoriesStore.getState();
		await fetchMoreByKey(profileSavedDishCategoriesEntriesKey, {} as QueryMeSavedDishCategoriesDto, async ({ cursor }) => {
			const response = await callBackend<QueryMeSavedDishCategoriesDto, QueryMeSavedDishCategoriesResponse>(
				"v1/users/me/saved-dish-categories",
				{
					method: "GET",
					requestPayload: cursor ? { cursor } : {},
				},
			);
			return {
				data: asApiList(response.data),
				nextCursor: response.nextCursor,
			};
		});
	}, [callBackend, hasNextPage, isLoadingMore]);

	// #1369 【設計】カードを押したら «地点検索の画面» へ push する（旧: 同画面内の BlurModal を open）。
	// 検索対象は URL パラメータで運ぶ。ストアから引き直さないのは、遷移先が URL 直リンク・
	// web のリロードでも単独で成立するようにするため（search-results が entriesKey だけで
	// 成立するのと同じ形）。地点が確定したあとの検索・遷移は遷移先の
	// features/profile/containers/SavedDishCategoryLocationSearch.tsx が担う。
	//
	// ⚠️ push の時点でこのタブに開いている BlurModal は無い（#1369 で最後の 1 つを畳んだ）。
	// Portal.Host が <Stack> を包む（app/[locale]/_layout.tsx）ため、開いた BlurModal が
	// あるまま push すると遷移先が portal の下に潜る（#1359 で地図が踏んだ）。
	const handleDishCategoryPress = useCallback(
		(item: DishCategory, index: number) => {
			lightImpact();
			logFrontendEvent({
				event_name: "saved_topic_selected",
				error_level: "log",
				payload: { dishCategoryId: item.id, index },
			});

			router.push({
				pathname: "/[locale]/(tabs)/profile/saved-dish-category-location",
				params: { locale, dishCategoryId: item.id, dishCategoryLabelEn: item.label_en },
			});
		},
		[lightImpact, locale, logFrontendEvent],
	);

	// #947 【仕様】空状態から検索画面へ1タップで戻れるCTA
	const handleSearchByMood = useCallback(() => {
		lightImpact();
		router.push({
			pathname: "/[locale]/(tabs)/search",
			params: { locale },
		});
		logFrontendEvent({
			event_name: "saved_topics_empty_cta_pressed",
			error_level: "log",
			payload: {},
		});
	}, [lightImpact, locale, logFrontendEvent]);

	return (
		<SaveDishCategoryTab
			dishCategoryIds={dishCategoryIds}
			isLoading={isLoading}
			isLoadingMore={isLoadingMore}
			refreshing={isLoading}
			onRefresh={handleRefresh}
			onEndReached={handleLoadMore}
			onItemPress={handleDishCategoryPress}
			error={error}
			onRetry={handleRefresh}
			emptyActionLabel={i18n.t("Profile.buttons.searchByMood")}
			onEmptyAction={handleSearchByMood}
			// #1402 タブのペインではなく単独ルートの中身になったため collapsible-tabs の外で描画される
			standalone
		/>
	);
}
