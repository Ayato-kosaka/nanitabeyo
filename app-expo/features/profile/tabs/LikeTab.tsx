import React, { useCallback, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { GridList } from "../components/GridList";
import { ImageCard } from "@/components/ImageCardGrid";
import Stars from "@/components/Stars";
import i18n from "@/lib/i18n";
import { useAPICall } from "@/hooks/useAPICall";
import { useCursorPagination } from "@/features/profile/hooks/useCursorPagination";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { useLocale } from "@/hooks/useLocale";
import type { DishMediaEntry, QueryMeLikedDishMediaResponse } from "@shared/api/v1/res";
import type { QueryMeLikedDishMediaDto } from "@shared/api/v1/dto";

export function LikeTab() {
	const { callBackend } = useAPICall();
	const { items, loadInitial, loadMore, refresh, error, isLoadingInitial, isLoadingMore } = useCursorPagination<
		QueryMeLikedDishMediaDto,
		QueryMeLikedDishMediaResponse["data"][number]
	>(
		useCallback(
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
		),
	);

	useEffect(() => {
		loadInitial();
	}, []);

	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { setDishePromises } = useDishMediaEntriesStore();
	const locale = useLocale();

	const handleItemPress = useCallback(
		(item: QueryMeLikedDishMediaResponse["data"][number], index: number) => {
			lightImpact();
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
		({ item, index }: { item: QueryMeLikedDishMediaResponse["data"][number]; index: number }) => {
			const gridItem = {
				...item,
				id: item.dish_media.id,
				imageUrl: item.dish_media.thumbnailImageUrl,
			};
			console.log("Rendering liked item:", gridItem);

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

	const errorMessage = error ? (error instanceof Error ? error.message : String(error)) : null;

	const renderEmptyState = useCallback(() => {
		if (errorMessage) {
			return (
				<View style={styles.emptyStateContainer}>
					<View style={styles.emptyStateCard}>
						<Text style={styles.emptyStateText}>
							{i18n.t("Profile.tabError.failedToLoad", { error: errorMessage })}
						</Text>
						<TouchableOpacity style={styles.retryButton} onPress={refresh}>
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
	}, [errorMessage, refresh, handleSearchByMood]);

	return (
		<GridList
			data={items.map((item) => ({ ...item, id: item.dish_media.id }))}
			renderItem={({ item, index }) => renderLikeItem({ item: item, index })}
			numColumns={3}
			contentContainerStyle={styles.gridContent}
			columnWrapperStyle={styles.gridRow}
			isLoading={isLoadingInitial}
			isLoadingMore={isLoadingMore}
			refreshing={isLoadingInitial}
			onRefresh={refresh}
			onEndReached={loadMore}
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
