import React, { useEffect, useMemo, useRef, useCallback, useState, forwardRef, useImperativeHandle } from "react";
import { View, StyleSheet, Text, Dimensions, TouchableOpacity } from "react-native";
import { DetentChangeEvent, TrueSheet } from "@lodev09/react-native-true-sheet";
import Carousel, { ICarouselInstance } from "react-native-reanimated-carousel";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Image } from "expo-image";
import i18n from "@/lib/i18n";
import { getCacheKeyForImage } from "@/lib/image";
import type { QueryMeSavedRestaurantsResponse } from "@shared/api/v1/res";
import { SkeletonShimmer } from "@/components/SkeletonShimmer";
import { InteractionManager } from "react-native";
import { ScrollView } from "react-native";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const CARD_WIDTH = SCREEN_WIDTH * 0.92;
const CARD_HEIGHT = 100;

// カード 1 枚 + タイトル + ちょい余白分をスクリーン比から計算する
const CARD_AREA_HEIGHT = CARD_HEIGHT + 24; // カード + margin ちょい
const TITLE_AREA_HEIGHT = 40;
const TOP_PADDING = 12;
const BOTTOM_PADDING = 0;

// 使いたい見た目の高さ = 上マージン + タイトル + カード + 下マージン
const smallDetentHeight = TOP_PADDING + TITLE_AREA_HEIGHT + CARD_AREA_HEIGHT + BOTTOM_PADDING;

// detent に渡すのは「割合」なので 0〜1 に正規化
const SMALL_DETENT = Math.min(smallDetentHeight / SCREEN_HEIGHT, 0.5); // 上限を 0.5 にする etc.
const LARGE_DETENT = 0.7;

type SavedRestaurant = QueryMeSavedRestaurantsResponse["data"][number];

export type SavedRestaurantsSheetHandle = {
	present: () => Promise<void>;
	dismiss: () => Promise<void>;
};

export type SavedRestaurantsSheetProps = {
	visible: boolean;
	savedRestaurants: QueryMeSavedRestaurantsResponse["data"];
	isLoadingSavedRestaurants: boolean;
	activeRestaurantId: string | null;
	onRestaurantCardPress: (restaurant: SavedRestaurant) => void;
	onRestaurantReviewPress: (restaurant: SavedRestaurant) => void;
	onSnapToRestaurant?: (restaurant: SavedRestaurant) => void;
};

/**
 * SavedRestaurantsSheet
 *
 * - 表示/非表示は `visible` props をソースオブトゥルースとして管理する
 * - TrueSheet の present/dismiss は useEffect + setTimeout(0) で iOS のマウントタイミング問題を回避
 * - 画面側からは `visible` props と ref からの dismiss/present で開閉を制御する
 */
