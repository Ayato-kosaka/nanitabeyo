import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { Trash, Bookmark, ImageOff, RefreshCw } from "lucide-react-native";
import { Topic } from "@/types/search";
import { CARD_WIDTH, CARD_HEIGHT } from "@/features/topics/constants";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { toggleReaction } from "@/lib/reactions";
import { WIKIMEDIA_HEADERS } from "@/lib/wikimedia";
import { useTopicsStore } from "@/stores/useTopicsStore";
import { profileSavedTopicsEntriesKey } from "@/features/profile/tabs/SavedTopicsTab";
import { SkeletonShimmer } from "@/components/SkeletonShimmer";
import i18n from "@/lib/i18n";
import { useImageLoadWithRetry } from "@/hooks/useImageLoadWithRetry";

// Display a single topic card inside the carousel
export const TopicCard = ({
	item,
	onHide,
	displayIndex,
}: {
	item: Topic;
	onHide: (id: string) => void;
	displayIndex?: number;
}) => {
	const [isSaved, setIsSaved] = useState(false);
	const { lightImpact, errorNotification } = useHaptics();
	const { logFrontendEvent } = useLogger();

	// #630 【設計】useImageLoadWithRetry を利用して、画像ロード状態 + 自動リトライ管理
	const {
		uri: imageUrl,
		loadState,
		isRetrying,
		hasGivenUp,
		handlers,
		manualRetry,
	} = useImageLoadWithRetry({
		uri: item.imageUrl,
		cacheBustingKey: item.categoryId,
		onErrorCountChange: (count) => {
			logFrontendEvent({
				event_name: "topic_image_load_error",
				error_level: "log",
				payload: {
					topic_id: item.categoryId,
					error_count: count,
					image_url: item.imageUrl,
				},
			});
		},
		onGiveUp: (count) => {
			logFrontendEvent({
				event_name: "topic_image_load_give_up",
				error_level: "warn",
				payload: {
					topic_id: item.categoryId,
					error_count: count,
					image_url: item.imageUrl,
				},
			});
		},
	});

	const source = useMemo(
		() => ({
			uri: imageUrl,
			headers: WIKIMEDIA_HEADERS,
		}),
		[imageUrl],
	);

	const handleSave = async () => {
		const willSave = !isSaved;
		lightImpact();
		setIsSaved(willSave);

		const { updateTopicIdsByKey, upsertTopics } = useTopicsStore.getState();

		try {
			await toggleReaction({
				target_type: "dish_categories",
				target_id: item.categoryId,
				action_type: "save",
				willReact: willSave,
			});

			// #472【設計】保存 ON → saved タブの先頭に移動、保存 OFF → saved タブから除外
			if (willSave) {
				upsertTopics([
					{
						id: item.categoryId,
						image_url: item.imageUrl,
						labels: {},
						label_en: item.topicTitle,
					},
				]);
				updateTopicIdsByKey(profileSavedTopicsEntriesKey, (prev) => {
					const without = prev.filter((id) => id !== item.categoryId);
					return [item.categoryId, ...without];
				});
			} else {
				updateTopicIdsByKey(profileSavedTopicsEntriesKey, (prev) => prev.filter((id) => id !== item.categoryId));
			}
		} catch (error) {
			// Revert state on error
			logFrontendEvent({
				event_name: "topic_save_reaction_failed",
				error_level: "log",
				payload: {
					error: error instanceof Error ? error.message : String(error),
					target_id: item.categoryId,
					action_type: "save",
					willReact: willSave,
				},
			});
		}
	};

	const handleHide = async () => {
		errorNotification();
		onHide(item.categoryId);
	};

	// impression ログ送信済みフラグ（重複防止用）
	const impressionLoggedRef = useRef(false);

	// ログ追加【仕様】topic_impression ログ送信（カード表示時に1回のみ）
	useEffect(() => {
		if (!impressionLoggedRef.current) {
			impressionLoggedRef.current = true;
			logFrontendEvent({
				event_name: "topic_impression",
				error_level: "log",
				payload: {
					topic_id: item.categoryId,
					display_index: displayIndex ?? null,
				},
			});
		}
	}, [item.categoryId, displayIndex, logFrontendEvent]);

	// #615 【UX】手動リトライ（ユーザーがタップで再読み込み）
	const handleManualRetry = useCallback(() => {
		manualRetry();
		logFrontendEvent({
			event_name: "topic_image_manual_retry",
			error_level: "log",
			payload: { topic_id: item.categoryId },
		});
	}, [manualRetry, item.categoryId, logFrontendEvent]);

	// #630 【UX】派生状態: スケルトン表示条件（loading または retrying 中）
	const shouldShowSkeleton = loadState === "loading" || isRetrying;
	// #630 【UX】派生状態: 失敗UI表示条件
	const shouldShowFailureUI = loadState === "error" && hasGivenUp;

	return (
		<View style={styles.card}>
			<Image
				source={source}
				cachePolicy="memory"
				transition={100}
				style={styles.cardImage}
				onLoadStart={handlers.onLoadStart}
				onLoad={handlers.onLoad}
				onError={handlers.onError}
			/>

			{/* #615 【UX】画像ロード中のスケルトン表示 */}
			{shouldShowSkeleton && (
				<View style={styles.skeletonOverlay}>
					<SkeletonShimmer width="100%" height="100%" borderRadius={24} />
				</View>
			)}

			{/* Content Overlay */}
			<View style={styles.cardOverlay}>
				{/* #615 【UX】画像ロード失敗時の UI（アイコン + 再読み込み導線） */}
				{shouldShowFailureUI && (
					<TouchableOpacity style={styles.failureOverlay} onPress={handleManualRetry} activeOpacity={0.8}>
						<View style={styles.failureContent}>
							<ImageOff size={48} color="#FFF" strokeWidth={1.5} />
							<Text style={styles.failureText}>{i18n.t("Topics.imageLoadFailed")}</Text>
							<View style={styles.retryButton}>
								<RefreshCw size={16} color="#FFF" />
								<Text style={styles.retryText}>{i18n.t("Topics.tapToReload")}</Text>
							</View>
						</View>
					</TouchableOpacity>
				)}

				{/* Top Buttons */}
				<View style={styles.topButtons}>
					<TouchableOpacity style={styles.topButton} onPress={handleSave}>
						<Bookmark size={20} color={isSaved ? "transparent" : "white"} fill={isSaved ? "orange" : "transparent"} />
					</TouchableOpacity>
					<TouchableOpacity style={styles.topButton} onPress={handleHide}>
						<Trash size={18} color="#FFF" />
					</TouchableOpacity>
				</View>

				{/* Content */}
				<View style={styles.cardContent}>
					<Text style={styles.cardTitle}>{item.topicTitle}</Text>
					<Text style={styles.cardDescription}>{item.reason}</Text>
				</View>
			</View>
		</View>
	);
};

