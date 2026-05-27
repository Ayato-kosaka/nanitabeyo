import React, { useState, useRef, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { Bookmark, ImageOff, Ban, RefreshCw } from "lucide-react-native";
import { Topic } from "@/types/search";
import { CARD_WIDTH } from "@/features/topics/constants";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { toggleReaction } from "@/lib/reactions";
import { useTopicsStore } from "@/stores/useTopicsStore";
import { profileSavedTopicsEntriesKey } from "@/features/profile/tabs/SavedTopicsTab";
import { SkeletonShimmer } from "@/components/SkeletonShimmer";
import i18n from "@/lib/i18n";
import { type TopicImageResourceState } from "@/features/topics/hooks/useTopicImageResources";

export const TopicCard = ({
	item,
	onBlock,
	displayIndex,
	cardHeight,
	imageState,
	onImageRetry,
}: {
	item: Topic;
	onBlock: (id: string) => void;
	displayIndex?: number;
	cardHeight: number;
	imageState: TopicImageResourceState;
	onImageRetry?: (topic: Topic) => void;
}) => {
	const [isSaved, setIsSaved] = useState(false);
	const { lightImpact, errorNotification } = useHaptics();
	const { logFrontendEvent } = useLogger();

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

	const handleBlock = async () => {
		errorNotification();
		onBlock(item.categoryId);
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

	// #802 【バグ】error 時は failure UI を優先し、skeleton は loading 中だけ表示する
	const shouldShowSkeleton = imageState.status === "idle" || imageState.status === "loading";
	const shouldShowFailureUI = imageState.status === "error";

	return (
		<View style={[styles.card, { height: cardHeight }]}>
			{/* #802 【設計】ready済みのImageRefを直接渡し、Carousel内Imageのloadイベントに依存しない */}
			{imageState.status === "ready" ? (
				<Image
					source={imageState.image}
					cachePolicy="memory"
					transition={100}
					style={styles.cardImage}
					recyclingKey={item.categoryId}
				/>
			) : (
				<View style={styles.cardImage} />
			)}

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
					<View style={styles.failureOverlay}>
						<View style={styles.failureContent}>
							<ImageOff size={48} color="#FFF" strokeWidth={1.5} />
							<Text style={styles.failureText}>{i18n.t("Topics.imageLoadFailed")}</Text>
							{onImageRetry && (
								<TouchableOpacity style={styles.retryButton} onPress={() => onImageRetry(item)} activeOpacity={0.8}>
									<RefreshCw size={16} color="#FFF" />
									<Text style={styles.retryText}>{i18n.t("Topics.tapToReload")}</Text>
								</TouchableOpacity>
							)}
						</View>
					</View>
				)}

				{/* Top Buttons */}
				<View style={styles.topButtons}>
					<TouchableOpacity style={styles.topButton} onPress={handleSave}>
						<Bookmark size={20} color={isSaved ? "transparent" : "white"} fill={isSaved ? "orange" : "transparent"} />
					</TouchableOpacity>
					{/* <TouchableOpacity style={styles.topButton} onPress={handleHide}>
						<Trash size={18} color="#FFF" />
					</TouchableOpacity> */}
					<TouchableOpacity
						style={styles.topButton}
						onPress={handleBlock}
						accessibilityRole="button"
						accessibilityLabel={i18n.t("Topics.BlockTopicModal.title")}>
						<Ban size={18} color="#FFF" />
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
