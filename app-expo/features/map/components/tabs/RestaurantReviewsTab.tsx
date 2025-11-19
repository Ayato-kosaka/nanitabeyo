// #454 【設計】useDishMediaEntriesStore のページネーションAPIを使用してサムネイル表示
import React, { useCallback, useEffect, useState } from "react";
import { View, StyleSheet, Text } from "react-native";
import { GridList } from "@/components/collapsible-tabs/GridList";
import { ImageCard } from "@/components/ImageCardGrid";
import Stars from "@/components/Stars";
import { useAPICall } from "@/hooks/useAPICall";
import type { QueryRestaurantDishMediaDto } from "@shared/api/v1/dto";
import type { QueryRestaurantDishMediaResponse } from "@shared/api/v1/res";
import { useLocale } from "@/hooks/useLocale";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { useHaptics } from "@/hooks/useHaptics";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { FeedDishMediaViewer } from "../FeedDishMediaViewer";
import type { Fetcher } from "@/lib/createCursorController";
import type { DishMediaEntry } from "@shared/api/v1/res";

interface RestaurantReviewsTabProps {
	/** レストランID（Google Place ID） */
	restaurantId: string;
}

/**
 * レストランのレビュー（料理メディア）タブコンポーネント
 *
 * #454 【設計】useDishMediaEntriesStore のページネーションAPIを使用
 * ストアの正規化データから描画し、画面遷移時に pushEntriesByKey を呼ばない
 */
export function RestaurantReviewsTab({ restaurantId }: RestaurantReviewsTabProps) {
	const { callBackend } = useAPICall();
	const { lightImpact } = useHaptics();
	const locale = useLocale();
	const { BlurModal: DishMediaModal, open: openDishMediaModal } = useBlurModal();
	const [selectedDishMediaIndex, setSelectedDishMediaIndex] = useState<number>(0);

	// #454 【設計】ストアの画面用途キー（このタブ専用）
	const storeKey = `mapReviews_${restaurantId}`;

	const {
		fetchInitialByKey,
		fetchMoreByKey,
		refreshByKey,
		selectIdsByKey,
		selectEntryById,
		isLoadingByKey,
		isLoadingMoreByKey,
		errorByKey,
		nextCursorByKey,
		setDishePromises, // 旧互換のため残す（FeedDishMediaViewerが使用）
	} = useDishMediaEntriesStore();

	// #454 【設計】データ取得関数（Fetcher型）
	const fetcher = useCallback<Fetcher<QueryRestaurantDishMediaDto, DishMediaEntry>>(
		async ({ cursor }) => {
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

	// #454 【設計】初期ロード
	useEffect(() => {
		if (restaurantId) {
			fetchInitialByKey(storeKey, {}, fetcher);
		}
	}, [restaurantId, storeKey, fetchInitialByKey, fetcher]);

	// #454 【設計】ストアから正規化データを取得
	const mediaIds = selectIdsByKey(storeKey);
	const items = mediaIds.map((id) => selectEntryById(id)).filter((item): item is DishMediaEntry => item !== undefined);

	const onItemPress = useCallback(
		(item: DishMediaEntry) => {
			lightImpact();
			// #454 【設計】FeedDishMediaViewer が旧実装（dishPromisesMap）を使用しているため、
			// 互換性のため setDishePromises を呼び出す
			// 将来的には FeedDishMediaViewer もストアの正規化データを直接参照するように修正予定
			setDishePromises(storeKey, Promise.resolve(items));
			const index = items.findIndex((d) => d.dish_media.id === item.dish_media.id);
			setSelectedDishMediaIndex(index);
			openDishMediaModal();
		},
		[lightImpact, locale, items, setDishePromises, storeKey, openDishMediaModal],
	);

	const renderReviewItem = useCallback(
		({ item }: { item: DishMediaEntry }) => (
			<ImageCard
				item={{ id: item.dish_media.id, imageUrl: item.dish_media.thumbnailImageUrl }}
				onPress={() => onItemPress(item)}>
				<View style={styles.reviewCardOverlay}>
					<Text style={styles.reviewCardTitle}>{item.dish.name}</Text>
					<View style={styles.reviewCardRating}>
						<Stars rating={item.dish.averageRating} />
						<Text style={styles.reviewCardRatingText}>({item.dish.reviewCount})</Text>
					</View>
				</View>
			</ImageCard>
		),
		[onItemPress],
	);

	const handleLoadMore = useCallback(() => {
		fetchMoreByKey(storeKey, fetcher);
	}, [storeKey, fetchMoreByKey, fetcher]);

	const handleRefresh = useCallback(() => {
		refreshByKey(storeKey);
	}, [storeKey, refreshByKey]);

	return (
		<>
			<GridList
				data={items.map((item) => ({ ...item, id: item.dish_media.id }))}
				renderItem={renderReviewItem}
				numColumns={3}
				contentContainerStyle={styles.reviewsContent}
				columnWrapperStyle={styles.reviewsRow}
				onEndReached={handleLoadMore}
				onRefresh={handleRefresh}
				refreshing={isLoadingByKey[storeKey] || false}
			/>
			<DishMediaModal paddingVertical={0}>
				<FeedDishMediaViewer initialIndex={selectedDishMediaIndex} source={storeKey} />
			</DishMediaModal>
		</>
	);
}

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