const styles = StyleSheet.create({
	card: {
		width: CARD_WIDTH,
		height: CARD_HEIGHT,
		borderRadius: 24,
		overflow: "hidden",
		backgroundColor: "#EEE",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.3,
		shadowRadius: 32,
		elevation: 12,
		position: "relative",
	},
	cardImage: {
		width: "100%",
		height: "100%",
	},
	// #615 【UX】スケルトン表示用の絶対配置オーバーレイ
	skeletonOverlay: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
		zIndex: 1,
	},
	// #615 【UX】画像ロード失敗時のオーバーレイ
	failureOverlay: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
		justifyContent: "center",
		alignItems: "center",
		zIndex: 2,
	},
	failureContent: {
		alignItems: "center",
		gap: 16,
	},
	failureText: {
		fontSize: 16,
		color: "#FFF",
		fontWeight: "600",
		textAlign: "center",
	},
	retryButton: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		backgroundColor: "rgba(0, 0, 0, 0.3)",
		paddingHorizontal: 20,
		paddingVertical: 12,
		borderRadius: 24,
	},
	retryText: {
		fontSize: 14,
		color: "#FFF",
		fontWeight: "600",
	},
	cardOverlay: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
		backgroundColor: "rgba(0, 0, 0, 0.1)",
		padding: 24,
		justifyContent: "space-between",
		zIndex: 3,
	},
	topButtons: {
		alignSelf: "flex-end",
		gap: 12,
		zIndex: 4,
	},
	topButton: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "rgba(0, 0, 0, 0.3)",
		paddingHorizontal: 16,
		paddingVertical: 10,
		borderRadius: 20,
		gap: 6,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.3,
		shadowRadius: 4,
		elevation: 4,
	},
	cardContent: {
		flex: 1,
		justifyContent: "flex-end",
		zIndex: 1,
	},
	cardTitle: {
		fontSize: 32,
		fontWeight: "700",
		color: "#FFFFFF",
		marginBottom: 16,
		textShadowColor: "rgba(0, 0, 0, 0.8)",
		textShadowOffset: { width: 0, height: 2 },
		textShadowRadius: 4,
		lineHeight: 40,
		letterSpacing: -0.5,
	},
	cardDescription: {
		fontSize: 18,
		color: "#FFFFFF",
		lineHeight: 28,
		marginBottom: 16,
		textShadowColor: "rgba(0, 0, 0, 0.8)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 3,
		fontWeight: "500",
	},
});
