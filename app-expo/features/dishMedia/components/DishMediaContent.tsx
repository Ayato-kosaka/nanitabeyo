import React, { useState, useMemo } from "react";
import { View, Text, StyleSheet, SafeAreaView } from "react-native";
import type { DishMediaEntry } from "@shared/api/v1/res";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import VideoPlayer from "../../../components/VideoPlayer";
import { ActionButtons } from "./ActionButtons";
import { DishReviewsSection } from "./DishReviewsSection";
import { useMediaTracking } from "../hooks/useMediaTracking";
import { getCacheKeyForImage } from "@/lib/image";

interface DishMediaContentProps {
	item: DishMediaEntry;
	carouselRef?: React.RefObject<any>;
	isActive: boolean;
	getTitle?: (item: DishMediaEntry) => string | null;
	sessionId: string;
	source: string;
}

export default function DishMediaContent({
	item,
	carouselRef,
	isActive,
	getTitle = (item) => item.restaurant.name,
	sessionId,
	source,
}: DishMediaContentProps) {
	const insets = useSafeAreaInsets();
	const [rightActionsWidth, setRightActionsWidth] = useState(0);

	const { handleVideoProgress, handleVideoLoop } = useMediaTracking({
		isActive,
		sessionId,
		source,
		dishMedia: item.dish_media,
	});

	const mediaSource = useMemo(
		() => ({
			uri: item.dish_media.mediaUrl,
			cacheKey: getCacheKeyForImage(item.dish_media.mediaUrl),
		}),
		[item.dish_media],
	);

	return (
		<SafeAreaView style={styles.container}>
			{/* Background Media (Image or Video) */}
			{item.dish_media.media_type === "video" ? (
				<VideoPlayer
					uri={item.dish_media.mediaUrl}
					style={StyleSheet.absoluteFill}
					shouldPlay={isActive}
					onProgress={handleVideoProgress}
					onLoop={handleVideoLoop}
				/>
			) : (
				<Image
					source={mediaSource}
					cachePolicy="memory-disk"
					transition={100}
					style={StyleSheet.absoluteFill}
					contentFit="cover"
				/>
			)}

			{/* Top Header */}
			<View style={styles.topHeader}>
				<View style={styles.headerLeft}>
					<Text style={styles.menuName}>{getTitle(item)}</Text>
					<View style={styles.priceRatingContainer}>
						{/* <Text style={styles.price}>{i18n.t("Search.currencySuffix")}2,800</Text> */}
						{/* <View style={styles.ratingContainer}>
              {renderStars(5, 4)}
              <Text style={styles.reviewCount}>(127)</Text>
            </View> */}
					</View>
				</View>
				<View style={styles.headerRight}></View>
			</View>

			<DishReviewsSection
				reviews={item.dish_reviews}
				paddingRight={Math.max(16, rightActionsWidth + insets.right + 8)}
				carouselRef={carouselRef}
			/>

			{/* Action Buttons */}
			<View pointerEvents="box-none" style={styles.bottomSection}>
				<View pointerEvents="box-none" style={styles.actionRow}>
					<ActionButtons
						dishMedia={item.dish_media}
						restaurant={item.restaurant}
						onLayout={(width) => setRightActionsWidth(width)}
					/>
				</View>
			</View>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#000",
	},
	topHeader: {
		position: "absolute",
		top: 60,
		left: 16,
		right: 16,
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "flex-start",
		zIndex: 10,
	},
	headerLeft: {
		flex: 1,
		marginRight: 16,
	},
	headerRight: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
	},
	menuName: {
		fontSize: 28,
		fontWeight: "700",
		color: "#FFFFFF",
		textShadowColor: "rgba(0, 0, 0, 0.5)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 2,
		marginBottom: 4,
		letterSpacing: -0.5,
		lineHeight: 34,
	},
	priceRatingContainer: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
	},
	price: {
		fontSize: 20,
		fontWeight: "600",
		color: "#FFFFFF",
		textShadowColor: "rgba(0, 0, 0, 0.5)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 2,
		letterSpacing: 0.2,
	},
	ratingContainer: {
		flexDirection: "row",
		alignItems: "center",
		gap: 4,
	},
	starsContainer: {
		flexDirection: "row",
		gap: 2,
	},
	reviewCount: {
		fontSize: 16,
		color: "#FFFFFF",
		textShadowColor: "rgba(0, 0, 0, 0.5)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 2,
		fontWeight: "500",
	},
	distanceContainer: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
	},
	distance: {
		fontSize: 20,
		fontWeight: "600",
		color: "#FFFFFF",
		textShadowColor: "rgba(0, 0, 0, 0.5)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 2,
		letterSpacing: 0.2,
	},
	bottomSection: {
		position: "absolute",
		bottom: 0,
		left: 0,
		right: 0,
		paddingHorizontal: 16,
		paddingTop: 16,
		paddingBottom: 32,
	},
	actionRow: {
		flexDirection: "row",
		alignItems: "flex-end",
		justifyContent: "flex-end",
	},
});
