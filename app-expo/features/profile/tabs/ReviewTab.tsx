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
import { useDishMediaEntriesStore, selectIdsByKey, selectEntryById } from "@/stores/useDishMediaEntriesStore";
import { useLocale } from "@/hooks/useLocale";
import type { QueryUserDishReviewsResponse } from "@shared/api/v1/res";
import type { QueryUserDishReviewsDto } from "@shared/api/v1/dto";

export function ReviewTab() {
	const { userId } = useLocalSearchParams<{ userId?: string }>();
	const { user } = useAuth();
	const targetUserId = userId && userId !== "me" ? String(userId) : user?.id;
	const [onlyMyPhotoVideoReviews, setOnlyMyPhotoVideoReviews] = useState(false);
	const { callBackend } = useAPICall();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const locale = useLocale();

	// #454 【設計】画面用途キー "reviews" でストアからデータ取得
	const entriesKey = "reviews" as const;
	const fetchInitialWithMyReviewsByKey = useDishMediaEntriesStore((s) => s.fetchInitialWithMyReviewsByKey);
	const fetchMoreWithMyReviewsByKey = useDishMediaEntriesStore((s) => s.fetchMoreWithMyReviewsByKey);
	const { ids, isLoading, isLoadingMore, error, hasFetchedInitial } = useDishMediaEntriesStore(
		selectIdsByKey(entriesKey),
	);

	// #454 【設計】データ取得用の fetcher 関数
	const fetcher = useCallback(
		async ({ cursor }: { cursor?: string | null }) => {
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

	useEffect(() => {
		if (hasFetchedInitial) return;
		fetchInitialWithMyReviewsByKey(entriesKey, {}, fetcher);
	}, [entriesKey, fetchInitialWithMyReviewsByKey, fetcher, hasFetchedInitial]);

	// #454 【設計】フィルタリングは表示時に ids から行う
	const filteredIds = useMemo(() => {
		if (!onlyMyPhotoVideoReviews || !targetUserId) return ids;
		// #457 【設計】正規化ストアから復元したエントリでフィルタ
		return ids.filter((id) => {
			const entry = selectEntryById(id, { key: entriesKey })(useDishMediaEntriesStore.getState());
			return entry?.dish_media.isMine;
		});
	}, [onlyMyPhotoVideoReviews, ids, targetUserId, entriesKey]);

	const handleItemPress = useCallback(
		(reviewId: string, index: number) => {
			lightImpact();
			router.push({
				pathname: "/[locale]/(tabs)/profile/food",
				params: { locale, startIndex: index, tabName: entriesKey },
			});
			logFrontendEvent({
				event_name: "dish_media_entry_selected",
				error_level: "log",
				payload: { reviewId, entriesKey },
			});
		},
		[lightImpact, locale, logFrontendEvent],
	);

	const renderReviewItem = useCallback(
		({ item, index }: { item: { id: string }; index: number }) => {
			const entry = selectEntryById(item.id, { key: entriesKey })(useDishMediaEntriesStore.getState());
			if (!entry) return <View />; // エントリが存在しない場合は空ビューを返す

			const gridItem = {
				id: item.id,
				imageUrl: entry.dish_media.thumbnailImageUrl,
			};

			return (
				<ImageCard item={gridItem} onPress={() => handleItemPress(item.id, index)}>
					<View style={styles.reviewCardOverlay}>
						<View style={styles.reviewCardRating}>
							<Stars rating={entry.dish.averageRating} />
							<Text style={styles.reviewCardRatingText}>({entry.dish.reviewCount})</Text>
						</View>
					</View>
				</ImageCard>
			);
		},
		[handleItemPress, entriesKey],
	);

	const handleLoadMore = useCallback(() => {
		fetchMoreWithMyReviewsByKey(entriesKey, {}, fetcher);
	}, [entriesKey, fetchMoreWithMyReviewsByKey, fetcher]);

	const handleRefresh = useCallback(() => {
		fetchInitialWithMyReviewsByKey(entriesKey, {}, fetcher);
	}, [entriesKey, fetchInitialWithMyReviewsByKey, fetcher]);

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
					<Text style={styles.emptyStateText}>{i18n.t("Profile.emptyState.noDishReviews")}</Text>
				</View>
			</View>
		);
	}, [error, handleRefresh]);

	return (
		<GridList
			data={filteredIds.map((id) => ({ id }))}
			renderItem={({ item, index }) => renderReviewItem({ item, index })}
			ListHeaderComponent={header}
			numColumns={3}
			contentContainerStyle={styles.gridContent}
			columnWrapperStyle={styles.gridRow}
			isLoading={isLoading}
			isLoadingMore={isLoadingMore}
			refreshing={isLoading}
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
