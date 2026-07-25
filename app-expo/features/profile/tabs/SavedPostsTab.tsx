import React, { useCallback, useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
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
import { router } from "expo-router";
import type { QueryMeSavedDishMediaDto } from "@shared/api/v1/dto";
import type { QueryMeSavedDishMediaResponse } from "@shared/api/v1/res";
import { shallow } from "zustand/shallow";

interface SavedPostsTabProps {
	isOwnProfile: boolean;
}

export const profileSavedPostsEntriesKey = "profileSavedPosts";

export function SavedPostsTab({ isOwnProfile }: SavedPostsTabProps) {
	if (!isOwnProfile) {
		return (
			<View style={styles.privateContainer}>
				<View style={styles.privateCard}>
					<Text style={styles.privateText}>{i18n.t("Profile.privateContent")}</Text>
				</View>
			</View>
		);
	}

	const { callBackend } = useAPICall();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();

	// #454 【設計】画面用途キー "profileSavedPosts" でストアからデータ取得
	const fetchInitialByKey = useDishMediaEntriesStore((s) => s.fetchInitialByKey);
	const fetchMoreByKey = useDishMediaEntriesStore((s) => s.fetchMoreByKey);
	const { ids, isLoading, isLoadingMore, error, hasFetchedInitial } = useDishMediaEntriesStore(
		selectIdsByKey(profileSavedPostsEntriesKey, "dish_media"),
		shallow,
	);

	// #454 【設計】データ取得用の fetcher 関数
	const fetcher = useCallback(
		async ({ cursor }: { cursor?: string | null }) => {
			const response = await callBackend<QueryMeSavedDishMediaDto, QueryMeSavedDishMediaResponse>(
				"v1/users/me/saved-dish-media",
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
		fetchInitialByKey(profileSavedPostsEntriesKey, {}, fetcher);
	}, [profileSavedPostsEntriesKey, fetchInitialByKey, fetcher, hasFetchedInitial, isLoading]);

	const handleItemPress = useCallback(
		(dishMediaId: string, index: number) => {
			lightImpact();
			router.push({
				pathname: "/[locale]/(tabs)/profile/food",
				params: { locale, startIndex: index, tabName: profileSavedPostsEntriesKey },
			});
			logFrontendEvent({
				event_name: "dish_media_entry_selected",
				error_level: "log",
				payload: { dishMediaId, entriesKey: profileSavedPostsEntriesKey },
			});
		},
		[lightImpact, locale, logFrontendEvent],
	);

	const handleLoadMore = useCallback(() => {
		fetchMoreByKey(profileSavedPostsEntriesKey, {}, fetcher);
	}, [profileSavedPostsEntriesKey, fetchMoreByKey, fetcher]);

	const handleRefresh = useCallback(() => {
		fetchInitialByKey(profileSavedPostsEntriesKey, {}, fetcher);
	}, [profileSavedPostsEntriesKey, fetchInitialByKey, fetcher]);

	// #947 【仕様】空状態から検索画面へ1タップで戻れるCTA
	const handleSearchByMood = useCallback(() => {
		lightImpact();
		router.push({
			pathname: "/[locale]/(tabs)/search",
			params: { locale },
		});
		logFrontendEvent({
			event_name: "saved_posts_empty_cta_pressed",
			error_level: "log",
			payload: {},
		});
	}, [lightImpact, locale, logFrontendEvent]);

	const renderPostItem = useCallback(
		({ item, index }: { item: { id: string }; index: number }) => {
			const entry = selectEntryByMediaId(item.id)(useDishMediaEntriesStore.getState());
			if (!entry) return <View />; // エントリが存在しない場合は空ビューを返す

			const gridItem = {
				id: item.id,
				imageUrl: entry.dish_media.thumbnailImageUrl,
				title: entry.dish.name ?? undefined,
			};

			return (
				<ImageCard item={gridItem} onPress={() => handleItemPress(entry.dish_media.id, index)}>
					<View style={styles.postCardOverlay}>
						<View style={styles.postCardRating}>
							<Stars rating={entry.dish.averageRating} />
							<Text style={styles.postCardRatingText}>({entry.dish.reviewCount})</Text>
						</View>
					</View>
				</ImageCard>
			);
		},
		[handleItemPress],
	);

	const renderEmptyState = useCallback(
		() => (
			<EmptyState
				message={i18n.t("Profile.emptyState.noSavedPosts")}
				actionLabel={i18n.t("Profile.buttons.searchByMood")}
				onAction={handleSearchByMood}
				error={error}
				onRetry={handleRefresh}
				testID="saved-posts-tab-empty-state"
			/>
		),
		[error, handleRefresh, handleSearchByMood],
	);

	return (
		<GridList
			data={ids.map((id) => ({ id }))}
			renderItem={({ item, index }) => renderPostItem({ item, index })}
			numColumns={3}
			contentContainerStyle={styles.gridContent}
			columnWrapperStyle={styles.gridRow}
			isLoading={isLoading}
			isLoadingMore={isLoadingMore}
			refreshing={isLoading}
			onRefresh={handleRefresh}
			onEndReached={handleLoadMore}
			ListEmptyComponent={renderEmptyState}
			testID="save-post-tab-grid"
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
	gridContent: {
		paddingHorizontal: 16,
		paddingVertical: 8,
	},
	gridRow: {
		gap: 1,
	},
	postCardOverlay: {
		position: "absolute",
		bottom: 8,
		left: 8,
		right: 8,
	},
	postCardRating: {
		flexDirection: "row",
		alignItems: "center",
		gap: 4,
	},
	postCardRatingText: {
		fontSize: 12,
		color: "#FFFFFF",
		fontWeight: "500",
		textShadowColor: "rgba(0, 0, 0, 0.5)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 2,
	},
});
