import React, { useCallback } from "react";
import { FlatList, RefreshControl, View, StyleSheet, FlatListProps, ListRenderItemInfo } from "react-native";
import { Tabs } from "@/components/collapsible-tabs";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { useAppTheme } from "@/contexts/ThemeProvider";

interface GridItem {
	id: string | number;
	[key: string]: any;
}

interface DishMediaEntryForGrid extends GridItem {
	dish_media: {
		id: string;
		thumbnailImageUrl: string;
	};
	dish: {
		averageRating: number;
		reviewCount: number;
	};
}

interface GridListProps<T extends GridItem> {
	data: T[];
	renderItem: ({ item, index }: ListRenderItemInfo<T>) => React.ReactElement;
	keyExtractor?: (item: T, index: number) => string;
	numColumns?: number;
	onEndReached?: () => void;
	onEndReachedThreshold?: number;
	refreshing?: boolean;
	onRefresh?: () => void;
	ListEmptyComponent?: React.ComponentType<any> | React.ReactElement | null;
	ListFooterComponent?: React.ComponentType<any> | React.ReactElement | null;
	ListHeaderComponent?: React.ComponentType<any> | React.ReactElement | null;
	contentContainerStyle?: FlatListProps<T>["contentContainerStyle"];
	columnWrapperStyle?: FlatListProps<T>["columnWrapperStyle"];
	style?: FlatListProps<T>["style"];
	testID?: string;
	isLoading?: boolean;
	isLoadingMore?: boolean;
	onScroll?: FlatListProps<T>["onScroll"];
	/**
	 * #1402 【設計】collapsible-tabs の外（＝単独の画面）で使うときに true にする。
	 *
	 * `Tabs.FlatList` は react-native-collapsible-tab-view のコンテキスト
	 * （`Tabs.Container` > `Tabs.Tab` の内側）を前提にしており、外側で描画すると実行時に落ちる。
	 * プロフィールの 4 グリッドタブを廃止（#1402）した結果、LikeTab / SavedTopicsTab は
	 * «タブのペイン» ではなく «独立したルート» として描画されるようになったため、
	 * そこだけ素の FlatList へ落とす。既定値 false は従来の呼び出し側
	 * （店詳細のレビュー等、まだ Tabs.Container の中にいるもの）を変えないため。
	 */
	standalone?: boolean;
}

export function GridList<T extends GridItem>({
	data,
	renderItem,
	keyExtractor,
	numColumns = 3,
	onEndReached,
	onEndReachedThreshold = 0.5,
	refreshing = false,
	onRefresh,
	ListEmptyComponent,
	ListFooterComponent,
	ListHeaderComponent,
	contentContainerStyle,
	columnWrapperStyle,
	style,
	testID,
	isLoading = false,
	isLoadingMore = false,
	onScroll,
	standalone = false,
}: GridListProps<T>) {
	const { colors } = useAppTheme();
	const defaultKeyExtractor = useCallback(
		(item: T, index: number) => {
			return keyExtractor ? keyExtractor(item, index) : item.id.toString();
		},
		[keyExtractor],
	);

	const renderLoadingFooter = useCallback(() => {
		if (!isLoadingMore) return null;
		return (
			<View style={styles.loadingFooter}>
				<LoadingIndicator size="small" />
			</View>
		);
	}, [isLoadingMore]);

	const refreshControl = onRefresh ? (
		<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.brand]} tintColor={colors.brand} />
	) : undefined;

	if (isLoading) {
		return (
			<View style={styles.loadingContainer}>
				<LoadingIndicator size="large" />
			</View>
		);
	}

	// #1402 単独ルートでは collapsible-tabs のコンテキストが無いので素の FlatList を使う
	const ListComponent = (standalone ? FlatList : Tabs.FlatList) as typeof FlatList;

	return (
		<ListComponent
			data={data}
			renderItem={renderItem}
			keyExtractor={defaultKeyExtractor}
			numColumns={numColumns}
			columnWrapperStyle={numColumns > 1 ? columnWrapperStyle : undefined}
			contentContainerStyle={contentContainerStyle}
			style={style}
			showsVerticalScrollIndicator={false}
			initialNumToRender={12}
			removeClippedSubviews
			onEndReached={onEndReached}
			onEndReachedThreshold={onEndReachedThreshold}
			refreshControl={refreshControl}
			ListEmptyComponent={ListEmptyComponent}
			ListFooterComponent={ListFooterComponent || renderLoadingFooter}
			ListHeaderComponent={ListHeaderComponent}
			testID={testID}
			onScroll={onScroll}
			scrollEventThrottle={16}
			// Performance optimizations from original ImageCardGrid
			windowSize={10}
			maxToRenderPerBatch={6}
			updateCellsBatchingPeriod={100}
			getItemLayout={
				numColumns === 1
					? undefined
					: (data, index) => {
							const ITEM_HEIGHT = 200; // Approximate item height
							const GAP = 1;
							const row = Math.floor(index / numColumns);
							return {
								length: ITEM_HEIGHT,
								offset: (ITEM_HEIGHT + GAP) * row,
								index,
							};
						}
			}
		/>
	);
}

const styles = StyleSheet.create({
	loadingContainer: {
		justifyContent: "center",
		alignItems: "center",
		paddingVertical: 40,
	},
	loadingFooter: {
		paddingVertical: 20,
		alignItems: "center",
	},
});
