import React, { useCallback } from "react";
import {
	ActivityIndicator,
	RefreshControl,
	View,
	Text,
	StyleSheet,
	FlatListProps,
	ListRenderItemInfo,
} from "react-native";
import { Tabs } from "@/components/collapsible-tabs";

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
}: GridListProps<T>) {
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
				<ActivityIndicator size="small" color="#5EA2FF" />
			</View>
		);
	}, [isLoadingMore]);

	const refreshControl = onRefresh ? (
		<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={["#5EA2FF"]} tintColor="#5EA2FF" />
	) : undefined;

	if (isLoading) {
		return (
			<View style={styles.loadingContainer}>
				<ActivityIndicator size="large" color="#5EA2FF" />
			</View>
		);
	}

	return (
		<Tabs.FlatList
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
