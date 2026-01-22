// app-expo/app/[locale]/contribution-tasks/dish-category-manual-image-supply.tsx
//
// #703 【実装】dish category 手動画像供給画面（ポップUI）実装
// ユーザー協力で料理カテゴリの画像を改善するための単体画面

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
	View,
	StyleSheet,
	ScrollView,
	Pressable,
	Text,
	ActivityIndicator,
	useWindowDimensions,
	Platform,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HelpCircle, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react-native";
import { useRouter } from "expo-router";

import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { useLogger } from "@/hooks/useLogger";
import { useAPICall } from "@/hooks/useAPICall";
import { useFileUploader } from "@/hooks/useFileUploader";
import { selectMedia } from "@/lib/mediaSelection";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Env } from "@/constants/Env";
import AsyncStorage from "@react-native-async-storage/async-storage";

/* -------------------------------------------------------------------------- */
/*                                    型定義                                   */
/* -------------------------------------------------------------------------- */

// #703 【設計】CDN JSON から取得する候補アイテムの型
type CandidateItem = {
	targetId: string; // dish_category_id (Wikidata QID)
	category: string; // 表示名
	imageUrl: string; // 候補画像
	topicTitle: string; // モーダル下部に表示するタイトル
	reason: string; // モーダル下部に表示する理由
};

// #703 【設計】CDN JSON のスキーマ
type CandidateJson = {
	items: CandidateItem[];
};

// #703 【設計】アップロード状態
type UploadState = "idle" | "uploading" | "success" | "error";

// #703 【設計】アップロード済み情報
type UploadedInfo = {
	originalPath: string;
	previewUri?: string;
	mime?: string;
	size?: number;
	width?: number;
	height?: number;
};

// #703 【設計】アイテムごとの状態管理
type ItemState = {
	uploadState: UploadState;
	uploaded?: UploadedInfo;
};

/* -------------------------------------------------------------------------- */
/*                              定数・固定値                                   */
/* -------------------------------------------------------------------------- */

const TASK_KEY = "dish_category_manual_image_supply_v1";
const TARGET_TYPE = "dish_categories";
const TYPE = "image_feedback";
const CDN_JSON_PATH = "tickets/703/dish_category_manual_image_supply_v1.latest.json";

const TUTORIAL_STORAGE_KEY = "dish_manual_image_supply_tutorial_shown";

/* -------------------------------------------------------------------------- */
/*                              メインコンポーネント                             */
/* -------------------------------------------------------------------------- */

