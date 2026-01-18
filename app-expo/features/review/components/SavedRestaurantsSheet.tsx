import React, { useEffect, useMemo, useRef, useCallback, useState, forwardRef, useImperativeHandle } from "react";
import { View, StyleSheet, Text, Dimensions, TouchableOpacity } from "react-native";
import { DetentChangeEvent, TrueSheet } from "@lodev09/react-native-true-sheet";
import Carousel, { ICarouselInstance } from "react-native-reanimated-carousel";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Image } from "expo-image";
import i18n from "@/lib/i18n";
import { getCacheKeyForImage } from "@/lib/image";
import type { QueryMeSavedRestaurantsResponse } from "@shared/api/v1/res";
import { FlatList } from "react-native";
import { SkeletonShimmer } from "@/components/SkeletonShimmer";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CARD_WIDTH = SCREEN_WIDTH * 0.92;
const CARD_HEIGHT = 100;

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

			// ★ iOS 対策：マウント完了後に present() する
			const timeoutId = setTimeout(() => {
				sheetRef.current?.present();
			}, 0);

			return () => clearTimeout(timeoutId);
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
				detents={["auto", 0.9]}
				grabber
				cornerRadius={24}
				maxHeight={560}
				backgroundColor="#FFFFFF"
				dimmed={false}
				dismissible={false}
				onDetentChange={handleDetentChange}>
				<View style={styles.container}>
					{/* #644 【UX】ローディング中はスケルトンを表示 */}
					{isLoadingSavedRestaurants && savedRestaurants.length === 0 ? (
						<>
							<Text style={styles.savedRestaurantsTitle}>{i18n.t("Review.selectRestaurant.savedRestaurantList")}</Text>
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
							<Text style={styles.savedRestaurantsTitle}>{i18n.t("Review.selectRestaurant.savedRestaurantList")}</Text>

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
								<View style={{ flex: 1 }}>
									<FlatList
										data={savedRestaurants}
										keyExtractor={(item) => item.restaurant.id}
										contentContainerStyle={styles.listContent}
										nestedScrollEnabled // Android でのネストスクロール用
										renderItem={({ item }) => (
											<View style={styles.listItemContainer}>
												<PrimaryCard
													item={item}
													onPress={() => onRestaurantCardPress(item)}
													onReview={() => onRestaurantReviewPress(item)}
												/>
											</View>
										)}
										scrollEnabled
										showsVerticalScrollIndicator={false}
									/>
								</View>
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
				<Text style={styles.savedRestaurantName} numberOfLines={2}>
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
			<SkeletonShimmer width={100} height={CARD_HEIGHT} borderRadius={0} />
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
		paddingTop: 12,
		paddingBottom: 20,
	},
	savedRestaurantsTitle: {
		fontSize: 14,
		fontWeight: "600",
		color: "#666",
		paddingHorizontal: 16,
		marginBottom: 8,
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
		overflow: "hidden",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.2,
		shadowRadius: 8,
		elevation: 5,
	},
	savedRestaurantImage: {
		width: 100,
		height: CARD_HEIGHT,
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
