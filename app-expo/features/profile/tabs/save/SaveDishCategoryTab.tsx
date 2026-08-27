import React, { useCallback } from "react";
import { View, Text, StyleSheet, ViewStyle, StyleProp, FlatListProps } from "react-native";
import { GridList } from "@/components/collapsible-tabs/GridList";
import { ImageCard } from "@/components/ImageCardGrid";
import { EmptyState } from "@/components/EmptyState";
import i18n from "@/lib/i18n";
import type { QueryMeSavedDishCategoriesResponse } from "@shared/api/v1/res";
import { useLocale } from "@/hooks/useLocale";
import { useContentWidth } from "@/hooks/useContentWidth";
import { wikimediaThumbFromOriginal } from "@/lib/wikimedia";
import { DishCategory, selectDishCategoryById, useDishCategoriesStore } from "@/stores/useDishCategoriesStore";
import { FixedColors } from "@/constants/Palette";

interface SaveDishCategoryTabProps {
	dishCategoryIds: string[];
	isLoading?: boolean;
	isLoadingMore?: boolean;
	refreshing?: boolean;
	onRefresh?: () => void;
	onEndReached?: () => void;
	onItemPress?: (item: DishCategory, index: number) => void;
	onScroll?: FlatListProps<DishCategory>["onScroll"];
	contentContainerStyle?: StyleProp<ViewStyle>;
	error?: string | null;
	onRetry?: () => void;
	/** #947 空状態のCTAラベル。未指定ならCTAを表示しない */
	emptyActionLabel?: string;
	/** #947 空状態のCTA押下時のハンドラ */
	onEmptyAction?: () => void;
	/** #1402 collapsible-tabs の外（独立したルート）で描画するとき true。GridList のコメント参照 */
	standalone?: boolean;
}

export function SaveDishCategoryTab({
	dishCategoryIds,
	isLoading = false,
	isLoadingMore = false,
	refreshing = false,
	onRefresh,
	onEndReached,
	onItemPress,
	onScroll,
	contentContainerStyle,
	error,
	onRetry,
	emptyActionLabel,
	onEmptyAction,
	standalone = false,
}: SaveDishCategoryTabProps) {
	const { locale } = useLocale();
	// #958 【修正】useWindowDimensions はウィンドウ実幅を返すため、CenteredAppShell が
	// 収める中央カラム幅とズレる(サムネイル取得サイズが過大になる)。useContentWidth に置換
	const deviceWidth = useContentWidth();

	// Calculate card width for 2 columns with 16px padding and 8px gap
	// Same calculation as ImageCardGrid: (deviceWidth - paddingHorizontal*2 - gap*(columns-1)) / columns
	const cardWidth = (deviceWidth - 16 * 2 - 8 * (2 - 1)) / 2;

	const renderDishCategoryItem = useCallback(
		({ item, index }: { item: { id: string }; index: number }) => {
			const dishCategory = selectDishCategoryById(item.id)(useDishCategoriesStore.getState());
			if (!dishCategory) return <View />;
			const dishCategoryLabel = (dishCategory.labels as { [key: string]: string })[locale.split("-")[0]] ?? dishCategory.label_en;
			return (
				<ImageCard
					item={{
						id: dishCategory.id,
						imageUrl: wikimediaThumbFromOriginal(dishCategory.image_url, cardWidth),
						title: dishCategoryLabel,
					}}
					onPress={() => onItemPress?.(dishCategory, index)}
					// #1133 E2E から地点検索モーダルを開くための入口。見た目には影響しない
					testID={`save-dish-category-tab-item-${index}`}>
					<View style={styles.dishCategoryCardOverlay}>
						<Text style={styles.dishCategoryName}>{dishCategoryLabel}</Text>
					</View>
				</ImageCard>
			);
		},
		[onItemPress, cardWidth, locale],
	);

	const renderEmptyState = useCallback(
		() => (
			<EmptyState
				message={i18n.t("Profile.emptyState.noSavedDishCategories")}
				actionLabel={emptyActionLabel}
				onAction={onEmptyAction}
				error={error ? i18n.t("Profile.tabError.failedToLoad", { error }) : null}
				onRetry={onRetry}
				testID="save-dish-category-tab-empty-state"
			/>
		),
		[error, onRetry, emptyActionLabel, onEmptyAction],
	);

	return (
		<GridList
			data={dishCategoryIds.map((id) => ({ id }))}
			renderItem={({ item, index }) => renderDishCategoryItem({ item, index })}
			numColumns={3}
			contentContainerStyle={[styles.gridContent, contentContainerStyle]}
			columnWrapperStyle={styles.gridRow}
			isLoading={isLoading}
			isLoadingMore={isLoadingMore}
			refreshing={refreshing}
			onRefresh={onRefresh}
			onEndReached={onEndReached}
			ListEmptyComponent={renderEmptyState}
			onScroll={onScroll}
			testID="save-dish-category-tab-grid"
			standalone={standalone}
		/>
	);
}

const styles = StyleSheet.create({
	gridContent: {
		paddingHorizontal: 16,
		paddingVertical: 8,
	},
	gridRow: {
		gap: 8,
	},
	dishCategoryCardOverlay: {
		position: "absolute",
		bottom: 0,
		left: 0,
		right: 0,
		backgroundColor: "rgba(0, 0, 0, 0.6)",
		borderBottomLeftRadius: 12,
		borderBottomRightRadius: 12,
		padding: 12,
	},
	dishCategoryName: {
		fontSize: 14,
		fontWeight: "600",
		// 料理写真のサムネイル（暗いオーバーレイ）の上に載る文字なのでテーマで振らない
		color: FixedColors.onMedia,
		marginBottom: 4,
		textShadowColor: "rgba(0, 0, 0, 0.8)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 2,
	},
});
