import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, FlatList, useWindowDimensions, ViewToken, View } from "react-native";
import FoodContentScreen from "./FoodContentScreen";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import type { DishMediaEntry } from "@shared/api/v1/res";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";

interface FoodContentFeedProps {
	items: DishMediaEntry[];
	initialIndex?: number;
	onIndexChange?: (index: number) => void;
}

export default function FoodContentFeed({ items, initialIndex = 0, onIndexChange }: FoodContentFeedProps) {
	const listRef = useRef<FlatList<DishMediaEntry>>(null);
	const { height: winH } = useWindowDimensions();
	const insets = useSafeAreaInsets();
	let tabH = 0;
	try {
		tabH = useBottomTabBarHeight();
	} catch {}
	const pageHeight = Math.max(1, Math.floor(winH - tabH - insets.bottom));

	const [currentIndex, setCurrentIndex] = useState(Math.min(Math.max(0, initialIndex), Math.max(0, items.length - 1)));

	const { selectionChanged } = useHaptics();
	const { logFrontendEvent } = useLogger();

	// --- logging: mount
	useEffect(() => {
		logFrontendEvent({
			event_name: "food_feed_mounted",
			error_level: "log",
			payload: {
				itemCount: items.length,
				initialIndex,
				hasItems: items.length > 0,
				impl: "FlatList",
			},
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [items.length, initialIndex]);

	// --- keep currentIndex in range when items change
	useEffect(() => {
		setCurrentIndex((i) => Math.min(Math.max(0, i), Math.max(0, items.length - 1)));
	}, [items.length]);

	// --- scroll to initialIndex when it changes (and list is ready)
	useEffect(() => {
		const clamped = Math.min(Math.max(0, initialIndex), Math.max(0, items.length - 1));
		if (clamped !== currentIndex) {
			setCurrentIndex(clamped);
			// scroll without animation to match initialIndex update
			requestAnimationFrame(() => {
				listRef.current?.scrollToIndex({ index: clamped, animated: false });
			});
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [initialIndex, items.length]);

	const keyExtractor = (it: DishMediaEntry) => String(it.dish_media.id);

	// FlatList が初期スクロールのために必要
	const getItemLayout = (_: ArrayLike<DishMediaEntry> | null | undefined, index: number) => ({
		length: pageHeight,
		offset: pageHeight * index,
		index,
	});

	// 表示中アイテムの検出
	const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 90 }), []);

	const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: Array<ViewToken> }) => {
		// ほぼ全画面で見えている要素を優先
		const v = viewableItems.find((v) => v.isViewable);
		if (v?.index == null) return;
		if (v.index !== currentIndex) {
			const prev = currentIndex;
			setCurrentIndex(v.index);
			onIndexChange?.(v.index);
			selectionChanged();

			// logging
			const item = items[v.index];
			logFrontendEvent({
				event_name: "food_feed_swipe",
				error_level: "log",
				payload: {
					fromIndex: prev,
					toIndex: v.index,
					direction: v.index > prev ? "down" : "up",
					currentItemId: item?.dish_media.id,
				},
			});
		}
	}).current;

	if (items.length === 0) return null;

	return (
		<FlatList
			ref={listRef}
			data={items}
			keyExtractor={keyExtractor}
			renderItem={({ item, index }) => (
				<View style={{ height: pageHeight }}>
					<FoodContentScreen item={item} />
				</View>
			)}
			style={styles.list}
			contentContainerStyle={{}}
			pagingEnabled
			// 縦方向の1ページ=画面高
			getItemLayout={getItemLayout}
			initialScrollIndex={currentIndex}
			// スクロール感
			showsVerticalScrollIndicator={false}
			decelerationRate="fast"
			// パフォーマンス
			windowSize={5}
			maxToRenderPerBatch={3}
			removeClippedSubviews
			// 表示中アイテム確定
			onViewableItemsChanged={onViewableItemsChanged}
			viewabilityConfig={viewabilityConfig}
		/>
	);
}

const styles = StyleSheet.create({
	list: {
		flex: 1,
		backgroundColor: "#000",
	},
});
