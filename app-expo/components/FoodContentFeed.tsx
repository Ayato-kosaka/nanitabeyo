// このコンポーネントは、縦方向の全画面ページングで DishMediaEntry を表示するフィードです。
// 設計思想：
// - 1ページ = 画面の高さ（SafeArea等を含む実測値）で固定し、各セルは高さ pageHeight に揃える
// - 初期表示位置は initialIndex を採用。ただしレイアウト確定前は失敗し得るため、保険として contentOffset も併用
// - 現在の表示インデックスは FlatList の viewability（itemVisiblePercentThreshold=90%）で決定
// - レイアウト計測（onLayout）が発火して pageHeight が確定した後に初期スクロール/再配置を行う
// 責務分離：
// - 高さ計測: <View onLayout> -> pageHeight（state）
// - スクロール命令: listRef.scrollToIndex / contentOffset（初回のみ）
// - 表示中インデックス管理: currentIndex（state） + currentIndexRef（最新値ミラー）
// - 副作用（ログ/ハプティクス/analytics）: onViewableItemsChanged 内でのみ実行

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { StyleSheet, FlatList, ViewToken, View, ListRenderItemInfo } from "react-native";
import FoodContentScreen from "./FoodContentScreen";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import type { DishMediaEntry } from "@shared/api/v1/res";

// --- ユーティリティ群（純粋関数） ------------------------------------------
// インデックスを items.length の範囲内にクランプ
const clampIndex = (index: number, length: number) => Math.min(Math.max(0, index), Math.max(0, length - 1));

// --- Props -------------------------------------------------------------------
interface FoodContentFeedProps {
	// 表示対象のメディア配列
	items: DishMediaEntry[];
	// 初期表示インデックス（範囲外はクランプ）
	initialIndex?: number;
	// 表示中インデックスが変化した際のコールバック
	onIndexChange?: (index: number) => void;
}

