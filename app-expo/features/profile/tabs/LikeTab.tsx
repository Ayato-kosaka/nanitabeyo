import React, { useCallback, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { GridList } from "@/components/collapsible-tabs/GridList";
import { ImageCard } from "@/components/ImageCardGrid";
import Stars from "@/components/Stars";
import i18n from "@/lib/i18n";
import { useAPICall } from "@/hooks/useAPICall";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useDishMediaEntriesStore, selectIdsByKey, selectEntryById } from "@/stores/useDishMediaEntriesStore";
import { useLocale } from "@/hooks/useLocale";
import type { QueryMeLikedDishMediaResponse } from "@shared/api/v1/res";
import type { QueryMeLikedDishMediaDto } from "@shared/api/v1/dto";

export function LikeTab() {
	const { callBackend } = useAPICall();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const locale = useLocale();

	// #454 【設計】画面用途キー "profileLikes" でストアからデータ取得
	const key = "profileLikes";
	const { fetchInitialByKey, fetchMoreByKey } = useDishMediaEntriesStore();
	const { ids, isLoading, isLoadingMore, error } = useDishMediaEntriesStore(selectIdsByKey(key));

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
		fetchInitialByKey(key, {}, fetcher);
	}, [key, fetchInitialByKey, fetcher]);

	const handleItemPress = useCallback(
		(dishMediaId: number, index: number) => {
			lightImpact();
			// #454 【設計】pushEntriesByKey を削除し、そのまま遷移
			router.push({
				pathname: "/[locale]/(tabs)/profile/food",
				params: { locale, startIndex: index, tabName: "liked" },
			});
			logFrontendEvent({
				event_name: "dish_media_entry_selected",
				error_level: "log",
				payload: { dishMediaId, tabName: "liked" },
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
			const { entry } = useDishMediaEntriesStore(selectEntryById(item.id));
			if (!entry) return null;

			const gridItem = {
				id: entry.dish_media.id,
				imageUrl: entry.dish_media.thumbnailImageUrl,
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
		fetchMoreByKey(key, {}, fetcher);
	}, [key, fetchMoreByKey, fetcher]);

	const handleRefresh = useCallback(() => {
		fetchInitialByKey(key, {}, fetcher);
	}, [key, fetchInitialByKey, fetcher]);

	const renderEmptyState = useCallback(() => {
		if (error) {
			return (
				<View style={styles.emptyStateContainer}>
					<View style={styles.emptyStateCard}>
						<Text style={styles.emptyStateText}>{error}</Text>
						<TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
							<Text style={styles.retryButtonText}>{i18n.t("Profile.tabError.retry")}</Text>
						</TouchableOpacity>
					</View>
				</View>
			);
		}

		return (
			<View style={styles.emptyStateContainer}>
				<View style={styles.emptyStateCard}>
					<Text style={styles.emptyStateText}>{i18n.t("Profile.emptyState.noLikedDishMediaEntries")}</Text>
					<TouchableOpacity style={styles.searchButton} onPress={handleSearchByMood}>
						<Text style={styles.searchButtonText}>{i18n.t("Profile.buttons.searchByMood")}</Text>
					</TouchableOpacity>
				</View>
			</View>
		);
	}, [error, handleRefresh, handleSearchByMood]);

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
		color: "#FFFFFF",
		fontWeight: "500",
		textShadowColor: "rgba(0, 0, 0, 0.5)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 2,
	},
	emptyStateContainer: {
		flex: 1,
	},
	emptyStateCard: {
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
	emptyStateText: {
		fontSize: 16,
		color: "#6B7280",
		textAlign: "center",
	},
	retryButton: {
		marginTop: 16,
		backgroundColor: "#5EA2FF",
		paddingHorizontal: 20,
		paddingVertical: 10,
		borderRadius: 20,
	},
	retryButtonText: {
		color: "#FFFFFF",
		fontWeight: "600",
	},
	searchButton: {
		marginTop: 16,
		backgroundColor: "#5EA2FF",
		paddingHorizontal: 20,
		paddingVertical: 10,
		borderRadius: 20,
	},
	searchButtonText: {
		color: "#FFFFFF",
		fontWeight: "600",
	},
});
