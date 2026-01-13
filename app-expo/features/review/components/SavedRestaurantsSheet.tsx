import React, { useEffect, useMemo, useRef, useCallback, useState } from "react";
import { View, StyleSheet, Text, Dimensions, TouchableOpacity } from "react-native";
import { DetentChangeEvent, TrueSheet } from "@lodev09/react-native-true-sheet";
import Carousel, { ICarouselInstance } from "react-native-reanimated-carousel";
import { PrimaryButton } from "@/components/PrimaryButton";
import { RotateCw } from "lucide-react-native";
import { Image } from "expo-image";
import i18n from "@/lib/i18n";
import { getCacheKeyForImage } from "@/lib/image";
import type { QueryMeSavedRestaurantsResponse } from "@shared/api/v1/res";
import { FlatList } from "react-native";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CARD_WIDTH = SCREEN_WIDTH * 0.92;
const CARD_HEIGHT = 100;

type SavedRestaurant = QueryMeSavedRestaurantsResponse["data"][number];

export type SavedRestaurantsSheetProps = {
	savedRestaurants: QueryMeSavedRestaurantsResponse["data"];
	isLoadingSavedRestaurants: boolean;
	activeRestaurantId: string | null;
	onSearchThisArea: () => void;
	onRestaurantCardPress: (restaurant: SavedRestaurant) => void;
	onRestaurantReviewPress: (restaurant: SavedRestaurant) => void;
	onSnapToRestaurant?: (restaurant: SavedRestaurant) => void;
};

export function SavedRestaurantsSheet({
	savedRestaurants,
	isLoadingSavedRestaurants,
	activeRestaurantId,
	onSearchThisArea,
	onRestaurantCardPress,
	onRestaurantReviewPress,
	onSnapToRestaurant,
}: SavedRestaurantsSheetProps) {
	const sheetRef = useRef<TrueSheet>(null);
	const carouselRef = useRef<ICarouselInstance | null>(null);

	useEffect(() => {
		sheetRef.current?.present();
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
					onPress={() => onRestaurantCardPress(item)}
					onReview={() => onRestaurantReviewPress(item)}
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
			dimmed={false}
			backgroundColor="#FFFFFF"
			dismissible={false}
			onDetentChange={handleDetentChange}>
			<View style={styles.container}>
				<View style={styles.searchButtonContainer}>
					<PrimaryButton
						onPress={onSearchThisArea}
						label={i18n.t("Review.selectRestaurant.searchThisArea")}
						icon={<RotateCw size={16} color="#357AFF" />}
						colors={["#ffffff", "#ffffff"]}
						shadowColor={"#000000"}
						labelStyle={{ color: "#357AFF", fontSize: 14 }}
						loading={isLoadingSavedRestaurants}
					/>
				</View>

				{savedRestaurants.length > 0 ? (
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
									onSnapToItem={(index) => {
										const restaurant = savedRestaurants[index];
										if (restaurant) onSnapToRestaurant?.(restaurant);
									}}
									scrollAnimationDuration={350}
									renderItem={renderItem}
								/>
							</View>
						) : (
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
							/>
						)}
					</>
				) : !isLoadingSavedRestaurants ? (
					<Text style={styles.emptyStateText}>{i18n.t("Review.selectRestaurant.noSavedRestaurantsInArea")}</Text>
				) : null}
			</View>
		</TrueSheet>
	);
}

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
					colors={["#5EA2FF", "#5EA2FF"]}
					labelStyle={{ color: "#FFF", fontSize: 12 }}
					style={{ alignSelf: "flex-end" }}
				/>
			</View>
		</TouchableOpacity>
	);
}

const styles = StyleSheet.create({
	container: {
		paddingTop: 12,
		paddingHorizontal: 16,
		paddingBottom: 20,
	},
	searchButtonContainer: {
		alignItems: "center",
		marginBottom: 12,
	},
	savedRestaurantsTitle: {
		fontSize: 14,
		fontWeight: "600",
		color: "#666",
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
		paddingBottom: 16,
	},
	listItemContainer: {
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
