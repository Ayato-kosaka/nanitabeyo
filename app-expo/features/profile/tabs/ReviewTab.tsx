import React, { useCallback, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { GridList } from "../components/GridList";
import { ImageCard } from "@/components/ImageCardGrid";
import Stars from "@/components/Stars";
import i18n from "@/lib/i18n";
import { useAPICall } from "@/hooks/useAPICall";
import { useCursorPagination } from "@/features/profile/hooks/useCursorPagination";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useAuth } from "@/contexts/AuthProvider";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { useLocale } from "@/hooks/useLocale";
import type { DishMediaEntry, QueryUserDishReviewsResponse } from "@shared/api/v1/res";
import type { QueryUserDishReviewsDto } from "@shared/api/v1/dto";

export function ReviewTab() {
	const { userId } = useLocalSearchParams<{ userId?: string }>();
	const { user } = useAuth();
	const targetUserId = userId && userId !== "me" ? String(userId) : user?.id;
	const { callBackend } = useAPICall();
	const { items, loadInitial, loadMore, refresh, error, isLoadingInitial, isLoadingMore } = useCursorPagination<
		QueryUserDishReviewsDto,
		DishMediaEntry
	>(
		useCallback(
			async ({ cursor }) => {
				const response = await callBackend<QueryUserDishReviewsDto, QueryUserDishReviewsResponse>(
					`v1/users/${targetUserId}/dish-reviews`,
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
			[callBackend, targetUserId],
		),
	);

	useEffect(() => {
		loadInitial();
	}, [loadInitial]);

	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { setDishePromises } = useDishMediaEntriesStore();
	const locale = useLocale();

	const handleItemPress = useCallback(
		(item: DishMediaEntry, index: number) => {
			lightImpact();
			setDishePromises("reviews", Promise.resolve(items));
			router.push({
				pathname: "/[locale]/(tabs)/profile/food",
				params: { locale, startIndex: index, tabName: "reviews" },
			});
			logFrontendEvent({
				event_name: "dish_media_entry_selected",
				error_level: "log",
				payload: { item, tabName: "reviews" },
			});
		},
		[lightImpact, setDishePromises, items, locale, logFrontendEvent],
	);

	const renderReviewItem = useCallback(
		({ item, index }: { item: DishMediaEntry; index: number }) => {
			const gridItem = {
				...item,
				id: item.dish_media.id,
				imageUrl: item.dish_media.thumbnailImageUrl,
			};

			return (
				<ImageCard item={gridItem} onPress={() => handleItemPress(item, index)}>
					<View style={styles.reviewCardOverlay}>
						<View style={styles.reviewCardRating}>
							<Stars rating={item.dish.averageRating} />
							<Text style={styles.reviewCardRatingText}>({item.dish.reviewCount})</Text>
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
					<Text style={styles.emptyStateText}>{i18n.t("Profile.emptyState.noDishReviews")}</Text>
				</View>
			</View>
		);
	}, [errorMessage, refresh]);

	return (
		<GridList
			data={items.map((item) => ({ ...item, id: item.dish_media.id }))}
			renderItem={({ item, index }) => renderReviewItem({ item: item as DishMediaEntry, index })}
			numColumns={3}
			contentContainerStyle={styles.gridContent}
			columnWrapperStyle={styles.gridRow}
			isLoading={isLoadingInitial}
			isLoadingMore={isLoadingMore}
			refreshing={isLoadingInitial}
			onRefresh={refresh}
			onEndReached={loadMore}
			ListEmptyComponent={renderEmptyState}
			testID="review-tab-grid"
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
	reviewCardOverlay: {
		position: "absolute",
		bottom: 8,
		left: 8,
		right: 8,
	},
	reviewCardRating: {
		flexDirection: "row",
		alignItems: "center",
		gap: 4,
	},
	reviewCardRatingText: {
		fontSize: 10,
		color: "#FFF",
		marginLeft: 4,
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
});
