import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import VideoPlayer from "../../../components/VideoPlayer";
import { ExternalEmbedPlayer } from "./ExternalEmbedPlayer";
import { ActionButtons } from "./ActionButtons";
import { DishReviewsSection } from "./DishReviewsSection";
import { useMediaTracking } from "../hooks/useMediaTracking";
import i18n from "@/lib/i18n";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import {
	NormalizedDishMediaEntry,
	selectEntryByMediaId,
	selectEntryByReviewId,
	useDishMediaEntriesStore,
	IdType,
} from "@/stores/useDishMediaEntriesStore";
import type {
	MediaProcessingStatus,
	QueryDishMediaByIdsResponse,
	ReportExternalEmbedPlaybackResponse,
} from "@shared/api/v1/res";
import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { SkeletonShimmer } from "@/components/SkeletonShimmer";
import { type DishMediaBackgroundImageState } from "@/features/dishMedia/hooks/useDishMediaBackgroundImageResources";
import { getDishMediaBackgroundImageUri } from "@/features/dishMedia/utils/backgroundImage";
// #1509 全画面メディアの上の文字・黒背景は「常に同じ見え方」が仕様のため、テーマ非追従の FixedColors を使う
import { FixedColors } from "@/constants/Palette";

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
	backgroundImageState: DishMediaBackgroundImageState;
	/** #1375 「食べたを記録」を出すか（検索動線の DishMediaMap では false）。既定 true */
	showRecordEaten?: boolean;
	/**
	 * #1375（5 巡目・性能レビュー B-2）**動画プレイヤーを実体化してよいセルか。**
	 *
	 * `DishMediaFeed` の `windowSize={5}` は前後 2 ページぶんのセルを «見えていないのに»
	 * マウントする。動画セルはそのぶん `expo-video` の `useVideoPlayer`
	 * （native は AVPlayer / ExoPlayer の実体）を作るので、**同時に最大 5 本の
	 * デコーダが立つ**。低メモリ端末で落ちる・フィードが重いの直接の原因になりうる。
	 *
	 * 隣（±1）だけは先読みしたい（スワイプした瞬間に黒画面を出さないため）ので、
	 * «見えている ±1» を親が判定してここへ渡す。範囲外のセルは背景画像だけを描く。
	 * 既定 true = 単体で使う `DishMediaMap` のカルーセルは今までどおり。
	 */
	isNearActive?: boolean;
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
	backgroundImageState,
	showRecordEaten,
	isNearActive = true,
}: DishMediaContentProps) {
	// #940 【修正】entry 未取得時に throw する前に理由を記録する。throw 自体は残す
	// (このコンポーネントは entry の存在を前提に構築されており、無ければ描画できないため)。
	// ErrorBoundary(親の DishMediaMap.renderCarouselItem に設置済み)がこの throw を捕捉し、
	// カード単位のリトライ表示に変換することで white screen を防ぐ
	const { logFrontendEvent } = useLogger();

	// #530 【設計】dishMediaEntry を useState で管理し、ポーリング結果を反映できるようにする
	const [dishMediaEntry, setDishMediaEntry] = useState<NormalizedDishMediaEntry>(() => {
		const state = useDishMediaEntriesStore.getState(); // ← subscribe しない snapshot 読み
		const entry = idType === "dish_media" ? selectEntryByMediaId(id)(state) : selectEntryByReviewId(id)(state);
		if (!entry) {
			logFrontendEvent({
				event_name: "dish_media_content_entry_missing",
				error_level: "error",
				payload: { id, idType, entriesKey },
			});
			throw new Error("DishMediaContent: entry is undefined");
		}
		return entry;
	});

	const { callBackend } = useAPICall();
	const insets = useSafeAreaInsets();

	/*
	#1641 **埋め込みが再生できなかったことをサーバへ知らせる。**

	定期的な死活監視は無い（このリポジトリに cron は 1 本も無い）。取り込んだ後で
	楽曲の権利ブロックが入る / 投稿者が埋め込みを切る、は実際に起きるが、
	**実際に踏んだ端末が知らせない限り誰も気づけない**。

	⚠️ **送るのは «確かめ直して» という合図だけで、判定は送らない。** 端末が再生できない
	   理由は投稿の側とは限らない（機内モード・WebView が殺された直後）。サーバが
	   provider へ問い合わせ直して判定する（`reportUnplayable`）。
	⚠️ **失敗を握り潰す。** これは画面の裏で自動的に飛ぶ呼び出しで、ユーザーには
	   «再生できなかった» という結果が既に見えている。ここで失敗を見せる意味が無い。
	*/
	const handleEmbedUnplayable = useCallback(() => {
		const dishMediaId = dishMediaEntry.dish_media.id;
		callBackend<Record<string, never>, ReportExternalEmbedPlaybackResponse>(
			`v1/dish-media/imports/${dishMediaId}/playback-report`,
			// 本文は空。**端末に «理由» を送らせない**（送らせると保存したくなる）
			{ method: "POST", requestPayload: {} },
		).catch((error) => {
			logFrontendEvent({
				event_name: "external_embed_playback_report_failed",
				error_level: "warn",
				payload: { dishMediaId, error: error instanceof Error ? error.message : String(error) },
			});
		});
	}, [callBackend, dishMediaEntry.dish_media.id, logFrontendEvent]);
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
	const bgUri = useMemo(() => getDishMediaBackgroundImageUri(dishMediaEntry), [dishMediaEntry]);

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

	// #802 【設計】画像リソース取得に失敗した場合は skeleton を出し続けない。
	// 既存実装でも画像ロード error 専用 UI はなく、loading 中のみ skeleton を表示していた。
	// 新実装では ready の ImageRef がある場合だけ背景 Image を mount し、error 時は黒背景/背面背景にフォールバックする。
	const shouldShowSkeleton =
		(backgroundImageState.status === "idle" || backgroundImageState.status === "loading") && !isFailed && !isProcessing;

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
	// #1375 埋め込みの再生ボタン用。buttonsGesture と同じ目的だが、1 つの gesture は
	// 1 つの GestureDetector にしか付けられないため別インスタンスにする
	const embedButtonGesture = useMemo(
		() =>
			Gesture.Tap()
				.maxDistance(9999)
				.onBegin(() => {}),
		[],
	);
	const tapGesture = useMemo(() => {
		return (
			Gesture.Tap()
				// #611 横スワイプと競合しないように maxDistance を設定
				.maxDistance(10)
				// #694 【設計】ボタン操作中は親Tapを失敗させる（縁タップ誤発火防止）
				.requireExternalGestureToFail(buttonsGesture, embedButtonGesture)
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
	}, [onCardPress, dishMediaEntry, pressed, buttonsGesture, embedButtonGesture]);

	return (
		<View style={styles.container}>
			<GestureDetector gesture={tapGesture}>
				<Animated.View style={[StyleSheet.absoluteFill, pressStyle]}>
					{/* #802 【設計】表示側 Image の load/display イベントには依存しない。 */}
					{backgroundImageState.status === "ready" && (
						<Image
							source={backgroundImageState.image}
							cachePolicy="memory-disk"
							transition={100}
							style={StyleSheet.absoluteFill}
							contentFit="cover"
							recyclingKey={`${dishMediaEntry.dish_media.id}::${bgUri ?? ""}`}
							// #937 【仕様】料理名(無ければ店舗名)を伝える情報画像として alt/accessibilityLabel を付与する
							alt={dishMediaEntry.dish.name ?? dishMediaEntry.restaurant.name}
							accessibilityLabel={dishMediaEntry.dish.name ?? dishMediaEntry.restaurant.name}
						/>
					)}
					{/* #630 【設計】動画の場合のみ VideoPlayer を重ねて表示。
					    #1375（5 巡目・性能 B-2）ただし «見えている ±1» のセルだけ。範囲外は背景画像のまま
					    （プレイヤーを作らない = デコーダを立てない）。isNearActive の doc を参照 */}
					{isNearActive &&
						isVideo &&
						hasMediaUrl &&
						!isProcessing &&
						!isFailed &&
						dishMediaEntry.dish_media.mediaUrl && (
							<VideoPlayer
								uri={dishMediaEntry.dish_media.mediaUrl}
								style={StyleSheet.absoluteFill}
								shouldPlay={isActive}
								onProgress={handleVideoProgress}
								onLoop={handleVideoLoop}
							/>
						)}
					{/* #1375 4 巡目実機確認: SNS 取り込み（render_type='external_embed'）の再生。
					    mediaUrl は自ストレージに実体が無いので常に null。ここが無いと
					    取り込んだリールは «サムネイルが出るだけで再生できない»（実機で指摘された）。
					    web は iframe、ネイティブは WebView（ビルドに在れば）/ アプリ内ブラウザで再生する */}
					{dishMediaEntry.dish_media.externalEmbed && !isProcessing && !isFailed && (
						<ExternalEmbedPlayer
							embed={dishMediaEntry.dish_media.externalEmbed}
							isActive={isActive}
							onUnplayable={handleEmbedUnplayable}
							blockParentTapGesture={embedButtonGesture}
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
					<LoadingIndicator size="large" />
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
					{/* #956 【仕様】評価表示は「投稿者が付けた星」(DishReviewsSection側)のみとし、
					    平均評価はレビュー数が少ないフェーズでは目安として機能しないため表示しない */}
					<View style={styles.priceRatingContainer}></View>
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
						showRecordEaten={showRecordEaten}
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
		backgroundColor: FixedColors.mediaBackground,
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
		color: FixedColors.onMedia,
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
		color: FixedColors.onMedia,
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
		color: FixedColors.onMedia,
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
		color: FixedColors.onMedia,
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
		color: FixedColors.onMedia,
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
		color: FixedColors.onMedia,
		fontSize: 16,
		textShadowColor: "rgba(0, 0, 0, 0.5)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 2,
	},
});