export default function DishCategoryManualImageSupplyScreen() {
	const insets = useSafeAreaInsets();
	const { width } = useWindowDimensions();
	const router = useRouter();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const { uploadFile } = useFileUploader();

	// #703 【状態】候補アイテムリスト（除外後）
	const [items, setItems] = useState<CandidateItem[]>([]);
	// #703 【状態】アイテムごとの状態
	const [itemStates, setItemStates] = useState<Record<string, ItemState>>({});
	// #703 【状態】ローディング
	const [isLoadingCandidates, setIsLoadingCandidates] = useState(true);
	const [isSubmitting, setIsSubmitting] = useState(false);
	// #703 【状態】エラー
	const [loadError, setLoadError] = useState<string | null>(null);
	// #703 【状態】チュートリアルモーダル
	const [showTutorial, setShowTutorial] = useState(false);
	// #703 【状態】サンクス画面表示
	const [showThanks, setShowThanks] = useState(false);
	// #703 【状態】詳細モーダルで選択中のアイテム
	const [selectedItem, setSelectedItem] = useState<CandidateItem | null>(null);

	/* ---- BlurModal（チュートリアル用） ---- */
	const tutorialModal = useBlurModal({
		intensity: 80,
		closeOnBackdropPress: false,
	});

	/* ---- BlurModal（詳細モーダル用） ---- */
	const detailModal = useBlurModal({
		intensity: 70,
		closeOnBackdropPress: false,
	});

	/* -------------------------------------------------------------------------- */
	/*                              初期化処理                                    */
	/* -------------------------------------------------------------------------- */

	// #703 【処理】候補JSON読み込み＋除外処理
	const loadCandidates = useCallback(async () => {
		setIsLoadingCandidates(true);
		setLoadError(null);

		try {
			// Step 1: CDN JSONを取得
			const cdnUrl = `https://${Env.CDN_PUBLIC_HOST}/${CDN_JSON_PATH}`;
			const jsonResponse = await fetch(cdnUrl);
			if (!jsonResponse.ok) {
				throw new Error("Failed to fetch candidate JSON");
			}
			const jsonData: CandidateJson = await jsonResponse.json();

			// Step 2: 完了済みアイテムを取得
			let completedIds: string[] = [];
			try {
				const completedData = await callBackend<any, { completed: Array<{ targetId: string }> }>(
					"v1/contribution-tasks/completed-target-ids",
					{
						method: "GET",
						requestPayload: {
							taskKey: TASK_KEY,
							targetType: TARGET_TYPE,
							type: TYPE,
							minCount: 1,
							limit: 1000,
						} as any,
					},
				);
				completedIds = completedData.completed.map((c) => c.targetId);
			} catch (err) {
				// #703 【設計】completed-target-ids取得失敗時は除外なしで暫定表示
				console.warn("Failed to fetch completed target IDs, showing all candidates", err);
			}

			// Step 3: 除外処理
			const filteredItems = jsonData.items.filter((item) => !completedIds.includes(item.targetId));
			setItems(filteredItems);

			// Step 4: アイテム状態の初期化
			const initialStates: Record<string, ItemState> = {};
			filteredItems.forEach((item) => {
				initialStates[item.targetId] = { uploadState: "idle" };
			});
			setItemStates(initialStates);
		} catch (err) {
			console.error("Failed to load candidates", err);
			setLoadError("読み込みに失敗しました");
		} finally {
			setIsLoadingCandidates(false);
		}
	}, [callBackend]);

	// #703 【処理】初回表示時のチュートリアル判定
	useEffect(() => {
		const checkTutorial = async () => {
			try {
				const shown = await AsyncStorage.getItem(TUTORIAL_STORAGE_KEY);
				if (!shown) {
					setShowTutorial(true);
					tutorialModal.open();
					logFrontendEvent({
						event_name: "dish_manual_image_supply_tutorial_shown",
						error_level: "log",
						payload: {},
					});
				}
			} catch (err) {
				console.warn("Failed to check tutorial status", err);
			}
		};

		loadCandidates();
		checkTutorial();
	}, []);

	/* -------------------------------------------------------------------------- */
	/*                              ヘルプボタン                                  */
	/* -------------------------------------------------------------------------- */

	const handleHelpPress = useCallback(() => {
		setShowTutorial(true);
		tutorialModal.open();
		logFrontendEvent({
			event_name: "dish_manual_image_supply_help_opened",
			error_level: "log",
			payload: {},
		});
	}, [tutorialModal, logFrontendEvent]);

	/* -------------------------------------------------------------------------- */
	/*                              グリッド表示                                  */
	/* -------------------------------------------------------------------------- */

	const handleCardPress = useCallback(
		(item: CandidateItem) => {
			setSelectedItem(item);
			detailModal.open();
			logFrontendEvent({
				event_name: "dish_manual_image_supply_item_opened",
				error_level: "log",
				payload: { targetId: item.targetId },
			});
		},
		[detailModal, logFrontendEvent],
	);

	/* -------------------------------------------------------------------------- */
	/*                              画像選択・アップロード                          */
	/* -------------------------------------------------------------------------- */

	const handleSelectImage = useCallback(
		async (item: CandidateItem) => {
			// #703 【処理】画像選択→即アップロード
			logFrontendEvent({
				event_name: "dish_manual_image_supply_upload_started",
				error_level: "log",
				payload: { targetId: item.targetId },
			});

			// アップロード中にセット
			setItemStates((prev) => ({
				...prev,
				[item.targetId]: { ...prev[item.targetId], uploadState: "uploading" },
			}));

			try {
				// 画像選択
				const result = await selectMedia(["images"], {
					allowsEditing: false,
				});

				if (!result.success || !result.media) {
					// キャンセルまたは失敗
					setItemStates((prev) => ({
						...prev,
						[item.targetId]: { ...prev[item.targetId], uploadState: "idle" },
					}));
					return;
				}

				// アップロード
				const { uri, mimeType, width, height } = result.media;
				const fileName = `dish_category_${item.targetId}_${Date.now()}.jpg`;
				const objectPath = await uploadFile(uri, {
					mimeType,
					baseFileName: fileName,
				});

				// 成功
				setItemStates((prev) => ({
					...prev,
					[item.targetId]: {
						uploadState: "success",
						uploaded: {
							originalPath: objectPath,
							previewUri: uri,
							mime: mimeType,
							width,
							height,
						},
					},
				}));

				logFrontendEvent({
					event_name: "dish_manual_image_supply_upload_succeeded",
					error_level: "log",
					payload: { targetId: item.targetId, objectPath },
				});
			} catch (err) {
				console.error("Upload failed", err);
				setItemStates((prev) => ({
					...prev,
					[item.targetId]: { ...prev[item.targetId], uploadState: "error" },
				}));

				logFrontendEvent({
					event_name: "dish_manual_image_supply_upload_failed",
					error_level: "error",
					payload: { targetId: item.targetId, error: err instanceof Error ? err.message : String(err) },
				});
			}
		},
		[uploadFile, logFrontendEvent],
	);

	/* -------------------------------------------------------------------------- */
	/*                              「元に戻す」                                  */
	/* -------------------------------------------------------------------------- */

	const handleResetImage = useCallback((item: CandidateItem) => {
		setItemStates((prev) => ({
			...prev,
			[item.targetId]: { uploadState: "idle", uploaded: undefined },
		}));
	}, []);

	/* -------------------------------------------------------------------------- */
	/*                              送信処理                                      */
	/* -------------------------------------------------------------------------- */

	const handleSubmit = useCallback(async () => {
		// #703 【処理】送信処理（1件ずつPOST）
		const readyItems = items.filter((item) => itemStates[item.targetId]?.uploadState === "success");

		if (readyItems.length === 0) return;

		setIsSubmitting(true);
		logFrontendEvent({
			event_name: "dish_manual_image_supply_submit_started",
			error_level: "log",
			payload: { count: readyItems.length },
		});

		let successCount = 0;
		let failCount = 0;

		for (const item of readyItems) {
			const state = itemStates[item.targetId];
			if (!state?.uploaded) continue;

			try {
				await callBackend<any, any>("v1/contribution-tasks", {
					method: "POST",
					requestPayload: {
						type: TYPE,
						taskKey: TASK_KEY,
						targetType: TARGET_TYPE,
						targetId: item.targetId,
						payload: {
							category: item.category,
							topicTitle: item.topicTitle,
							reason: item.reason,
							sourceImageUrl: item.imageUrl,
							cdn: { path: CDN_JSON_PATH },
						},
						result: {
							originalPath: state.uploaded.originalPath,
						},
					},
				});
				successCount++;
			} catch (err) {
				console.error("Failed to submit item", item.targetId, err);
				failCount++;
			}
		}

		logFrontendEvent({
			event_name: "dish_manual_image_supply_submit_result",
			error_level: "log",
			payload: { successCount, failCount },
		});

		setIsSubmitting(false);
		setShowThanks(true);
	}, [items, itemStates, callBackend, logFrontendEvent]);

	/* -------------------------------------------------------------------------- */
	/*                              サンクス画面                                  */
	/* -------------------------------------------------------------------------- */

	const handleThanksAction = useCallback(() => {
		const remainingItems = items.filter((item) => itemStates[item.targetId]?.uploadState !== "success");

		if (remainingItems.length > 0) {
			// まだ協力できる料理がある
			logFrontendEvent({
				event_name: "dish_manual_image_supply_thanks_continue_clicked",
				error_level: "log",
				payload: {},
			});
			setShowThanks(false);
			loadCandidates(); // 再読み込み
		} else {
			// もう無い
			router.back();
		}
	}, [items, itemStates, loadCandidates, router, logFrontendEvent]);

	/* -------------------------------------------------------------------------- */
	/*                              算出値                                        */
	/* -------------------------------------------------------------------------- */

	// #703 【算出】画像セット済み数
	const readyCount = useMemo(() => {
		return items.filter((item) => itemStates[item.targetId]?.uploadState === "success").length;
	}, [items, itemStates]);

	// #703 【算出】グリッド列数とカードサイズ
	const GRID_COLUMNS = 3;
	const CARD_GAP = 8;
	const HORIZONTAL_PADDING = 16;
	const cardWidth = (width - HORIZONTAL_PADDING * 2 - CARD_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
	const cardHeight = (cardWidth * 16) / 9;

	/* -------------------------------------------------------------------------- */
	/*                              レンダリング                                  */
	/* -------------------------------------------------------------------------- */

	// #703 【表示】ローディング中
	if (isLoadingCandidates) {
		return (
			<View style={[styles.container, styles.centered]}>
				<ActivityIndicator size="large" color="#FF6B6B" />
				<Text style={styles.loadingText}>読み込み中...</Text>
			</View>
		);
	}

	// #703 【表示】エラー時
	if (loadError) {
		return (
			<View style={[styles.container, styles.centered]}>
				<Text style={styles.errorText}>{loadError}</Text>
				<PrimaryButton label="再読み込み" onPress={loadCandidates} style={styles.retryButton} />
			</View>
		);
	}

	// #703 【表示】サンクス画面
	if (showThanks) {
		const hasMoreItems = items.filter((item) => itemStates[item.targetId]?.uploadState !== "success").length > 0;

		return (
			<View style={[styles.container, styles.centered, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
				<Text style={styles.thanksTitle}>ご協力ありがとうございます！</Text>
				<Text style={styles.thanksMessage}>
					頂いた画像を確認・リサイズ後に反映して、もっとなに食べよを使いやすくしていきます。
				</Text>
				<PrimaryButton
					label={hasMoreItems ? "まだ協力できる料理を見る" : "画面を閉じる"}
					onPress={handleThanksAction}
					style={styles.thanksButton}
				/>
			</View>
		);
	}

	// #703 【表示】メイン画面
	return (
		<View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
			{/* ヘッダー */}
			<View style={styles.header}>
				<View style={styles.headerTextContainer}>
					<Text style={styles.headerTitle}>料理提案画像を綺麗にしよう！</Text>
					<Text style={styles.headerSubtitle}>
						思わず涎が出る、美味しそうな料理画像をAIで作って、貼り付けて送信してください！
					</Text>
				</View>
				<Pressable onPress={handleHelpPress} hitSlop={10} style={styles.helpButton}>
					<HelpCircle size={32} color="#666" />
				</Pressable>
			</View>

			{/* グリッド */}
			<ScrollView style={styles.scrollView} contentContainerStyle={styles.gridContainer}>
				{items.map((item, index) => {
					const state = itemStates[item.targetId];
					const uploadState = state?.uploadState ?? "idle";
					// #703 【設計】3列目のカードは右マージンなし
					const isLastInRow = (index + 1) % GRID_COLUMNS === 0;

					return (
						<Pressable
							key={item.targetId}
							onPress={() => handleCardPress(item)}
							style={[styles.card, { width: cardWidth, height: cardHeight, marginRight: isLastInRow ? 0 : CARD_GAP }]}>
							<Image source={{ uri: item.imageUrl }} style={styles.cardImage} contentFit="cover" />

							{/* オーバーレイ（カテゴリ名） */}
							<View style={styles.cardOverlay}>
								<Text style={styles.cardCategory} numberOfLines={2}>
									{item.category}
								</Text>
							</View>

							{/* 状態バッジ */}
							{uploadState !== "idle" && (
								<View style={styles.badge}>
									{uploadState === "uploading" && (
										<View style={styles.badgeContent}>
											<Loader2 size={14} color="#FFF" />
											<Text style={styles.badgeText}>準備中…</Text>
										</View>
									)}
									{uploadState === "success" && (
										<View style={styles.badgeContent}>
											<CheckCircle2 size={14} color="#FFF" />
											<Text style={styles.badgeText}>OK！</Text>
										</View>
									)}
									{uploadState === "error" && (
										<View style={styles.badgeContent}>
											<AlertTriangle size={14} color="#FFF" />
											<Text style={styles.badgeText}>もう一度！</Text>
										</View>
									)}
								</View>
							)}
						</Pressable>
					);
				})}
			</ScrollView>

			{/* フッター */}
			<View style={styles.footer}>
				<Text style={styles.footerText}>準備できた料理：{readyCount}</Text>
				<PrimaryButton
					label={readyCount > 0 ? `画像を送信する（${readyCount}）` : "まずは画像を選んでね"}
					onPress={handleSubmit}
					disabled={readyCount === 0 || isSubmitting}
					loading={isSubmitting}
					style={styles.submitButton}
				/>
			</View>

			{/* チュートリアルモーダル */}
			<tutorialModal.BlurModal showCloseButton={true}>
				<View style={styles.tutorialModal}>
					<Text style={styles.tutorialTitle}>使い方</Text>
					<Text style={styles.tutorialText}>
						・料理カテゴリをタップ{"\n"}
						・AIで生成した美味しそうな画像を選択{"\n"}
						・送信ボタンで完了！{"\n"}
						{"\n"}
						＜プロンプト例＞{"\n"}
						"美味しそうな◯◯の写真"
					</Text>
					<PrimaryButton
						label="さっそくやってみる！"
						onPress={async () => {
							try {
								await AsyncStorage.setItem(TUTORIAL_STORAGE_KEY, "true");
							} catch (err) {
								console.warn("Failed to save tutorial status", err);
							}
							tutorialModal.close();
						}}
						style={styles.tutorialButton}
					/>
				</View>
			</tutorialModal.BlurModal>

			{/* 詳細モーダル */}
			{selectedItem && (
				<detailModal.BlurModal showCloseButton={true}>
					<View style={styles.detailModal}>
						{/* 画像 */}
						<View style={styles.detailImageContainer}>
							<Image
								source={{
									uri: itemStates[selectedItem.targetId]?.uploaded?.previewUri ?? selectedItem.imageUrl,
								}}
								style={styles.detailImage}
								contentFit="contain"
							/>
							{/* オーバーレイ */}
							<View style={styles.detailOverlay}>
								<Text style={styles.detailTopicTitle}>{selectedItem.topicTitle}</Text>
								<Text style={styles.detailReason} numberOfLines={3}>
									{selectedItem.reason}
								</Text>
							</View>
						</View>

						{/* ボタン */}
						<View style={styles.detailButtons}>
							<PrimaryButton
								label="画像を選ぶ"
								onPress={() => handleSelectImage(selectedItem)}
								disabled={itemStates[selectedItem.targetId]?.uploadState === "uploading"}
								loading={itemStates[selectedItem.targetId]?.uploadState === "uploading"}
								style={styles.detailMainButton}
							/>

							{itemStates[selectedItem.targetId]?.uploadState === "success" && (
								<Pressable onPress={() => handleResetImage(selectedItem)} style={styles.detailResetButton}>
									<Text style={styles.detailResetButtonText}>元に戻す</Text>
								</Pressable>
							)}

							{/* 状態メッセージ */}
							{itemStates[selectedItem.targetId]?.uploadState === "uploading" && (
								<Text style={styles.detailStatusText}>アップロード中…ちょっと待ってね</Text>
							)}
							{itemStates[selectedItem.targetId]?.uploadState === "error" && (
								<Text style={styles.detailStatusError}>うまくいかなかったみたい。もう一度選んでね</Text>
							)}
						</View>
					</View>
				</detailModal.BlurModal>
			)}
		</View>
	);
}

/* -------------------------------------------------------------------------- */
/*                              スタイル定義                                  */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#FFF",
	},
	centered: {
		justifyContent: "center",
		alignItems: "center",
		padding: 20,
	},
	loadingText: {
		marginTop: 16,
		fontSize: 16,
		color: "#666",
	},
	errorText: {
		fontSize: 16,
		color: "#FF3B30",
		textAlign: "center",
		marginBottom: 16,
	},
	retryButton: {
		paddingHorizontal: 24,
		paddingVertical: 12,
	},
	header: {
		flexDirection: "row",
		alignItems: "center",
		padding: 16,
		borderBottomWidth: 1,
		borderBottomColor: "#EEE",
	},
	headerTextContainer: {
		flex: 1,
	},
	headerTitle: {
		fontSize: 20,
		fontWeight: "700",
		color: "#333",
		marginBottom: 4,
	},
	headerSubtitle: {
		fontSize: 13,
		color: "#666",
		lineHeight: 18,
	},
	helpButton: {
		marginLeft: 8,
	},
	scrollView: {
		flex: 1,
	},
	gridContainer: {
		padding: 16,
		flexDirection: "row",
		flexWrap: "wrap",
	},
	card: {
		borderRadius: 12,
		overflow: "hidden",
		backgroundColor: "#F5F5F5",
		position: "relative",
		marginBottom: 8,
	},
	cardImage: {
		width: "100%",
		height: "100%",
	},
	cardOverlay: {
		position: "absolute",
		bottom: 0,
		left: 0,
		right: 0,
		backgroundColor: "rgba(0,0,0,0.6)",
		padding: 8,
	},
	cardCategory: {
		color: "#FFF",
		fontSize: 12,
		fontWeight: "600",
	},
	badge: {
		position: "absolute",
		top: 8,
		right: 8,
		backgroundColor: "rgba(0,0,0,0.7)",
		borderRadius: 12,
		paddingHorizontal: 8,
		paddingVertical: 4,
	},
	badgeContent: {
		flexDirection: "row",
		alignItems: "center",
	},
	badgeText: {
		color: "#FFF",
		fontSize: 10,
		fontWeight: "600",
		marginLeft: 4,
	},
	footer: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		padding: 16,
		borderTopWidth: 1,
		borderTopColor: "#EEE",
	},
	footerText: {
		fontSize: 14,
		fontWeight: "600",
		color: "#333",
	},
	submitButton: {
		paddingHorizontal: 20,
		paddingVertical: 12,
	},
	tutorialModal: {
		backgroundColor: "#FFF",
		borderRadius: 16,
		padding: 24,
		marginHorizontal: 20,
		maxWidth: 400,
		alignSelf: "center",
	},
	tutorialTitle: {
		fontSize: 22,
		fontWeight: "700",
		color: "#333",
		marginBottom: 16,
		textAlign: "center",
	},
	tutorialText: {
		fontSize: 15,
		color: "#666",
		lineHeight: 22,
		marginBottom: 24,
	},
	tutorialButton: {
		paddingVertical: 14,
	},
	detailModal: {
		backgroundColor: "#FFF",
		borderRadius: 16,
		marginHorizontal: 20,
		maxWidth: 500,
		alignSelf: "center",
		overflow: "hidden",
	},
	detailImageContainer: {
		width: "100%",
		aspectRatio: 9 / 16,
		position: "relative",
	},
	detailImage: {
		width: "100%",
		height: "100%",
	},
	detailOverlay: {
		position: "absolute",
		bottom: 0,
		left: 0,
		right: 0,
		backgroundColor: "rgba(0,0,0,0.7)",
		padding: 16,
	},
	detailTopicTitle: {
		color: "#FFF",
		fontSize: 16,
		fontWeight: "700",
		marginBottom: 4,
	},
	detailReason: {
		color: "#FFF",
		fontSize: 13,
		lineHeight: 18,
	},
	detailButtons: {
		padding: 16,
	},
	detailMainButton: {
		paddingVertical: 14,
		marginBottom: 12,
	},
	detailResetButton: {
		paddingVertical: 10,
		alignItems: "center",
		marginBottom: 12,
	},
	detailResetButtonText: {
		color: "#666",
		fontSize: 14,
	},
	detailStatusText: {
		color: "#666",
		fontSize: 13,
		textAlign: "center",
	},
	detailStatusError: {
		color: "#FF3B30",
		fontSize: 13,
		textAlign: "center",
	},
	thanksTitle: {
		fontSize: 24,
		fontWeight: "700",
		color: "#333",
		marginBottom: 16,
		textAlign: "center",
	},
	thanksMessage: {
		fontSize: 15,
		color: "#666",
		lineHeight: 22,
		textAlign: "center",
		marginBottom: 32,
		paddingHorizontal: 20,
	},
	thanksButton: {
		paddingHorizontal: 24,
		paddingVertical: 14,
	},
});
