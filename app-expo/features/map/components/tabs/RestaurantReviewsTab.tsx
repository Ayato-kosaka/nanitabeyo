import React, { useCallback, useEffect, useMemo } from "react";
import { View, StyleSheet, TouchableOpacity } from "react-native";
import { ImageOff } from "lucide-react-native";
import { GridList } from "@/components/collapsible-tabs/GridList";
import { ImageCard } from "@/components/ImageCardGrid";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { Text } from "react-native";
import { DishRating } from "@/components/DishRating";
// #1629 料理の表示名は `dish_categories.labels` から locale で引く（`dishes.name` は使わない）。
// #1779 で `dishes.name` は列ごと削除した。
import { resolveDishCategoryLabel } from "@/features/myDishes/dishCategoryLabel";
import i18n from "@/lib/i18n";
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
 * #1264 投稿が 1 件も無いときの面。
 *
 * ⚠️ **ここが無いと «見出しの下が真っ白» になる。** 本番の自社 UGC は 90 日で 21 件しか無く、
 * ほとんどの店でこのタブは空である。#1264 の完了条件
 * «レビュー、または **適切な「レビューなし」状態** を表示できる» はこの面のことで、
 * それまで 1 度も描かれていなかった。
 *
 * ⚠️ **投稿ボタンをここへ置かないこと。** #1629 でオーナーが «写真・動画を投稿» を
 * この画面から外し、投稿は «食べたを記録» のフローへ 1 本化すると決めている。
 * 案内文はそのフロー（画面下のタブから辿れる）を指す。
 * デザインガイドライン §4 の «案内文が指す導線がその画面から実際に辿れること» は、
 * タブバーが常に見えているので満たしている。
 */
function ReviewsEmptyState() {
	const styles = useThemedStyles(createEmptyStyles);
	const { colors } = useAppTheme();
	return (
		<View style={styles.container} testID="restaurant-reviews-empty">
			<ImageOff size={28} color={colors.textTertiary} />
			<Text style={styles.title}>{i18n.t("Restaurant.detail.reviews.empty.title")}</Text>
			<Text style={styles.description}>{i18n.t("Restaurant.detail.reviews.empty.description")}</Text>
		</View>
	);
}

/**
 * #1264 取得に失敗したときの面。
 *
 * ⚠️ **空と同じ見た目にしないこと。** «まだ投稿がありません» と出すと、
 * 通信が落ちているだけなのに «この店には投稿が無い» と読ませてしまう。
 */
function ReviewsErrorState({ onRetry }: { onRetry: () => void }) {
	const styles = useThemedStyles(createEmptyStyles);
	return (
		<View style={styles.container} testID="restaurant-reviews-error">
			<Text style={styles.title}>{i18n.t("Restaurant.detail.reviews.error.title")}</Text>
			<TouchableOpacity onPress={onRetry} accessibilityRole="button" style={styles.retry} testID="restaurant-reviews-retry">
				<Text style={styles.retryLabel}>{i18n.t("Common.retry")}</Text>
			</TouchableOpacity>
		</View>
	);
}

const createEmptyStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			alignItems: "center",
			justifyContent: "center",
			paddingVertical: 48,
			paddingHorizontal: 24,
			gap: 8,
		},
		title: {
			fontSize: 15,
			fontWeight: "700",
			color: c.textPrimaryAlt,
			textAlign: "center",
		},
		description: {
			fontSize: 13,
			lineHeight: 19,
			color: c.textSecondary,
			textAlign: "center",
		},
		// 副 CTA なので灰（デザインガイドライン §1。この面に赤は置かない）
		retry: {
			marginTop: 4,
			minHeight: 44,
			justifyContent: "center",
			paddingHorizontal: 20,
			borderRadius: 12,
			backgroundColor: c.surfaceMuted,
		},
		retryLabel: {
			fontSize: 14,
			fontWeight: "600",
			color: c.textSecondaryStrong,
		},
	});

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
						title: resolveDishCategoryLabel(entry.dish.categoryLabels, i18n.locale) ?? undefined,
					}}
					onPress={() => handleItemPress(index, entry.dish_media.id)}>
					<View style={styles.reviewCardOverlay}>
						<Text style={styles.reviewCardTitle}>
							{resolveDishCategoryLabel(entry.dish.categoryLabels, i18n.locale)}
						</Text>
						{/* #1667 0 件のときは何も描かない。判定は DishRating に閉じてある */}
						<DishRating
							averageRating={entry.dish.averageRating}
							reviewCount={entry.dish.reviewCount}
							containerStyle={styles.reviewCardRating}
							countStyle={styles.reviewCardRatingText}
							testID="restaurant-review-card-rating"
						/>
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

	/**
	 * #1264 空の面を出してよいのは «取り終えて 0 件だったとき» だけ。
	 *
	 * ⚠️ `ListEmptyComponent` は **読み込み中も data が空なら描かれる**。
	 * 条件を付けないと、開いた瞬間に «まだ投稿がありません» が一瞬出てから
	 * タイルが現れる（取得できているのに «無い» と読ませる）。
	 */
	const listEmptyComponent = useMemo(() => {
		if (error) return <ReviewsErrorState onRetry={handleRefresh} />;
		if (!hasFetchedInitial || isLoading) return null;
		return <ReviewsEmptyState />;
	}, [error, hasFetchedInitial, isLoading, handleRefresh]);

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
			ListEmptyComponent={listEmptyComponent}
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
