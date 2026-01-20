import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, StyleSheet } from "react-native";
import { GridList } from "@/components/collapsible-tabs/GridList";
import { ImageCard } from "@/components/ImageCardGrid";
import { Text } from "react-native";
import Stars from "@/components/Stars";
import { useAPICall } from "@/hooks/useAPICall";
import type { QueryRestaurantDishMediaDto } from "@shared/api/v1/dto";
import type { QueryRestaurantDishMediaResponse } from "@shared/api/v1/res";
import { useDishMediaEntriesStore, selectIdsByKey, selectEntryByMediaId } from "@/stores/useDishMediaEntriesStore";
import { useHaptics } from "@/hooks/useHaptics";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { FeedDishMediaViewer } from "../FeedDishMediaViewer";
import { shallow } from "zustand/shallow";
import { mapReviewsKey } from "../../constants";

interface RestaurantReviewsTabProps {
	/** レストランID（Google Place ID） */
	restaurantId: string;
	/** レビューアイテムをタップした時のハンドラ: index, dishMediaId を渡す */
	onItemPress?: (index: number, dishMediaId: string) => void;
}

/**
 * レストランのレビュー（料理メディア）タブコンポーネント
 *
 * #454 【設計】useDishMediaEntriesStore の Pagination API を利用してレストランの料理メディアを取得
 * 3列のグリッドレイアウトで表示する。
 */
export function RestaurantReviewsTab({ restaurantId, onItemPress }: RestaurantReviewsTabProps) {
	const { callBackend } = useAPICall();
	const { lightImpact } = useHaptics();
	const { BlurModal: DishMediaModal, open: openDishMediaModal } = useBlurModal();
	const [selectedDishMediaIndex, setSelectedDishMediaIndex] = useState<number>(0);

	// #454 【設計】画面用途キー "mapReviews" でストアからデータ取得
	const entriesKey = useMemo(() => mapReviewsKey(restaurantId), [restaurantId]);
	const fetchInitialByKey = useDishMediaEntriesStore((s) => s.fetchInitialByKey);
	const fetchMoreByKey = useDishMediaEntriesStore((s) => s.fetchMoreByKey);
	const { ids, isLoading, hasFetchedInitial } = useDishMediaEntriesStore(
		selectIdsByKey(entriesKey, "dish_media"),
		shallow,
	);

	// #454 【設計】データ取得用の fetcher 関数
	const fetcher = useCallback(
		async ({ cursor }: { cursor?: string | null }) => {
			const response = await callBackend<QueryRestaurantDishMediaDto, QueryRestaurantDishMediaResponse>(
				`v1/restaurants/${restaurantId}/dish-media`,
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
		[callBackend, restaurantId],
	);

	// コンポーネントのマウント時、またはレストランIDが変更された時にデータを初期読み込み
	useEffect(() => {
		if (restaurantId && !hasFetchedInitial && !isLoading) {
			fetchInitialByKey(entriesKey, {}, fetcher);
		}
	}, [restaurantId, entriesKey, fetchInitialByKey, fetcher, hasFetchedInitial, isLoading]);

	// クリーンアップ用（entriesKey が変わる/アンマウント時だけ）
	useEffect(() => {
		return () => {
			useDishMediaEntriesStore.getState().clearByKey(entriesKey);
		};
	}, [entriesKey]);

	const handleItemPress = useCallback(
		(index: number, dishMediaId: string) => {
			if (onItemPress) {
				onItemPress(index, dishMediaId);
			} else {
				lightImpact();
				setSelectedDishMediaIndex(index);
				openDishMediaModal();
			}
		},
		[lightImpact, openDishMediaModal, onItemPress],
	);

	// グリッドアイテムのレンダリング関数
	const renderReviewItem = useCallback(
		({ item, index }: { item: { id: string }; index: number }) => {
			const entry = selectEntryByMediaId(item.id)(useDishMediaEntriesStore.getState());
			if (!entry) return <View />; // エントリが存在しない場合は空ビューを返す

			return (
				<ImageCard
					item={{ id: entry.dish_media.id, imageUrl: entry.dish_media.thumbnailImageUrl }}
					onPress={() => handleItemPress(index, entry.dish_media.id)}>
					<View style={styles.reviewCardOverlay}>
						<Text style={styles.reviewCardTitle}>{entry.dish.name}</Text>
						<View style={styles.reviewCardRating}>
							<Stars rating={entry.dish.averageRating} />
							<Text style={styles.reviewCardRatingText}>({entry.dish.reviewCount})</Text>
						</View>
					</View>
				</ImageCard>
			);
		},
		[handleItemPress],
	);

	const handleLoadMore = useCallback(() => {
		fetchMoreByKey(entriesKey, {}, fetcher);
	}, [entriesKey, fetchMoreByKey, fetcher]);

	const handleRefresh = useCallback(() => {
		fetchInitialByKey(entriesKey, {}, fetcher);
	}, [entriesKey, fetchInitialByKey, fetcher]);

	return (
		<>
			<GridList
				data={ids.map((id) => ({ id }))}
				renderItem={renderReviewItem}
				numColumns={3}
				contentContainerStyle={styles.reviewsContent}
				columnWrapperStyle={styles.reviewsRow}
				onEndReached={handleLoadMore}
				onRefresh={handleRefresh}
				refreshing={isLoading}
			/>
			<DishMediaModal paddingVertical={0}>
				<FeedDishMediaViewer initialIndex={selectedDishMediaIndex} entriesKey={entriesKey} />
			</DishMediaModal>
		</>
	);
}

// 既存のスタイルを完全に維持
const styles = StyleSheet.create({
	reviewsContent: {
		paddingHorizontal: 16,
		paddingVertical: 8,
	},
	reviewsRow: {
		gap: 1,
	},
	reviewCardOverlay: {
		position: "absolute",
		bottom: 8,
		left: 8,
		right: 8,
		flexDirection: "column",
		justifyContent: "space-between",
	},
	reviewCardTitle: {
		fontSize: 12,
		fontWeight: "600",
		color: "#FFF",
		marginBottom: 4,
	},
	reviewCardRating: {
		flexDirection: "row",
		alignItems: "center",
	},
	reviewCardRatingText: {
		fontSize: 10,
		color: "#FFF",
		marginLeft: 4,
	},
});
