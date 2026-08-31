import React, { useCallback, useEffect, useMemo } from "react";
import { View, StyleSheet } from "react-native";
import { GridList } from "@/components/collapsible-tabs/GridList";
import { ImageCard } from "@/components/ImageCardGrid";
import { FixedColors } from "@/constants/Palette";
import { Text } from "react-native";
import Stars from "@/components/Stars";
import { useDishMediaEntriesStore, selectIdsByKey, selectEntryByMediaId } from "@/stores/useDishMediaEntriesStore";
import { useRestaurantDishMediaFetcher } from "../../hooks/useRestaurantDishMediaFetcher";
import { shallow } from "zustand/shallow";
import { mapReviewsKey } from "../../constants";

interface RestaurantReviewsTabProps {
	/** レストランID（Google Place ID） */
	restaurantId: string;
	/**
	 * レビューアイテムをタップした時のハンドラ: index, dishMediaId を渡す。
	 *
	 * #1386 【設計】必須にしてある。以前は «未指定なら自分で `DishMediaModal`（BlurModal・既定 z1100）を
	 * 重ねてフィードを出す» という第 2 の挙動を持っていて、同じタブが呼び出し元によって
	 * 「push する / オーバーレイを重ねる」のどちらにもなっていた。重なり順は呼び出し側の
	 * 手動 zIndex 任せで、親（店詳細シート）と同値のまま下へ潜りうる状態だった（#1350 §D）。
	 * 押した先を決めるのは «画面» の責務なので、ここでは受け取るだけにする。
	 */
	onItemPress: (index: number, dishMediaId: string) => void;
}

/**
 * レストランのレビュー（料理メディア）タブコンポーネント
 *
 * #454 【設計】useDishMediaEntriesStore の Pagination API を利用してレストランの料理メディアを取得
 * 3列のグリッドレイアウトで表示する。
 */
export function RestaurantReviewsTab({ restaurantId, onItemPress }: RestaurantReviewsTabProps) {
	// #454 【設計】画面用途キー "mapReviews" でストアからデータ取得
	const entriesKey = useMemo(() => mapReviewsKey(restaurantId), [restaurantId]);
	const fetchInitialByKey = useDishMediaEntriesStore((s) => s.fetchInitialByKey);
	const fetchMoreByKey = useDishMediaEntriesStore((s) => s.fetchMoreByKey);
	const { ids, isLoading, hasFetchedInitial, error } = useDishMediaEntriesStore(
		selectIdsByKey(entriesKey, "dish_media"),
		shallow,
	);

	// #454 【設計】データ取得用の fetcher 関数
	// #1386 フィードのルートと共有するため hooks/useRestaurantDishMediaFetcher.ts へ移した
	const fetcher = useRestaurantDishMediaFetcher(restaurantId);

	// コンポーネントのマウント時、またはレストランIDが変更された時にデータを初期読み込み
	//
	// ⚠️ `!error` を必ず条件へ入れること。取得が失敗したときストアは `hasFetchedInitial` を
	// false のまま `isLoading` を false へ戻すので（stores/useDishMediaEntriesStore.ts の
	// handleAsyncAction）、error を見ないと **失敗するたびに再取得して無限ループする**。
	// #1388 のレビュー指摘: 同じ entriesKey・同じ fetcher を使う feed ルート
	// （app/[locale]/restaurant/[restaurantId]/feed.tsx）にはこのガードが
	// 入っていたが、こちら側だけ抜けていた。«同じものが 2 つあって片方だけ直る» 形なので揃える
	useEffect(() => {
		if (restaurantId && !hasFetchedInitial && !isLoading && !error) {
			fetchInitialByKey(entriesKey, {}, fetcher);
		}
	}, [restaurantId, entriesKey, fetchInitialByKey, fetcher, hasFetchedInitial, isLoading, error]);

	// クリーンアップ用（entriesKey が変わる/アンマウント時だけ）
	useEffect(() => {
		return () => {
			useDishMediaEntriesStore.getState().clearByKey(entriesKey);
		};
	}, [entriesKey]);

	const handleItemPress = useCallback(
		(index: number, dishMediaId: string) => {
			onItemPress(index, dishMediaId);
		},
		[onItemPress],
	);

	// グリッドアイテムのレンダリング関数
	const renderReviewItem = useCallback(
		({ item, index }: { item: { id: string }; index: number }) => {
			const entry = selectEntryByMediaId(item.id)(useDishMediaEntriesStore.getState());
			if (!entry) return <View />; // エントリが存在しない場合は空ビューを返す

			return (
				<ImageCard
					// #1629 押下先が feed へ変わったので e2e から掴めるようにする。
					// 位置つきで開くこと（initialIndex）を確かめるため、タイルは複数出ても同じ id でよい
					testID="restaurant-review-tile"
					item={{
						id: entry.dish_media.id,
						imageUrl: entry.dish_media.thumbnailImageUrl ?? "",
						title: entry.dish.name ?? undefined,
					}}
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
		// 写真（ImageCard）の上に載る文字なのでテーマで振らない固定色
		color: FixedColors.onMedia,
		marginBottom: 4,
	},
	reviewCardRating: {
		flexDirection: "row",
		alignItems: "center",
	},
	reviewCardRatingText: {
		fontSize: 10,
		color: FixedColors.onMedia,
		marginLeft: 4,
	},
});
