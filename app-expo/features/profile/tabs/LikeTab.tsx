// #454 【設計】useDishMediaEntriesStore のページネーションAPIを使用してサムネイル表示
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
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { useLocale } from "@/hooks/useLocale";
import type { QueryMeLikedDishMediaResponse, DishMediaEntry } from "@shared/api/v1/res";
import type { QueryMeLikedDishMediaDto } from "@shared/api/v1/dto";
import type { Fetcher } from "@/lib/createCursorController";

export function LikeTab() {
	const { callBackend } = useAPICall();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const locale = useLocale();

	// #454 【設計】ストアの画面用途キー（このタブ専用）
	const storeKey = "profileLikes";

	const {
		fetchInitialByKey,
		fetchMoreByKey,
		refreshByKey,
		selectIdsByKey,
		selectEntryById,
		isLoadingByKey,
		isLoadingMoreByKey,
		errorByKey,
		setDishePromises, // 旧互換のため残す（遷移先が使用）
	} = useDishMediaEntriesStore();

	// #454 【設計】データ取得関数（Fetcher型）
	const fetcher = useCallback<Fetcher<QueryMeLikedDishMediaDto, DishMediaEntry>>(
		async ({ cursor }) => {
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

	// #454 【設計】初期ロード
	useEffect(() => {
		fetchInitialByKey(storeKey, {}, fetcher);
	}, [storeKey, fetchInitialByKey, fetcher]);

	// #454 【設計】ストアから正規化データを取得
	const mediaIds = selectIdsByKey(storeKey);
	const items = mediaIds.map((id) => selectEntryById(id)).filter((item): item is DishMediaEntry => item !== undefined);

	const handleItemPress = useCallback(
		(item: DishMediaEntry, index: number) => {
			lightImpact();
			// #454 【設計】遷移先が旧実装（dishPromisesMap）を使用しているため、
			// 互換性のため setDishePromises を呼び出す
			setDishePromises("liked", Promise.resolve(items));
			router.push({
				pathname: "/[locale]/(tabs)/profile/food",
				params: { locale, startIndex: index, tabName: "liked" },
			});
			logFrontendEvent({
				event_name: "dish_media_entry_selected",
				error_level: "log",
				payload: { item, tabName: "liked" },
			});
		},
		[lightImpact, setDishePromises, items, locale, logFrontendEvent],
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
		({ item, index }: { item: DishMediaEntry; index: number }) => {
			const gridItem = {
				...item,
				id: item.dish_media.id,
				imageUrl: item.dish_media.thumbnailImageUrl,
			};

			return (
				<ImageCard item={gridItem} onPress={() => handleItemPress(item, index)}>
					<View style={styles.likeCardOverlay}>
						<View style={styles.likeCardRating}>
							<Stars rating={item.dish.averageRating} />
							<Text style={styles.likeCardRatingText}>({item.dish.reviewCount})</Text>
						</View>
					</View>
				</ImageCard>
			);
		},
		[handleItemPress],
	);

	const error = errorByKey[storeKey];
	const errorMessage = error ? (typeof error === "string" ? error : String(error)) : null;

	const renderEmptyState = useCallback(() => {
		if (errorMessage) {
			return (
				<View style={styles.emptyStateContainer}>
					<View style={styles.emptyStateCard}>
						<Text style={styles.emptyStateText}>
							{i18n.t("Profile.tabError.failedToLoad", { error: errorMessage })}
						</Text>
						<TouchableOpacity style={styles.retryButton} onPress={() => refreshByKey(storeKey)}>
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
	}, [errorMessage, refreshByKey, storeKey, handleSearchByMood]);

	const handleLoadMore = useCallback(() => {
		fetchMoreByKey(storeKey, fetcher);
	}, [storeKey, fetchMoreByKey, fetcher]);

	const handleRefresh = useCallback(() => {
		refreshByKey(storeKey);
	}, [storeKey, refreshByKey]);

	return (
		<GridList
			data={items.map((item) => ({ ...item, id: item.dish_media.id }))}
			renderItem={({ item, index }) => renderLikeItem({ item: item, index })}
			numColumns={3}
			contentContainerStyle={styles.gridContent}
			columnWrapperStyle={styles.gridRow}
			isLoading={isLoadingByKey[storeKey] || false}
			isLoadingMore={isLoadingMoreByKey[storeKey] || false}
			refreshing={isLoadingByKey[storeKey] || false}
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
