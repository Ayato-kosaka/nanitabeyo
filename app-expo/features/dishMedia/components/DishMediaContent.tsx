import React, { useState, useMemo } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import VideoPlayer from "../../../components/VideoPlayer";
import { ActionButtons } from "./ActionButtons";
import { DishReviewsSection } from "./DishReviewsSection";
import { useMediaTracking } from "../hooks/useMediaTracking";
import { getCacheKeyForImage } from "@/lib/image";
import i18n from "@/lib/i18n";
import {
	NormalizedDishMediaEntry,
	selectEntryByMediaId,
	selectEntryByReviewId,
	useDishMediaEntriesStore,
	IdType,
} from "@/stores/useDishMediaEntriesStore";
import type { MediaProcessingStatus } from "@shared/api/v1/res";

interface DishMediaContentProps {
	id: string;
	carouselRef?: React.RefObject<any>;
	isActive: boolean;
	getTitle?: (item: NormalizedDishMediaEntry) => string | null;
	sessionId: string;
	entriesKey: string;
	idType: IdType;
}

export default function DishMediaContent({
	id,
	carouselRef,
	isActive,
	getTitle = (item) => item.restaurant.name,
	sessionId,
	entriesKey,
	idType,
}: DishMediaContentProps) {
	const dishMediaEntry = useMemo(() => {
		const state = useDishMediaEntriesStore.getState(); // ← subscribe しない snapshot 読み
		const entry = idType === "dish_media" ? selectEntryByMediaId(id)(state) : selectEntryByReviewId(id)(state);
		if (!entry) throw new Error("DishMediaContent: entry is undefined");
		return entry;
	}, [id, idType]);

	const insets = useSafeAreaInsets();
	const [rightActionsWidth, setRightActionsWidth] = useState(0);

	const { handleVideoProgress, handleVideoLoop } = useMediaTracking({
		isActive,
		sessionId,
		source: entriesKey,
		dishMedia: dishMediaEntry.dish_media,
	});

	const mediaSource = useMemo(
		() => ({
			uri: dishMediaEntry.dish_media.mediaUrl ?? undefined,
			cacheKey: dishMediaEntry.dish_media.mediaUrl
				? getCacheKeyForImage(dishMediaEntry.dish_media.mediaUrl)
				: undefined,
		}),
		[dishMediaEntry.dish_media],
	);

	// #511 【設計】サムネイル画像ソースは常に用意
	const thumbnailSource = useMemo(
		() => ({
			uri: dishMediaEntry.dish_media.thumbnailImageUrl,
			cacheKey: getCacheKeyForImage(dishMediaEntry.dish_media.thumbnailImageUrl),
		}),
		[dishMediaEntry.dish_media],
	);

	// #511 【設計】動画の処理ステータスを取得
	const mediaProcessingStatus = dishMediaEntry.dish_media.media_processing_status as MediaProcessingStatus;
	const isVideo = dishMediaEntry.dish_media.media_type === "video";
	const hasVideoUrl = Boolean(dishMediaEntry.dish_media.mediaUrl);

	// #511 【設計】動画の場合、処理中/失敗時はオーバーレイを表示
	const showProcessingOverlay = isVideo && mediaProcessingStatus === "processing";
	const showErrorOverlay = isVideo && mediaProcessingStatus === "failed";

	return (
		<View style={styles.container}>
			{/* Background Media (Image or Video) */}
			{isVideo ? (
				<>
					{/* #511 【設計】動画の場合: サムネイルを常に背景として表示 */}
					<Image
						source={thumbnailSource}
						cachePolicy="memory-disk"
						transition={100}
						style={StyleSheet.absoluteFill}
						contentFit="cover"
					/>
					{/* #511 【設計】動画URLがあり、処理完了の場合のみ VideoPlayer を表示 */}
					{hasVideoUrl && !showProcessingOverlay && !showErrorOverlay && dishMediaEntry.dish_media.mediaUrl && (
						<VideoPlayer
							uri={dishMediaEntry.dish_media.mediaUrl}
							style={StyleSheet.absoluteFill}
							shouldPlay={isActive}
							onProgress={handleVideoProgress}
							onLoop={handleVideoLoop}
						/>
					)}
					{/* #511 【設計】処理中オーバーレイ */}
					{showProcessingOverlay && (
						<View style={styles.processingOverlay}>
							<ActivityIndicator size="large" color="#fff" />
							<Text style={styles.processingText}>{i18n.t("Common.processing")}</Text>
						</View>
					)}
					{/* #511 【設計】エラーオーバーレイ */}
					{showErrorOverlay && (
						<View style={styles.errorOverlay}>
							<Text style={styles.errorText}>{i18n.t("DishMediaContent.errors.videoUnavailable")}</Text>
						</View>
					)}
				</>
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
					<Text style={styles.menuName}>{getTitle(dishMediaEntry)}</Text>
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
				id={id}
				idType={idType}
				paddingRight={Math.max(16, rightActionsWidth + insets.right + 8)}
				carouselRef={carouselRef}
			/>

			{/* Action Buttons */}
			<View pointerEvents="box-none" style={styles.bottomSection}>
				<View pointerEvents="box-none" style={styles.actionRow}>
					<ActionButtons id={id} idType={idType} onLayout={(width) => setRightActionsWidth(width)} />
				</View>
			</View>
		</View>
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
	// #511 【設計】処理中オーバーレイスタイル
	processingOverlay: {
		...StyleSheet.absoluteFillObject,
		backgroundColor: "rgba(0, 0, 0, 0.6)",
		justifyContent: "center",
		alignItems: "center",
		zIndex: 5,
	},
	processingText: {
		color: "#fff",
		fontSize: 16,
		marginTop: 12,
		textShadowColor: "rgba(0, 0, 0, 0.5)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 2,
	},
	// #511 【設計】エラーオーバーレイスタイル
	errorOverlay: {
		...StyleSheet.absoluteFillObject,
		backgroundColor: "rgba(0, 0, 0, 0.6)",
		justifyContent: "center",
		alignItems: "center",
		zIndex: 5,
	},
	errorText: {
		color: "#fff",
		fontSize: 16,
		textShadowColor: "rgba(0, 0, 0, 0.5)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 2,
	},
});
