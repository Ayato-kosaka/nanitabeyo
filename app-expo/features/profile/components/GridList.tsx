import React, { ReactNode, useCallback } from "react";
import {
	FlatList,
	ListRenderItemInfo,
	StyleProp,
	ViewStyle,
	RefreshControl,
	ActivityIndicator,
	View,
	StyleSheet,
} from "react-native";
import type { ImageCardItem } from "@/components/ImageCardGrid";

interface GridListProps<T = any> {
	data: T[];
	numColumns?: number;
	ListHeaderComponent?: ReactNode;
	renderItem: (info: ListRenderItemInfo<T>) => React.ReactElement;
	keyExtractor: (item: T, index: number) => string;
	onEndReached?: () => void;
	onEndReachedThreshold?: number;
	refreshControl?: React.ReactElement<any>;
	ListEmptyComponent?: React.ComponentType<any> | React.ReactElement | null;
	ListFooterComponent?: React.ComponentType<any> | React.ReactElement | null;
	contentContainerStyle?: StyleProp<ViewStyle>;
	showsVerticalScrollIndicator?: boolean;
	initialNumToRender?: number;
	removeClippedSubviews?: boolean;
	isRefreshing?: boolean;
	onRefresh?: () => void;
	isLoadingMore?: boolean;
	gap?: number;
	paddingHorizontal?: number;
}

export function GridList<T = any>({
	data,
	numColumns = 3,
	ListHeaderComponent,
	renderItem,
	keyExtractor,
	onEndReached,
	onEndReachedThreshold = 0.5,
	refreshControl,
	ListEmptyComponent,
	ListFooterComponent,
	contentContainerStyle,
	showsVerticalScrollIndicator = false,
	initialNumToRender = 12,
	removeClippedSubviews = true,
	isRefreshing = false,
	onRefresh,
	isLoadingMore = false,
	gap = 1,
	paddingHorizontal = 16,
}: GridListProps<T>) {
	const defaultRefreshControl = useCallback(() => {
		if (!onRefresh) return undefined;
		return (
			<RefreshControl
				refreshing={isRefreshing}
				onRefresh={onRefresh}
				colors={["#5EA2FF"]}
				tintColor="#5EA2FF"
			/>
		);
	}, [isRefreshing, onRefresh]);

	const getItemLayout = useCallback(
		(data: any, index: number) => {
			if (!data || index < 0) return { length: 0, offset: 0, index };
			const itemHeight = ((global.screen?.width || 375) - paddingHorizontal * 2 - gap * (numColumns - 1)) / numColumns * (16 / 9);
			const headerHeight = ListHeaderComponent ? 400 : 0; // Approximate header height
			return {
				length: itemHeight + gap,
				offset: headerHeight + Math.floor(index / numColumns) * (itemHeight + gap),
				index,
			};
		},
		[numColumns, gap, paddingHorizontal, ListHeaderComponent]
	);

	const renderLoadingFooter = useCallback(() => {
		if (!isLoadingMore) return null;
		return (
			<View style={styles.loadingFooter}>
				<ActivityIndicator size="small" color="#5EA2FF" />
			</View>
		);
	}, [isLoadingMore]);

	return (
		<FlatList
			data={data}
			renderItem={renderItem}
			keyExtractor={keyExtractor}
			numColumns={numColumns}
			key={numColumns} // Force re-render when numColumns changes
			columnWrapperStyle={numColumns > 1 ? { gap } : undefined}
			contentContainerStyle={[{ paddingHorizontal }, contentContainerStyle]}
			showsVerticalScrollIndicator={showsVerticalScrollIndicator}
			initialNumToRender={initialNumToRender}
			removeClippedSubviews={removeClippedSubviews}
			onEndReached={onEndReached}
			onEndReachedThreshold={onEndReachedThreshold}
			refreshControl={refreshControl || defaultRefreshControl()}
			ListHeaderComponent={ListHeaderComponent as any}
			ListEmptyComponent={ListEmptyComponent}
			ListFooterComponent={ListFooterComponent || renderLoadingFooter}
			getItemLayout={getItemLayout}
		/>
	);
}

const styles = StyleSheet.create({
	loadingFooter: {
		paddingVertical: 20,
		alignItems: "center",
	},
});