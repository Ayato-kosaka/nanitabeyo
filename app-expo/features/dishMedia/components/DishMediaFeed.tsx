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
import DishMediaContent from "./DishMediaContent";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { generateUUID } from "@/lib/uuid";
import {
	DishMediaEntriesStore,
	NormalizedDishMediaEntry,
	selectIdsByKey,
	useDishMediaEntriesStore,
	IdType,
} from "@/stores/useDishMediaEntriesStore";
import { shallow } from "zustand/shallow";
import { Text } from "react-native";
import i18n from "@/lib/i18n";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { useDishMediaBackgroundImageResources } from "@/features/dishMedia/hooks/useDishMediaBackgroundImageResources";

// --- ユーティリティ群（純粋関数） ------------------------------------------
// インデックスを items.length の範囲内にクランプ
const clampIndex = (index: number, length: number) => Math.min(Math.max(0, index), Math.max(0, length - 1));

// --- Props -------------------------------------------------------------------
interface DishMediaFeedProps {
	// 初期表示インデックス（範囲外はクランプ）
	initialIndex?: number;
	// 表示中インデックスが変化した際のコールバック
	onIndexChange?: (index: number) => void;
	// 各アイテムのタイトル取得関数
	getTitle?: (item: NormalizedDishMediaEntry) => string | null;
	// 呼び出し元コンテキスト（画面用途キー）
	entriesKey: string;
	// ID の種類（dish_media / dish_reviews）
	idType: IdType;
}

// --- 本体 --------------------------------------------------------------------
export default function DishMediaFeed({
	initialIndex = 0,
	onIndexChange,
	getTitle,
	entriesKey,
	idType,
}: DishMediaFeedProps) {
	const selector = useCallback(
		(state: DishMediaEntriesStore) => selectIdsByKey(entriesKey, idType)(state),
		[entriesKey, idType],
	);
	const { ids: liveIds, isLoading, error } = useDishMediaEntriesStore(selector, shallow);

	// 画面を開いた時点の並びを固定するための state
	// liked/unlike 等のリアルタイム反映は行わない
	const [ids, setIds] = useState<string[]>([]);
	useEffect(() => {
		if (ids.length === 0 && liveIds.length > 0) setIds(liveIds);
	}, [liveIds, ids.length]);

	// #802 【責務分離】Feed は ids とページング制御だけを担い、背景画像 preload の最小購読は hook に閉じる。
	const backgroundImagesSessionKey = useMemo(() => `${entriesKey}::${idType}::${ids.join(",")}`, [entriesKey, idType, ids]);
	// TODO(#802): 現在は ids 全件を background image preload 対象にしている。
	// Android では Google Place photo の大きい画像を複数同時に取得すると Glide 側で timeout することがある。
	// 根本対応としては currentIndex 周辺の数件だけを preload する方式を検討する。
	const { getBackgroundImageState } = useDishMediaBackgroundImageResources({
		ids,
		idType,
		sessionKey: backgroundImagesSessionKey,
	});

	// 命令的スクロール用の List 参照
	const listRef = useRef<FlatList<string>>(null);

	// 実レイアウト高（SafeArea等込み）: onLayout で初回確定
	const [pageHeight, setPageHeight] = useState(0);

	// initialIndex を常に範囲内へ
	const clampedInitialIndex = useMemo(() => clampIndex(initialIndex, ids.length), [initialIndex, ids.length]);

	// 現在の表示インデックス（状態）＋最新値ミラー用Ref（Viewabilityコールバックで参照）
	const [currentIndex, setCurrentIndex] = useState(clampIndex(initialIndex, ids.length));
	const currentIndexRef = useRef(currentIndex);
	useEffect(() => {
		currentIndexRef.current = currentIndex;
	}, [currentIndex]);

	// items の参照も最新をミラー（onViewableItemsChanged内で安定参照するため）
	const itemsRef = useRef(ids);
	useEffect(() => {
		itemsRef.current = ids;
	}, [ids]);

	// 付随機能（ハプティクス・ログ）
	const { selectionChanged } = useHaptics();
	const { logFrontendEvent } = useLogger();

	// 一意なセッションID（DishMediaContent へ伝搬）
	const sessionId = useRef(generateUUID());

	// --- ライフサイクルログ（初回） ------------------------------
	useEffect(() => {
		logFrontendEvent({
			event_name: "food_feed_mounted",
			error_level: "log",
			payload: {
				itemCount: ids.length,
				initialIndex,
				hasItems: ids.length > 0,
				impl: "FlatList",
			},
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// --- getItemLayout（高さ=画面高を提供; 初期スクロール安定化の要） --------
	const getItemLayout = useMemo(
		() => (_: ArrayLike<string> | null | undefined, index: number) => ({
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
				currentItemId: item,
			},
		});
	}).current;

	// --- renderItem（再レンダを抑制：pageHeight にのみ依存） -------------------
	const renderItem = useCallback(
		({ item, index }: ListRenderItemInfo<string>) => (
			// 各ページは厳密に画面高に合わせる
			<View style={{ height: Math.max(1, pageHeight) }}>
				<DishMediaContent
					id={item}
					isActive={index === currentIndex}
					getTitle={getTitle}
					sessionId={sessionId.current}
					entriesKey={entriesKey}
					idType={idType}
					backgroundImageState={getBackgroundImageState(item)}
				/>
			</View>
		),
		[pageHeight, currentIndex, getTitle, entriesKey, idType, getBackgroundImageState],
	);

	return (
		<View
			style={styles.root}
			// ここで SafeArea 等込みの実レイアウト高を取得し pageHeight に反映
			onLayout={(e) => {
				const h = Math.max(1, Math.floor(e.nativeEvent.layout.height));
				if (h !== pageHeight) setPageHeight(h);
			}}>
			{/* pageHeight が確定するまでは描画を遅延（初期スクロール不発を防止） */}
			{pageHeight > 0 ? (
				!!isLoading ? (
					<View style={styles.centerContainer}>
						<LoadingIndicator size="large" />
						<Text style={styles.loadingText}>{i18n.t("Profile.loading")}</Text>
					</View>
				) : !!error ? (
					<View style={styles.centerContainer}>
						<Text style={styles.errorText}>{error}</Text>
					</View>
				) : ids.length > 0 ? (
					<FlatList
						// pageHeight が変わったときはリマウントさせたいため key を付ける
						key={`${entriesKey}-${pageHeight}`}
						ref={listRef}
						data={ids}
						renderItem={renderItem}
						keyExtractor={(id) => id}
						style={styles.list}
						// ページング：1画面=1ページ
						pagingEnabled
						// 既存方針：initialScrollIndex はレイアウト後の scrollToIndex と併用
						initialScrollIndex={clampedInitialIndex}
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
				) : null
			) : null}
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
	centerContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		backgroundColor: "#000",
	},
	loadingText: {
		marginTop: 16,
		color: "#FFF",
		fontSize: 16,
	},
	errorText: {
		color: "#FF6B6B",
		fontSize: 16,
		textAlign: "center",
		paddingHorizontal: 20,
	},
});
