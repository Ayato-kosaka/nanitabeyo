import React, { useCallback, useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SaveTopicTab } from "./save/SaveTopicTab";
import i18n from "@/lib/i18n";
import { useAPICall } from "@/hooks/useAPICall";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useLocale } from "@/hooks/useLocale";
import type { QueryMeSavedDishCategoriesDto } from "@shared/api/v1/dto";
import type { QueryMeSavedDishCategoriesResponse } from "@shared/api/v1/res";
import { useTopicsStore, selectTopicIdsByKey, DishCategory } from "@/stores/useTopicsStore";
import { shallow } from "zustand/shallow";

interface SavedTopicsTabProps {
	isOwnProfile: boolean;
}

export const profileSavedTopicsEntriesKey = "profileSavedTopics";

export function SavedTopicsTab({ isOwnProfile }: SavedTopicsTabProps) {
	const { userId } = useLocalSearchParams();
	const { locale } = useLocale();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();

	const {
		ids: topicIds,
		isLoading,
		error,
		hasNextPage,
		isLoadingMore,
	} = useTopicsStore(selectTopicIdsByKey(profileSavedTopicsEntriesKey), shallow);

	// #472 【設計】初回マウント時にストアから保存トピックを取得
	useEffect(() => {
		const { fetchInitialByKey, hasFetchedInitialByKey } = useTopicsStore.getState();

		// 既に取得済みの場合はスキップ
		if (hasFetchedInitialByKey[profileSavedTopicsEntriesKey]) {
			return;
		}

		fetchInitialByKey(profileSavedTopicsEntriesKey, {} as QueryMeSavedDishCategoriesDto, async ({ cursor }) => {
			const response = await callBackend<QueryMeSavedDishCategoriesDto, QueryMeSavedDishCategoriesResponse>(
				"v1/users/me/saved-dish-categories",
				{
					method: "GET",
					requestPayload: cursor ? { cursor } : {},
				},
			);
			return {
				data: response.data || [],
				nextCursor: response.nextCursor,
			};
		});
	}, [callBackend]);

	// #472 【設計】リフレッシュハンドラ（初期データを再取得）
	const handleRefresh = useCallback(async () => {
		const { fetchInitialByKey } = useTopicsStore.getState();
		await fetchInitialByKey(profileSavedTopicsEntriesKey, {} as QueryMeSavedDishCategoriesDto, async ({ cursor }) => {
			const response = await callBackend<QueryMeSavedDishCategoriesDto, QueryMeSavedDishCategoriesResponse>(
				"v1/users/me/saved-dish-categories",
				{
					method: "GET",
					requestPayload: cursor ? { cursor } : {},
				},
			);
			return {
				data: response.data || [],
				nextCursor: response.nextCursor,
			};
		});
	}, [callBackend]);

	// #472 【設計】追加ページ取得ハンドラ
	const handleLoadMore = useCallback(async () => {
		if (!hasNextPage || isLoadingMore) return;

		const { fetchMoreByKey } = useTopicsStore.getState();
		await fetchMoreByKey(profileSavedTopicsEntriesKey, {} as QueryMeSavedDishCategoriesDto, async ({ cursor }) => {
			const response = await callBackend<QueryMeSavedDishCategoriesDto, QueryMeSavedDishCategoriesResponse>(
				"v1/users/me/saved-dish-categories",
				{
					method: "GET",
					requestPayload: cursor ? { cursor } : {},
				},
			);
			return {
				data: response.data || [],
				nextCursor: response.nextCursor,
			};
		});
	}, [callBackend, hasNextPage, isLoadingMore]);

	// #1369 【設計】カードを押したら «地点検索の画面» へ push する（旧: 同画面内の BlurModal を open）。
	// 検索対象は URL パラメータで運ぶ。ストアから引き直さないのは、遷移先が URL 直リンク・
	// web のリロードでも単独で成立するようにするため（search-results が entriesKey だけで
	// 成立するのと同じ形）。地点が確定したあとの検索・遷移は遷移先の
	// features/profile/containers/SavedTopicLocationSearch.tsx が担う。
	//
	// ⚠️ push の時点でこのタブに開いている BlurModal は無い（#1369 で最後の 1 つを畳んだ）。
	// Portal.Host が <Stack> を包む（app/[locale]/_layout.tsx）ため、開いた BlurModal が
	// あるまま push すると遷移先が portal の下に潜る（#1359 で地図が踏んだ）。
	const handleTopicPress = useCallback(
		(item: DishCategory, index: number) => {
			lightImpact();
			logFrontendEvent({
				event_name: "saved_topic_selected",
				error_level: "log",
				payload: { topicId: item.id, index },
			});

			router.push({
				pathname: "/[locale]/(tabs)/profile/saved-topic-location",
				params: { locale, topicId: item.id, topicLabelEn: item.label_en },
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

	if (!isOwnProfile) {
		return (
			<View style={styles.privateContainer}>
				<View style={styles.privateCard}>
					<Text style={styles.privateText}>{i18n.t("Profile.privateContent")}</Text>
				</View>
			</View>
		);
	}

	return (
		<SaveTopicTab
			topicIds={topicIds}
			isLoading={isLoading}
			isLoadingMore={isLoadingMore}
			refreshing={isLoading}
			onRefresh={handleRefresh}
			onEndReached={handleLoadMore}
			onItemPress={handleTopicPress}
			error={error}
			onRetry={handleRefresh}
			emptyActionLabel={i18n.t("Profile.buttons.searchByMood")}
			onEmptyAction={handleSearchByMood}
		/>
	);
}

const styles = StyleSheet.create({
	privateContainer: {
		flex: 1,
		paddingHorizontal: 16,
	},
	privateCard: {
		backgroundColor: "#FFFFFF",
		borderRadius: 20,
		padding: 32,
		alignItems: "center",
		justifyContent: "center",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.08,
		shadowRadius: 16,
		elevation: 4,
	},
	privateText: {
		fontSize: 17,
		color: "#6B7280",
		marginTop: 16,
		fontWeight: "500",
		textAlign: "center",
	},
});
