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

// #615 【設計】画像ロード失敗時の自動リトライ最大回数
const MAX_AUTO_RETRY = 2;
// #615 【設計】リトライ間隔（ミリ秒）
const RETRY_DELAY_MS = 1000;

// Display a single topic card inside the carousel
export const TopicCard = ({ item, onHide }: { item: Topic; onHide: (id: string) => void }) => {
	const [isSaved, setIsSaved] = useState(false);
	// #615 【UX】画像ロード状態管理（スケルトン表示用）
	const [imageLoadState, setImageLoadState] = useState<"loading" | "loaded" | "retrying" | "failed">("loading");
	// #615 画像ロード失敗回数（自動リトライ制御用）
	const [errorCount, setErrorCount] = useState(0);
	// #615 【設計】画像リロードトークン（キャッシュ回避用クエリパラメータ）
	const [reloadToken, setReloadToken] = useState(0);
	// #615 リトライタイマーの参照を保持（unmount 時のクリーンアップ用）
	const retryTimerRef = useRef<number | null>(null);
	const { lightImpact, errorNotification } = useHaptics();
	const { logFrontendEvent } = useLogger();

	// #615 【設計】reloadToken を画像URLに付与してキャッシュ回避（reloadToken 変更時のみタイムスタンプ生成）
	const imageUrlWithCacheBuster = useMemo(() => {
		if (reloadToken === 0) {
			return item.imageUrl;
		}
		const separator = item.imageUrl.includes("?") ? "&" : "?";
		return `${item.imageUrl}${separator}t=${reloadToken}_${item.categoryId}`;
	}, [item.imageUrl, item.categoryId, reloadToken]);

	const source = useMemo(
		() => ({
			uri: imageUrlWithCacheBuster,
			headers: WIKIMEDIA_HEADERS,
		}),
		[imageUrlWithCacheBuster],
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

	// #615 【UX】画像ロード開始時にスケルトンを表示
	const handleLoadStart = useCallback(() => {
		setImageLoadState((prev) => (prev === "retrying" ? "retrying" : "loading"));
	}, []);

	// #615 【UX】画像ロード完了時にスケルトンを非表示
	const handleLoadEnd = useCallback(() => {
		setImageLoadState("loaded");
	}, []);

	// #615 画像ロード失敗時、最大2回まで自動リトライ（軽いバックオフ付き）
	const handleImageError = useCallback(() => {
		// #615 既存のリトライタイマーをクリアして重複を防ぐ
		if (retryTimerRef.current) {
			clearTimeout(retryTimerRef.current);
			retryTimerRef.current = null;
		}

		setErrorCount((prevCount) => {
			const newCount = prevCount + 1;

			logFrontendEvent({
				event_name: "topic_image_load_error",
				error_level: "log",
				payload: {
					topic_id: item.categoryId,
					error_count: newCount,
					image_url: item.imageUrl,
				},
			});

			if (newCount <= MAX_AUTO_RETRY) {
				// #615 【設計】自動リトライ中はスケルトンを維持。リトライごとに待機時間を増やす（バックオフ）
				setImageLoadState("retrying");
				retryTimerRef.current = setTimeout(() => {
					setReloadToken((prev) => prev + 1);
				}, RETRY_DELAY_MS * newCount);
			} else {
				// 自動リトライ超過後は失敗確定
				setImageLoadState("failed");
			}

			return newCount;
		});
	}, [item.categoryId, item.imageUrl, logFrontendEvent]);

	// #615 unmount 時にリトライタイマーをクリーンアップ（unmounted component への state 更新を防ぐ）
	useEffect(() => {
		return () => {
			if (retryTimerRef.current) {
				clearTimeout(retryTimerRef.current);
			}
		};
	}, []);

	// #615 【UX】手動リトライ（ユーザーがタップで再読み込み）
	const handleManualRetry = useCallback(() => {
		// #615 既存のリトライタイマーをクリアしてレースコンディションを防ぐ
		if (retryTimerRef.current) {
			clearTimeout(retryTimerRef.current);
			retryTimerRef.current = null;
		}
		setErrorCount(0);
		setImageLoadState("retrying");
		setReloadToken((prev) => prev + 1);
		logFrontendEvent({
			event_name: "topic_image_manual_retry",
			error_level: "log",
			payload: { topic_id: item.categoryId },
		});
	}, [item.categoryId, logFrontendEvent]);

	return (
		<View style={styles.card}>
			<Image
				source={source}
				cachePolicy="memory"
				transition={100}
				style={styles.cardImage}
				onLoadStart={handleLoadStart}
				onLoadEnd={handleLoadEnd}
				onError={handleImageError}
			/>

			{/* #615 【UX】画像ロード中のスケルトン表示 */}
			{(imageLoadState === "loading" || imageLoadState === "retrying") && (
				<View style={styles.skeletonOverlay}>
					<SkeletonShimmer width="100%" height="100%" borderRadius={24} />
				</View>
			)}

			{/* Content Overlay */}
			<View style={styles.cardOverlay}>
				{/* #615 【UX】画像ロード失敗時の UI（アイコン + 再読み込み導線） */}
				{imageLoadState === "failed" && (
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
