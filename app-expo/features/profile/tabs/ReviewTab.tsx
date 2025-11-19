// #454 【設計】useDishMediaEntriesStore のページネーションAPIを使用してサムネイル表示
import React, { useCallback, useEffect, useState, useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { GridList } from "@/components/collapsible-tabs/GridList";
import { ImageCard } from "@/components/ImageCardGrid";
import Stars from "@/components/Stars";
import i18n from "@/lib/i18n";
import { useAPICall } from "@/hooks/useAPICall";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useAuth } from "@/contexts/AuthProvider";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { useLocale } from "@/hooks/useLocale";
import type { DishMediaEntry, QueryUserDishReviewsResponse } from "@shared/api/v1/res";
import type { QueryUserDishReviewsDto } from "@shared/api/v1/dto";
import type { Fetcher } from "@/lib/createCursorController";

export function ReviewTab() {
	const { userId } = useLocalSearchParams<{ userId?: string }>();
	const { user } = useAuth();
	const targetUserId = userId && userId !== "me" ? String(userId) : user?.id;
	const [onlyMyPhotoVideoReviews, setOnlyMyPhotoVideoReviews] = useState(false);
	const { callBackend } = useAPICall();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const locale = useLocale();

	// #454 【設計】ストアの画面用途キー（このタブ専用）
	const storeKey = `profileReviews_${targetUserId}`;

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
	const fetcher = useCallback<Fetcher<QueryUserDishReviewsDto, DishMediaEntry>>(
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
	);

	// #454 【設計】初期ロード
	useEffect(() => {
		fetchInitialByKey(storeKey, {}, fetcher);
	}, [storeKey, fetchInitialByKey, fetcher]);

	// #454 【設計】ストアから正規化データを取得
	const mediaIds = selectIdsByKey(storeKey);
	const items = mediaIds.map((id) => selectEntryById(id)).filter((item): item is DishMediaEntry => item !== undefined);

	const displayedItems = useMemo(
		() => (onlyMyPhotoVideoReviews && targetUserId ? items.filter((e) => e.dish_media.isMine) : items),
		[onlyMyPhotoVideoReviews, items, targetUserId],
	);

	const handleItemPress = useCallback(
		(item: DishMediaEntry, index: number) => {
			lightImpact();
			// #454 【設計】遷移先が旧実装（dishPromisesMap）を使用しているため、
			// 互換性のため setDishePromises を呼び出す
			setDishePromises("reviews", Promise.resolve(displayedItems));
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
		[lightImpact, setDishePromises, displayedItems, locale, logFrontendEvent],
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

	const header = useMemo(
		() => (
			<TouchableOpacity
				style={styles.checkboxContainer}
				onPress={() => setOnlyMyPhotoVideoReviews(!onlyMyPhotoVideoReviews)}
				activeOpacity={0.7}>
				<View style={[styles.checkbox, onlyMyPhotoVideoReviews && styles.checkboxChecked]}>
					{onlyMyPhotoVideoReviews && <Text style={styles.checkboxMark}>✓</Text>}
				</View>
				<Text style={styles.checkboxLabel}>{i18n.t("Profile.reviews.filter.onlyMyPhotoVideo")}</Text>
			</TouchableOpacity>
		),
		[onlyMyPhotoVideoReviews],
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
					<Text style={styles.emptyStateText}>{i18n.t("Profile.emptyState.noDishReviews")}</Text>
				</View>
			</View>
		);
	}, [errorMessage, refreshByKey, storeKey]);

	const handleLoadMore = useCallback(() => {
		fetchMoreByKey(storeKey, fetcher);
	}, [storeKey, fetchMoreByKey, fetcher]);

	const handleRefresh = useCallback(() => {
		refreshByKey(storeKey);
	}, [storeKey, refreshByKey]);

	return (
		<GridList
			data={displayedItems.map((item) => ({ ...item, id: item.dish_reviews[0].id }))}
			renderItem={({ item, index }) => renderReviewItem({ item, index })}
			ListHeaderComponent={header}
			numColumns={3}
			contentContainerStyle={styles.gridContent}
			columnWrapperStyle={styles.gridRow}
			isLoading={isLoadingByKey[storeKey] || false}
			isLoadingMore={isLoadingMoreByKey[storeKey] || false}
			refreshing={isLoadingByKey[storeKey] || false}
			onRefresh={handleRefresh}
			onEndReached={handleLoadMore}
			ListEmptyComponent={renderEmptyState}
			testID="review-tab-grid"
		/>
	);
}

const styles = StyleSheet.create({
	checkboxContainer: {
		paddingRight: 16,
		paddingVertical: 8,
		flexDirection: "row",
		alignItems: "center",
	},
	checkbox: {
		width: 24,
		height: 24,
		borderRadius: 6,
		alignItems: "center",
		justifyContent: "center",
		marginRight: 12,
		backgroundColor: "#FFFFFF",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.3,
		shadowRadius: 16,
		elevation: 4,
	},
	checkboxChecked: {
		backgroundColor: "#5EA2FF",
		borderColor: "#5EA2FF",
	},
	checkboxMark: {
		color: "#FFFFFF",
		fontSize: 14,
		fontWeight: "700",
	},
	checkboxLabel: {
		fontSize: 14,
		color: "#374151",
	},
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