export const SavedRestaurantsSheet = forwardRef<SavedRestaurantsSheetHandle, SavedRestaurantsSheetProps>(
	function SavedRestaurantsSheetInner(props, ref) {
		const {
			visible,
			savedRestaurants,
			isLoadingSavedRestaurants,
			activeRestaurantId,
			onRestaurantCardPress,
			onRestaurantReviewPress,
			onSnapToRestaurant,
		} = props;
		const sheetRef = useRef<TrueSheet>(null);
		const carouselRef = useRef<ICarouselInstance | null>(null);
		const isDraggingRef = useRef(false);
		const draggingTimeoutRef = useRef<number | null>(null);

		// 親コンポーネントから present/dismiss を呼び出せるようにする
		useImperativeHandle(ref, () => ({
			present: async () => {
				await sheetRef.current?.present();
			},
			dismiss: async () => {
				await sheetRef.current?.dismiss();
			},
		}));

		useEffect(() => {
			// visible の変化に応じて TrueSheet を開閉
			if (!visible) {
				sheetRef.current?.dismiss();
				return;
			}

			let cancelled = false;
			let raf1: number | null = null;
			let raf2: number | null = null;
			const task = InteractionManager.runAfterInteractions(() => {
				// Android は初回レイアウトが 1 フレームじゃ足りないことがあるので rAF を二段にする
				raf1 = requestAnimationFrame(() => {
					raf2 = requestAnimationFrame(async () => {
						if (cancelled) return;
						await sheetRef.current?.present();
					});
				});
			});

			return () => {
				cancelled = true;
				task.cancel();
				if (raf1) cancelAnimationFrame(raf1);
				if (raf2) cancelAnimationFrame(raf2);
			};
		}, [visible]);

		useEffect(() => {
			return () => {
				// #644 コンポーネントアンマウント時にタイムアウトをクリーンアップ
				if (draggingTimeoutRef.current) {
					clearTimeout(draggingTimeoutRef.current);
				}
				// #644 コンポーネントアンマウント時に確実に閉じておく
				sheetRef.current?.dismiss();
			};
		}, []);

		const [detentIndex, setDetentIndex] = useState(0);

		const handleDetentChange = useCallback((event: DetentChangeEvent) => {
			setDetentIndex(event.nativeEvent.index);
		}, []);

		const activeIndex = useMemo(() => {
			return savedRestaurants.findIndex((r) => r.restaurant.id === activeRestaurantId);
		}, [savedRestaurants, activeRestaurantId]);

		useEffect(() => {
			if (activeIndex >= 0) {
				carouselRef.current?.scrollTo({ index: activeIndex, animated: true });
			}
		}, [activeIndex]);

		const renderItem = useCallback(
			({ item }: { item: SavedRestaurant }) => (
				<View style={styles.savedRestaurantItemContainer}>
					<PrimaryCard
						item={item}
						onPress={() => {
							if (isDraggingRef.current) return;
							onRestaurantCardPress(item);
						}}
						onReview={() => {
							if (isDraggingRef.current) return;
							onRestaurantReviewPress(item);
						}}
					/>
				</View>
			),
			[onRestaurantCardPress, onRestaurantReviewPress],
		);

		return (
			<TrueSheet
				ref={sheetRef}
				detents={[SMALL_DETENT, LARGE_DETENT]}
				grabber
				cornerRadius={24}
				backgroundColor="#FFFFFF"
				dismissible={false}
				dimmed={false}
				scrollable={detentIndex === 1}
				header={
					<View style={styles.header}>
						<Text style={styles.savedRestaurantsTitle}>{i18n.t("Review.selectRestaurant.savedRestaurantList")}</Text>
					</View>
				}
				onDetentChange={handleDetentChange}>
				{/* Android で gesture-handler が効かない対応 */}
				<View style={styles.container}>
					{/* #644 【UX】ローディング中はスケルトンを表示 */}
					{isLoadingSavedRestaurants && savedRestaurants.length === 0 ? (
						<>
							{detentIndex === 0 ? (
								// カルーセル表示時のスケルトン（2-3件）
								<View style={styles.carouselWrapper}>
									<View style={styles.savedRestaurantItemContainer}>
										<SkeletonCard />
									</View>
								</View>
							) : (
								// リスト表示時のスケルトン（3-5件）
								<View style={styles.listContent}>
									{[1, 2, 3, 4, 5].map((key) => (
										<View key={key} style={styles.listItemContainer}>
											<SkeletonCard />
										</View>
									))}
								</View>
							)}
						</>
					) : savedRestaurants.length > 0 ? (
						<>
							{detentIndex === 0 ? (
								<View style={styles.carouselWrapper}>
									<Carousel<SavedRestaurant>
										ref={carouselRef}
										data={savedRestaurants}
										loop={false}
										style={styles.carousel}
										width={SCREEN_WIDTH}
										height={CARD_HEIGHT + 24}
										pagingEnabled={false}
										snapEnabled
										maxScrollDistancePerSwipe={CARD_WIDTH + 40}
										mode="parallax"
										modeConfig={{
											parallaxScrollingScale: 1,
											parallaxAdjacentItemScale: 1,
											parallaxScrollingOffset: ((SCREEN_WIDTH - CARD_WIDTH) * 3) / 4,
										}}
										onScrollStart={() => {
											isDraggingRef.current = true;
											// #644 【バグ】タイムアウトフォールバックを追加して isDraggingRef が true のまま固まるのを防ぐ
											if (draggingTimeoutRef.current) {
												clearTimeout(draggingTimeoutRef.current);
											}
											draggingTimeoutRef.current = setTimeout(() => {
												isDraggingRef.current = false;
											}, 500);
										}}
										onScrollEnd={() => {
											isDraggingRef.current = false;
											if (draggingTimeoutRef.current) {
												clearTimeout(draggingTimeoutRef.current);
												draggingTimeoutRef.current = null;
											}
										}}
										onSnapToItem={(index) => {
											isDraggingRef.current = false;
											if (draggingTimeoutRef.current) {
												clearTimeout(draggingTimeoutRef.current);
												draggingTimeoutRef.current = null;
											}
											const restaurant = savedRestaurants[index];
											if (restaurant) onSnapToRestaurant?.(restaurant);
										}}
										scrollAnimationDuration={350}
										renderItem={renderItem}
									/>
								</View>
							) : (
								// TrueSheet のドラッグ（パン）ジェスチャが勝ってしまって、FlatList のスクロールが途中で奪われるため、
								// ScrollView を利用する。保存店が limit:20 なので、パフォーマンス的にも問題ないはず。
								<ScrollView
									contentContainerStyle={styles.listContent}
									showsVerticalScrollIndicator={false}
									nestedScrollEnabled>
									{savedRestaurants.map((item) => (
										<View key={item.restaurant.id} style={styles.listItemContainer}>
											<PrimaryCard
												item={item}
												onPress={() => onRestaurantCardPress(item)}
												onReview={() => onRestaurantReviewPress(item)}
											/>
										</View>
									))}
									<View style={{ height: 60 }} />
								</ScrollView>
							)}
						</>
					) : (
						// 空状態（ローディング完了後、データなし）
						<Text style={styles.emptyStateText}>{i18n.t("Review.selectRestaurant.noSavedRestaurantsInArea")}</Text>
					)}
				</View>
			</TrueSheet>
		);
	},
);

