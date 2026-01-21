import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
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
import type { MediaProcessingStatus, QueryDishMediaByIdsResponse } from "@shared/api/v1/res";
import { useAPICall } from "@/hooks/useAPICall";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { SkeletonShimmer } from "@/components/SkeletonShimmer";
import { useLogger } from "@/hooks/useLogger";
import { useImageLoadWithRetry } from "@/hooks/useImageLoadWithRetry";

interface DishMediaContentProps {
	id: string;
	carouselRef?: React.RefObject<any>;
	isActive: boolean;
	getTitle?: (item: NormalizedDishMediaEntry) => string | null;
	sessionId: string;
	entriesKey: string;
	idType: IdType;
	onCardPress?: (entry: NormalizedDishMediaEntry) => void;
	displayIndex?: number;
}

export default function DishMediaContent({
	id,
	carouselRef,
	isActive,
	getTitle = (item) => item.restaurant.name,
	sessionId,
	entriesKey,
	idType,
	onCardPress, // #613 【設計】カード押下時のコールバック
	displayIndex,
}: DishMediaContentProps) {
	// #530 【設計】dishMediaEntry を useState で管理し、ポーリング結果を反映できるようにする
	const [dishMediaEntry, setDishMediaEntry] = useState<NormalizedDishMediaEntry>(() => {
		const state = useDishMediaEntriesStore.getState(); // ← subscribe しない snapshot 読み
		const entry = idType === "dish_media" ? selectEntryByMediaId(id)(state) : selectEntryByReviewId(id)(state);
		if (!entry) throw new Error("DishMediaContent: entry is undefined");
		return entry;
	});

	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const insets = useSafeAreaInsets();
	const [rightActionsWidth, setRightActionsWidth] = useState(0);

	const { handleVideoProgress, handleVideoLoop } = useMediaTracking({
		isActive,
		sessionId,
		source: entriesKey,
		dishMedia: dishMediaEntry.dish_media,
	});

	// #530 【設計】処理ステータスをメディア共通で扱う（動画/画像共通）
	const mediaProcessingStatus = dishMediaEntry.dish_media.media_processing_status as MediaProcessingStatus;
	const isProcessing = mediaProcessingStatus === "processing";
	const isFailed = mediaProcessingStatus === "failed";
	const isVideo = dishMediaEntry.dish_media.media_type === "video";
	const hasMediaUrl = Boolean(dishMediaEntry.dish_media.mediaUrl);

	// #630 【設計】背景画像として使用する URI を統一（動画/画像で分岐）
	const bgUri = useMemo(() => {
		if (isVideo) {
			// #630 動画の場合: 常に thumbnail を背景として使用
			return dishMediaEntry.dish_media.thumbnailImageUrl;
		} else {
			// #630 画像の場合: mediaUrl があれば使用、なければ thumbnail
			return dishMediaEntry.dish_media.mediaUrl ?? dishMediaEntry.dish_media.thumbnailImageUrl;
		}
	}, [isVideo, dishMediaEntry.dish_media.mediaUrl, dishMediaEntry.dish_media.thumbnailImageUrl]);

	// #630 【設計】防御的プログラミング: bgUri が undefined の場合に警告
	useEffect(() => {
		if (!bgUri) {
			console.warn("[DishMediaContent] bgUri is undefined", {
				mediaId: dishMediaEntry.dish_media.id,
				mediaType: dishMediaEntry.dish_media.media_type,
				hasMediaUrl: Boolean(dishMediaEntry.dish_media.mediaUrl),
				hasThumbnail: Boolean(dishMediaEntry.dish_media.thumbnailImageUrl),
			});
		}
	}, [bgUri]); // #630 bgUri 変更時のみチェック（他の値はログ用コンテキストのみ）

	// #630 【設計】背景画像のロード状態管理（薄い共通化）
	const {
		uri: bgUriWithBuster,
		loadState: bgLoadState,
		handlers: bgLoadHandlers,
	} = useImageLoadWithRetry({
		uri: bgUri,
		cacheBustingKey: dishMediaEntry.dish_media.id,
		enableAutoRetry: true,
		onErrorCountChange: (count) => {
			logFrontendEvent({
				event_name: "dish_media_background_image_load_error",
				error_level: "log",
				payload: {
					media_id: dishMediaEntry.dish_media.id,
					media_type: dishMediaEntry.dish_media.media_type,
					bg_uri: bgUri,
					error_count: count,
				},
			});
		},
		onGiveUp: (count) => {
			logFrontendEvent({
				event_name: "dish_media_background_image_load_error",
				error_level: "error",
				payload: {
					media_id: dishMediaEntry.dish_media.id,
					media_type: dishMediaEntry.dish_media.media_type,
					bg_uri: bgUri,
					error_count: count,
				},
			});
		},
	});

	// #630 【設計】背景画像ソース（ロードハンドラと連動）
	const bgSource = useMemo(
		() => ({
			uri: bgUriWithBuster,
			cacheKey: getCacheKeyForImage(bgUriWithBuster ?? bgUri),
		}),
		[bgUri, bgUriWithBuster],
	);

	// 【設計】メディア処理状況のポーリング
	useEffect(() => {
		const mediaId = dishMediaEntry.dish_media.id;
		const shouldPoll =
			isActive &&
			dishMediaEntry.dish_media.media_processing_status === "processing" &&
			!dishMediaEntry.dish_media.mediaUrl;

		if (!shouldPoll) return;

		let cancelled = false;
		const INTERVAL = 3000; // 3秒

		let timeoutId: ReturnType<typeof setTimeout> | null = null;

		const poll = async () => {
			if (cancelled) return;

			try {
				const res = await callBackend<{ ids: string[] }, QueryDishMediaByIdsResponse>("v1/dish-media", {
					method: "GET",
					requestPayload: { ids: [mediaId] },
				});

				const updated = res.items[0];
				if (!updated) {
					// アイテムが見つからない場合はポーリング終了
					return;
				}

				// Zustand store 更新
				useDishMediaEntriesStore.getState().upsertDishMediaEntries([updated]);

				if (cancelled) return;

				// ローカル state 更新（構造に応じてマージ）
				setDishMediaEntry((prev) => ({
					...prev,
					dish_media: {
						...prev.dish_media,
						...updated.dish_media,
					},
				}));

				const status = updated.dish_media.media_processing_status;
				const hasUrl = Boolean(updated.dish_media.mediaUrl);
				if ((status === "completed" && hasUrl) || status === "failed") return;
			} catch (e) {
				console.error(e);
				// エラー時はポーリング終了（無限ポーリング防止）
				return;
			}

			if (!cancelled) timeoutId = setTimeout(poll, INTERVAL);
		};

		poll();

		return () => {
			cancelled = true;
			if (timeoutId !== null) clearTimeout(timeoutId);
		};
	}, [
		isActive,
		callBackend,
		dishMediaEntry.dish_media.id,
		dishMediaEntry.dish_media.media_processing_status,
		dishMediaEntry.dish_media.mediaUrl,
	]);

	// #630 【UX】スケルトン表示条件（可読性向上のため派生状態として定義）
	const shouldShowSkeleton = bgLoadState === "loading" && !isFailed && !isProcessing;

	// #613 TapGesture 用の pressed state
	const pressed = useSharedValue(0);
	const pressStyle = useAnimatedStyle(() => ({
		opacity: withTiming(pressed.value ? 0.95 : 1, { duration: 80 }),
	}));

	const buttonsGesture = useMemo(
		() =>
			Gesture.Tap()
				.maxDistance(9999) // 指が多少動いても成立
				.onBegin(() => {
					// 何もしなくてOK。成立させるのが目的。
				}),
		[],
	);
	const tapGesture = useMemo(() => {
		return (
			Gesture.Tap()
				// #611 横スワイプと競合しないように maxDistance を設定
				.maxDistance(10)
				// #694 【設計】ボタン操作中は親Tapを失敗させる（縁タップ誤発火防止）
				.requireExternalGestureToFail(buttonsGesture)
				.onBegin(() => {
					if (onCardPress) pressed.value = 1;
				})
				.onFinalize(() => {
					pressed.value = 0;
				})
				.onEnd(() => {
					if (!onCardPress) return;
					// dishMediaEntry をJS側に渡して ActionSheet を開く
					runOnJS(onCardPress)(dishMediaEntry);
				})
		);
	}, [onCardPress, dishMediaEntry, pressed, buttonsGesture]);

	return (
		<View style={styles.container}>
			<GestureDetector gesture={tapGesture}>
				<Animated.View style={[StyleSheet.absoluteFill, pressStyle]}>
					{/* #630 【設計】背景画像を統一（動画/画像共通でロード状態管理） */}
					<Image
						source={bgSource}
						cachePolicy="memory-disk"
						transition={100}
						style={StyleSheet.absoluteFill}
						contentFit="cover"
						onLoadStart={bgLoadHandlers.onLoadStart}
						onLoad={bgLoadHandlers.onLoad}
						onError={bgLoadHandlers.onError}
					/>
					{/* #630 【設計】動画の場合のみ VideoPlayer を重ねて表示 */}
					{isVideo && hasMediaUrl && !isProcessing && !isFailed && dishMediaEntry.dish_media.mediaUrl && (
						<VideoPlayer
							uri={dishMediaEntry.dish_media.mediaUrl}
							style={StyleSheet.absoluteFill}
							shouldPlay={isActive}
							onProgress={handleVideoProgress}
							onLoop={handleVideoLoop}
						/>
					)}
				</Animated.View>
			</GestureDetector>

			{/* #630 【UX】背景画像ロード中のスケルトン表示（processing/error より下層） */}
			{shouldShowSkeleton && (
				<View style={styles.skeletonOverlay} pointerEvents="none">
					<SkeletonShimmer width="100%" height="100%" />
				</View>
			)}

			{/* #530 【設計】処理中オーバーレイ（メディア共通） */}
			{isProcessing && (
				<View style={styles.processingOverlay}>
					<ActivityIndicator size="large" color="#fff" />
					<Text style={styles.processingText}>{i18n.t("DishMediaContent.processing")}</Text>
				</View>
			)}

			{/* #530 【設計】エラーオーバーレイ（メディア共通） */}
			{isFailed && (
				<View style={styles.errorOverlay}>
					<Text style={styles.errorText}>{i18n.t("DishMediaContent.errors.mediaUnavailable")}</Text>
				</View>
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
					<ActionButtons
						id={id}
						idType={idType}
						onLayout={(width) => setRightActionsWidth(width)}
						buttonsGesture={buttonsGesture}
					/>
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
	// #630 【UX】背景画像ロード中のスケルトン表示（processing/error より下層 zIndex=2）
	skeletonOverlay: {
		...StyleSheet.absoluteFillObject,
		zIndex: 2,
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
