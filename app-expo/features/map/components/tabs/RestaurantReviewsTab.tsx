import React, { useCallback, useEffect, useState } from "react";
import { View, StyleSheet } from "react-native";
import { GridList } from "@/components/collapsible-tabs/GridList";
import { ImageCard } from "@/components/ImageCardGrid";
import { Text } from "react-native";
import Stars from "@/components/Stars";
import { useCursorPagination } from "@/hooks/useCursorPagination";
import { useAPICall } from "@/hooks/useAPICall";
import type { QueryRestaurantDishMediaDto } from "@shared/api/v1/dto";
import type { QueryRestaurantDishMediaResponse } from "@shared/api/v1/res";
import { useLocale } from "@/hooks/useLocale";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { useHaptics } from "@/hooks/useHaptics";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { FeedDishMediaViewer } from "../FeedDishMediaViewer";

interface RestaurantReviewsTabProps {
	/** レストランID（Google Place ID） */
	restaurantId: string;
}

/**
 * レストランのレビュー（料理メディア）タブコンポーネント
 *
 * useCursorPaginationを使用してレストランの料理メディアを取得し、
 * 3列のグリッドレイアウトで表示する。
 * SavedPostsTabの実装パターンに倣い、カーソル式ページネーションを実装。
 */
export function RestaurantReviewsTab({ restaurantId }: RestaurantReviewsTabProps) {
	const { callBackend } = useAPICall();
	const { lightImpact } = useHaptics();
	// #443 【設計】新 Store API を使用（pushEntriesByKeyAsync で非同期的に追加）
	const { pushEntriesByKeyAsync } = useDishMediaEntriesStore();
	const locale = useLocale();
	const { BlurModal: DishMediaModal, open: openDishMediaModal } = useBlurModal();
	const [selectedDishMediaIndex, setSelectedDishMediaIndex] = useState<number>(0);

	// レストランの料理メディア取得用のカーソルページネーション
	// APIエンドポイント: GET /v1/restaurants/:id/dish-media
	const reviews = useCursorPagination<QueryRestaurantDishMediaDto, QueryRestaurantDishMediaResponse["data"][number]>(
		useCallback(
			async ({ cursor }) => {
				// レストランIDをパスパラメータに含めてAPIを呼び出し
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
		),
	);

	// コンポーネントのマウント時、またはレストランIDが変更された時にデータを初期読み込み
	useEffect(() => {
		if (restaurantId) {
			reviews.loadInitial();
		}
	}, [restaurantId, reviews.loadInitial]);

	const onItemPress = useCallback(
		(item: QueryRestaurantDishMediaResponse["data"][number]) => {
			lightImpact();
			// #443 【設計】新 Store API を使用（pushEntriesByKeyAsync で Store に追加）
			pushEntriesByKeyAsync("map", Promise.resolve(reviews.items));
			const index = reviews.items.findIndex((d) => d.dish_media.id === item.dish_media.id);
			setSelectedDishMediaIndex(index);
			openDishMediaModal();
		},
		[lightImpact, locale, reviews.items, pushEntriesByKeyAsync, openDishMediaModal],
	);

	// グリッドアイテムのレンダリング関数
	// 既存のレイアウト構造を完全に維持
	const renderReviewItem = useCallback(
		({ item }: { item: QueryRestaurantDishMediaResponse["data"][number] }) => (
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

	return (
		<>
			<GridList
				// データ変換: dish_media.idをトップレベルのidとして設定（既存実装を維持）
				data={reviews.items.map((item) => ({ ...item, id: item.dish_media.id }))}
				renderItem={renderReviewItem}
				numColumns={3} // 3列のグリッドレイアウト
				contentContainerStyle={styles.reviewsContent}
				columnWrapperStyle={styles.reviewsRow}
				// ページネーション関連のプロパティ
				onEndReached={reviews.loadMore}
				onRefresh={reviews.refresh}
				refreshing={reviews.isLoadingInitial}
			/>
			<DishMediaModal paddingVertical={0}>
				<FeedDishMediaViewer initialIndex={selectedDishMediaIndex} source="map" />
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
