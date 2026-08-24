import React, { useCallback, useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { router } from "expo-router";
import { GridList } from "@/components/collapsible-tabs/GridList";
import { ImageCard } from "@/components/ImageCardGrid";
import { EmptyState } from "@/components/EmptyState";
import Stars from "@/components/Stars";
import i18n from "@/lib/i18n";
import { useAPICall } from "@/hooks/useAPICall";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useDishMediaEntriesStore, selectIdsByKey, selectEntryByMediaId } from "@/stores/useDishMediaEntriesStore";
import { useLocale } from "@/hooks/useLocale";
import type { QueryMeLikedDishMediaResponse } from "@shared/api/v1/res";
import type { QueryMeLikedDishMediaDto } from "@shared/api/v1/dto";
import { shallow } from "zustand/shallow";
import { FixedColors } from "@/constants/Palette";

export const profileLikesEntriesKey = "profileLikes" as const;

export function LikeTab() {
	const { callBackend } = useAPICall();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();

	// #454 【設計】画面用途キー "profileLikes" でストアからデータ取得
	const fetchInitialByKey = useDishMediaEntriesStore((s) => s.fetchInitialByKey);
	const fetchMoreByKey = useDishMediaEntriesStore((s) => s.fetchMoreByKey);
	const { ids, isLoading, isLoadingMore, error, hasFetchedInitial } = useDishMediaEntriesStore(
		selectIdsByKey(profileLikesEntriesKey, "dish_media"),
		shallow,
	);

	// #454 【設計】データ取得用の fetcher 関数
	const fetcher = useCallback(
		async ({ cursor }: { cursor?: string | null }) => {
			const response = await callBackend<QueryMeLikedDishMediaDto, QueryMeLikedDishMediaResponse>(
				"v1/users/me/liked-dish-media",
				{
					method: "GET",
					requestPayload: cursor ? { cursor } : {},
				},
			);
			return {
				data: response.data || [],
				nextCursor: response.nextCursor,
			};
		},
		[callBackend],
	);

	useEffect(() => {
		if (hasFetchedInitial || isLoading) return;
		fetchInitialByKey(profileLikesEntriesKey, {}, fetcher);
	}, [profileLikesEntriesKey, fetchInitialByKey, fetcher, hasFetchedInitial, isLoading]);

	const handleItemPress = useCallback(
		(dishMediaId: string, index: number) => {
			lightImpact();
			router.push({
				pathname: "/[locale]/(tabs)/profile/food",
				params: { locale, startIndex: index, tabName: profileLikesEntriesKey },
			});
			logFrontendEvent({
				event_name: "dish_media_entry_selected",
				error_level: "log",
				payload: { dishMediaId, entriesKey: profileLikesEntriesKey },
			});
		},
		[lightImpact, locale, logFrontendEvent],
	);

	const handleSearchByMood = useCallback(() => {
		lightImpact();
		router.push({
			pathname: "/[locale]/(tabs)/search",
			params: { locale },
		});
		logFrontendEvent({
			event_name: "likes_empty_search_navigation",
			error_level: "log",
			payload: { source: "likes_empty_state" },
		});
	}, [lightImpact, locale, logFrontendEvent]);

	const renderLikeItem = useCallback(
		({ item, index }: { item: { id: string }; index: number }) => {
			const entry = selectEntryByMediaId(item.id)(useDishMediaEntriesStore.getState());
			if (!entry) return <View />; // エントリが存在しない場合は空ビューを返す

			const gridItem = {
				id: item.id,
				imageUrl: entry.dish_media.thumbnailImageUrl ?? "",
				title: entry.dish.name ?? undefined,
			};

			return (
				<ImageCard item={gridItem} onPress={() => handleItemPress(entry.dish_media.id, index)}>
					<View style={styles.likeCardOverlay}>
						<View style={styles.likeCardRating}>
							<Stars rating={entry.dish.averageRating} />
							<Text style={styles.likeCardRatingText}>({entry.dish.reviewCount})</Text>
						</View>
					</View>
				</ImageCard>
			);
		},
		[handleItemPress],
	);

	const handleLoadMore = useCallback(() => {
		fetchMoreByKey(profileLikesEntriesKey, {}, fetcher);
	}, [profileLikesEntriesKey, fetchMoreByKey, fetcher]);

	const handleRefresh = useCallback(() => {
		fetchInitialByKey(profileLikesEntriesKey, {}, fetcher);
	}, [profileLikesEntriesKey, fetchInitialByKey, fetcher]);

	const renderEmptyState = useCallback(
		() => (
			<EmptyState
				message={i18n.t("Profile.emptyState.noLikedDishMediaEntries")}
				actionLabel={i18n.t("Profile.buttons.searchByMood")}
				onAction={handleSearchByMood}
				error={error}
				onRetry={handleRefresh}
				testID="like-tab-empty-state"
			/>
		),
		[error, handleRefresh, handleSearchByMood],
	);

	return (
		<GridList
			data={ids.map((id) => ({ id }))}
			renderItem={({ item, index }) => renderLikeItem({ item, index })}
			numColumns={3}
			contentContainerStyle={styles.gridContent}
			columnWrapperStyle={styles.gridRow}
			isLoading={isLoading}
			isLoadingMore={isLoadingMore}
			refreshing={isLoading}
			onRefresh={handleRefresh}
			onEndReached={handleLoadMore}
			ListEmptyComponent={renderEmptyState}
			testID="like-tab-grid"
			// #1402 このグリッドはもう «マイページのタブのペイン» ではなく
			// «独立したルート（/[locale]/profile/liked）の中身» なので、collapsible-tabs の
			// コンテキストが無い。Tabs.FlatList のままだと実行時に落ちる
			standalone
		/>
	);
}

const styles = StyleSheet.create({
	gridContent: {
		paddingHorizontal: 16,
		paddingVertical: 8,
	},
	gridRow: {
		gap: 1,
	},
	likeCardOverlay: {
		position: "absolute",
		bottom: 8,
		left: 8,
		right: 8,
	},
	likeCardRating: {
		flexDirection: "row",
		alignItems: "center",
		gap: 4,
	},
	likeCardRatingText: {
		fontSize: 12,
		// 料理写真のサムネイルの上に載る文字なのでテーマで振らない
		color: FixedColors.onMedia,
		fontWeight: "500",
		textShadowColor: "rgba(0, 0, 0, 0.5)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 2,
	},
});