// --- 本体 --------------------------------------------------------------------
export default function FoodContentFeed({ items, initialIndex = 0, onIndexChange }: FoodContentFeedProps) {
	// 命令的スクロール用の List 参照
	const listRef = useRef<FlatList<DishMediaEntry>>(null);

	// 実レイアウト高（SafeArea等込み）: onLayout で初回確定
	const [pageHeight, setPageHeight] = useState(0);

	// initialIndex を常に範囲内へ
	const clampedInitialIndex = useMemo(() => clampIndex(initialIndex, items.length), [initialIndex, items.length]);

	// contentOffset を「初回マウント時のみ」適用するためのフラグ
	const didSetInitialOffset = useRef(false);

	// 現在の表示インデックス（状態）＋最新値ミラー用Ref（Viewabilityコールバックで参照）
	const [currentIndex, setCurrentIndex] = useState(clampIndex(initialIndex, items.length));
	const currentIndexRef = useRef(currentIndex);
	useEffect(() => {
		currentIndexRef.current = currentIndex;
	}, [currentIndex]);

	// items の参照も最新をミラー（onViewableItemsChanged内で安定参照するため）
	const itemsRef = useRef(items);
	useEffect(() => {
		itemsRef.current = items;
	}, [items]);

	// 付随機能（ハプティクス・ログ）
	const { selectionChanged } = useHaptics();
	const { logFrontendEvent } = useLogger();

	// --- ライフサイクルログ（初回） ------------------------------
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
	}, []);

	// --- レイアウト確定後の初期再配置（既存ロジックを変更しない） ------------
	useEffect(() => {
		if (pageHeight <= 0 || items.length === 0) return;

		const clamped = clampIndex(initialIndex, items.length);

		if (clamped !== currentIndex) {
			setCurrentIndex(clamped);
		}

		// レイアウト確定後の scrollToIndex（rAFは既存のタイミング踏襲）
		requestAnimationFrame(() => {
			listRef.current?.scrollToIndex({
				index: clamped,
				animated: false,
			});
		});
	}, [items.length, initialIndex, pageHeight]);

	// --- keyExtractor（安定参照） ---------------------------------------------
	const keyExtractor = useCallback((it: DishMediaEntry) => String(it.dish_media.id), []);

	// --- getItemLayout（高さ=画面高を提供; 初期スクロール安定化の要） --------
	const getItemLayout = useMemo(
		() => (_: ArrayLike<DishMediaEntry> | null | undefined, index: number) => ({
			length: pageHeight ?? 0,
			offset: (pageHeight ?? 0) * index,
			index,
		}),
		[pageHeight],
	);

	// --- viewability 閾値（90%以上を“表示中”とみなす） -----------------------
	const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 90 }), []);

	// --- onViewableItemsChanged（公式推奨：useRef直渡し） ----------------------
	// 責務: 表示中インデックスの同定・副作用（ハプティクス/ログ/通知）
	const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: Array<ViewToken> }) => {
		const v = viewableItems.find((t) => t.isViewable);
		if (v?.index == null) return;

		const prev = currentIndexRef.current;
		if (v.index === prev) return;

		// 状態更新
		setCurrentIndex(v.index);
		// 外部通知
		onIndexChange?.(v.index);
		// 触覚フィードバック
		selectionChanged();

		// ログ出力（items は ref 経由で最新を参照）
		const item = itemsRef.current[v.index];
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
	}).current;

	// --- renderItem（再レンダを抑制：pageHeight にのみ依存） -------------------
	const renderItem = useCallback(
		({ item }: ListRenderItemInfo<DishMediaEntry>) => (
			// 各ページは厳密に画面高に合わせる
			<View style={{ height: Math.max(1, pageHeight) }}>
				<FoodContentScreen item={item} />
			</View>
		),
		[pageHeight],
	);

	// --- 早期リターン：空リスト ----------------------------------------------
	if (items.length === 0) return null;

	return (
		<View
			style={styles.root}
			// ここで SafeArea 等込みの実レイアウト高を取得し pageHeight に反映
			onLayout={(e) => {
				const h = Math.max(1, Math.floor(e.nativeEvent.layout.height));
				if (h !== pageHeight) setPageHeight(h);
			}}>
			{/* pageHeight が確定するまでは描画を遅延（初期スクロール不発を防止） */}
			{pageHeight > 0 && (
				<FlatList
					ref={listRef}
					data={items}
					keyExtractor={keyExtractor}
					renderItem={renderItem}
					style={styles.list}
					// ページング：1画面=1ページ
					pagingEnabled
					// 既存方針：initialScrollIndex はレイアウト後の scrollToIndex と併用
					initialScrollIndex={clampedInitialIndex}
					// 初回マウントのみ contentOffset も併用（保険）。既存の意図を保持。
					contentOffset={!didSetInitialOffset.current ? { x: 0, y: clampedInitialIndex * pageHeight } : undefined}
					onLayout={() => {
						// contentOffset は初回マウントフレームのみ適用
						if (!didSetInitialOffset.current) didSetInitialOffset.current = true;
					}}
					// 初期スクロール安定化（高さが一定である前提）
					getItemLayout={getItemLayout}
					// 視覚ノイズの低減
					showsVerticalScrollIndicator={false}
					// ページング感の強化
					decelerationRate="fast"
					// パフォーマンス調整（既存値を踏襲）
					windowSize={5}
					maxToRenderPerBatch={3}
					// 表示中確定ハンドラ（関数インスタンスは固定）
					onViewableItemsChanged={onViewableItemsChanged}
					// 失敗時の再試行（既存挙動を保持）
					onScrollToIndexFailed={({ index, highestMeasuredFrameIndex, averageItemLength }) => {
						setTimeout(() => {
							listRef.current?.scrollToIndex({ index, animated: false });
						}, 250);
					}}
					// 可視閾値 = 90%
					viewabilityConfig={viewabilityConfig}
				/>
			)}
		</View>
	);
}

// --- Styles ------------------------------------------------------------------
const styles = StyleSheet.create({
	// ルートは常に黒背景（SafeAreaや余白での色抜け防止）
	root: {
		flex: 1,
		backgroundColor: "#000",
	},
	list: {
		flex: 1,
		backgroundColor: "#000", // メディアを引き立てる黒背景
	},
});