function PrimaryCard({
	item,
	onPress,
	onReview,
}: {
	item: SavedRestaurant;
	onPress: () => void;
	onReview: () => void;
}) {
	return (
		<TouchableOpacity style={styles.savedRestaurantCard} activeOpacity={0.7} onPress={onPress}>
			<Image
				source={{
					uri: item.restaurant.imageUrls?.md,
					cacheKey: getCacheKeyForImage(item.restaurant.imageUrls?.md),
				}}
				style={styles.savedRestaurantImage}
			/>
			<View style={styles.savedRestaurantInfo}>
				<Text style={styles.savedRestaurantName} numberOfLines={1} ellipsizeMode="tail">
					{item.restaurant.name}
				</Text>
				<PrimaryButton
					onPress={onReview}
					label={i18n.t("Review.selectRestaurant.postPhotoVideo")}
					colors={["#F05537", "#F05537"]}
					shadowColor={"transparent"}
					labelStyle={{ color: "#FFF", fontSize: 12 }}
					style={{ alignSelf: "flex-end" }}
				/>
			</View>
		</TouchableOpacity>
	);
}

// #644 【UX】ローディングスケルトンカードコンポーネント
function SkeletonCard() {
	return (
		<View style={styles.savedRestaurantCard}>
			{/* 画像エリア */}
			<SkeletonShimmer width={100} height={CARD_HEIGHT} style={styles.savedRestaurantImage} />
			{/* テキスト部分 */}
			<View style={styles.savedRestaurantInfo}>
				{/* 店名エリア（2行分） */}
				<View>
					<SkeletonShimmer width="80%" height={16} borderRadius={4} style={{ marginBottom: 8 }} />
					<SkeletonShimmer width="60%" height={16} borderRadius={4} />
				</View>
				{/* ボタンエリア */}
				<SkeletonShimmer width={120} height={32} borderRadius={8} style={{ alignSelf: "flex-end" }} />
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		paddingTop: 12,
		paddingBottom: 20,
	},
	header: {
		paddingHorizontal: 16,
		marginVertical: 8,
	},
	savedRestaurantsTitle: {
		fontSize: 14,
		fontWeight: "600",
		color: "#666",
	},
	carouselWrapper: {
		width: SCREEN_WIDTH,
		alignItems: "center",
		paddingVertical: 4,
		alignSelf: "center",
	},
	carousel: {
		width: SCREEN_WIDTH,
		height: CARD_HEIGHT + 24,
	},
	savedRestaurantItemContainer: {
		width: CARD_WIDTH,
		height: CARD_HEIGHT,
		marginHorizontal: (SCREEN_WIDTH - CARD_WIDTH) / 2,
		marginVertical: 12,
	},
	listContent: {
		position: "relative",
		top: 0,
		alignItems: "center",
		paddingVertical: 8,
		paddingBottom: 40,
	},
	listItemContainer: {
		width: CARD_WIDTH,
		marginBottom: 12,
	},
	savedRestaurantCard: {
		flex: 1,
		flexDirection: "row",
		backgroundColor: "#FFF",
		borderRadius: 12,
		height: CARD_HEIGHT,
		shadowColor: "#000000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.2,
		shadowRadius: 8,
		elevation: 5,
	},
	savedRestaurantImage: {
		width: 100,
		height: CARD_HEIGHT,
		borderTopLeftRadius: 12,
		borderBottomLeftRadius: 12,
	},
	savedRestaurantInfo: {
		flex: 1,
		padding: 12,
		justifyContent: "space-between",
	},
	savedRestaurantName: {
		fontSize: 16,
		fontWeight: "600",
		color: "#1A1A1A",
		marginBottom: 8,
	},
	emptyStateText: {
		fontSize: 14,
		color: "#666",
		textAlign: "center",
		marginTop: 8,
		marginBottom: 16,
	},
});
