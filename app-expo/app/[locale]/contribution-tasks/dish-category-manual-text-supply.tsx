// app-expo/app/[locale]/contribution-tasks/dish-category-manual-text-supply.tsx
//
// #749 【実装】dish category 手動文言改善画面（Tinder UI）
// ユーザー協力で料理カテゴリの title/subTitle を改善するための単体画面

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { FixedColors, type Palette } from "@/constants/Palette";
import {
	View,
	StyleSheet,
	Text,
	ActivityIndicator,
	useWindowDimensions,
	Pressable,
	TextInput,
	ScrollView,
	Keyboard,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HelpCircle, X, Check, ArrowRight, Edit3, SkipForward } from "lucide-react-native";
import { useRouter } from "expo-router";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
	useSharedValue,
	useAnimatedStyle,
	withSpring,
	withTiming,
	runOnJS,
	interpolate,
	Extrapolate,
} from "react-native-reanimated";

import { useLegacyBlurModal } from "@/features/contributionTasks/legacyBlurModal/useLegacyBlurModal";
import { useLogger } from "@/hooks/useLogger";
import { useAPICall } from "@/hooks/useAPICall";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Env } from "@/constants/Env";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { SkeletonShimmer } from "@/components/SkeletonShimmer";
import { useImageLoadWithRetry } from "@/hooks/useImageLoadWithRetry";
import { toErrorLogMessage } from "@/lib/errorMessage";

/* -------------------------------------------------------------------------- */
/*                                    型定義                                   */
/* -------------------------------------------------------------------------- */

// #749 【設計】CDN JSON から取得する候補アイテムの型
type CandidateItem = {
	item_qid: string; // Wikidata QID (例: Q46383)
	label_ja: string; // 例: 寿司（画面では表示しない）
	title: string; // 例: 握り寿司
	subtitle: string; // 例: 溢れんばかりのネタとしゃりの旨みが…
	imageUrl: string;
};

// #749 【設計】CDN JSON のスキーマ
type CandidateJson = CandidateItem[];

/* -------------------------------------------------------------------------- */
/*                              定数・固定値                                   */
/* -------------------------------------------------------------------------- */

const TASK_KEY = "dish_category_manual_text_supply_v1";
const TYPE = "text_feedback";
const TARGET_TYPE = "dish_categories";
const CDN_BASE_URL = "https://storage.googleapis.com/nanitabeyo-public";
const CDN_JSON_PATH = "tickets/749/dish_category_manual_text_supply_v1.latest.json";
// キャッシュ回避のためにクエリパラメータでタイムスタンプを付与
const CDN_JSON_URL = `${CDN_BASE_URL}/${CDN_JSON_PATH}?t=${Date.now()}`;

const TUTORIAL_STORAGE_KEY = "dish_manual_text_supply_tutorial_shown";
const DISMISSED_IDS_STORAGE_KEY = "dish_manual_text_supply_v1_dismissed";

// #749 【設計】スワイプ判定の閾値
const SWIPE_THRESHOLD = 100;

/* -------------------------------------------------------------------------- */
/*                              メインコンポーネント                             */
/* -------------------------------------------------------------------------- */

export default function DishCategoryManualTextSupplyScreen() {
	// #1629 プレースホルダー等、スタイル外へ直接渡す色をテーマへ追従させるために読む
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const insets = useSafeAreaInsets();
	const { width, height } = useWindowDimensions();
	const router = useRouter();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const { showSnackbar } = useSnackbar();
	const { lightImpact, mediumImpact, selectionChanged } = useHaptics();

	// #749 【状態】候補アイテムリスト
	const [allItems, setAllItems] = useState<CandidateItem[]>([]);
	const [currentIndex, setCurrentIndex] = useState(0);
	const [skippedIndices, setSkippedIndices] = useState<number[]>([]);
	const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

	// #749 【状態】ローディング
	const [isLoadingCandidates, setIsLoadingCandidates] = useState(true);
	const [isSubmitting, setIsSubmitting] = useState(false);
	/**
	 * #1205 【修正】貢献タスク送信の多重実行を防ぐ同期ガード。
	 *
	 * `isSubmitting`（useState）は送信ボタンを disabled にする表示用途で、判定には使えない。
	 * 通過すると `POST v1/contribution-tasks` が二重に走る。この API のリポジトリ実装は
	 * 素の `create` で一意制約も無いため、**同じ内容の contribution_tasks 行が 2 件できる**。
	 */
	const isSubmittingRef = useRef(false);

	// #749 【状態】エラー
	const [loadError, setLoadError] = useState<string | null>(null);

	// #749 【状態】チュートリアル
	const [showTutorial, setShowTutorial] = useState(false);

	// #749 【状態】編集モーダル
	const [editingItem, setEditingItem] = useState<CandidateItem | null>(null);
	const [editTitle, setEditTitle] = useState("");
	const [editSubTitle, setEditSubTitle] = useState("");
	const [validationError, setValidationError] = useState("");

	// #749 【状態】完了状態
	const [showReshowButton, setShowReshowButton] = useState(false);
	const [showThanks, setShowThanks] = useState(false);

	// #749 【アニメーション】スワイプ
	const translateX = useSharedValue(0);
	const translateY = useSharedValue(0);

	/* ---- LegacyBlurModal（チュートリアル用） ---- */
	const tutorialModal = useLegacyBlurModal({
		intensity: 80,
		closeOnBackdropPress: false,
	});

	/* ---- LegacyBlurModal（編集モーダル用） ---- */
	const editModal = useLegacyBlurModal({
		intensity: 70,
		closeOnBackdropPress: false,
	});

	/* -------------------------------------------------------------------------- */
	/*                              初期化処理                                    */
	/* -------------------------------------------------------------------------- */

	// #749 【処理】候補JSON読み込み＋除外処理
	const loadCandidates = useCallback(async () => {
		setIsLoadingCandidates(true);
		setLoadError(null);

		try {
			// Step 1: CDN JSONをキャッシュバイパスで取得
			const cdnUrl = CDN_JSON_URL;
			const jsonResponse = await fetch(cdnUrl);
			if (!jsonResponse.ok) {
				throw new Error("Failed to fetch candidate JSON");
			}
			const jsonData: CandidateJson = await jsonResponse.json();

			// Step 2: ローカル除外リストを取得
			let dismissed: string[] = [];
			try {
				const stored = await AsyncStorage.getItem(DISMISSED_IDS_STORAGE_KEY);
				if (stored) {
					dismissed = JSON.parse(stored);
				}
			} catch (err) {
				console.warn("Failed to load dismissed IDs", err);
			}

			// Step 3: 除外処理
			const filteredItems = jsonData.filter((item) => !dismissed.includes(item.item_qid));
			setAllItems(filteredItems);
			setDismissedIds(new Set(dismissed));

			logFrontendEvent({
				event_name: "dish_manual_text_supply_data_loaded",
				error_level: "log",
				payload: { total: jsonData.length, filtered: filteredItems.length },
			});
		} catch (err) {
			console.error("Failed to load candidates", err);
			setLoadError("読み込みに失敗しました");
			logFrontendEvent({
				event_name: "dish_manual_text_supply_data_load_error",
				error_level: "error",
				payload: { error: toErrorLogMessage(err) },
			});
		} finally {
			setIsLoadingCandidates(false);
		}
	}, [logFrontendEvent]);

	// #749 【処理】初回表示時のチュートリアル判定
	useEffect(() => {
		const checkTutorial = async () => {
			try {
				const shown = await AsyncStorage.getItem(TUTORIAL_STORAGE_KEY);
				if (!shown) {
					setShowTutorial(true);
					tutorialModal.open();
					logFrontendEvent({
						event_name: "dish_manual_text_supply_tutorial_shown",
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

		// #749 【ログ】画面表示
		logFrontendEvent({
			event_name: "dish_manual_text_supply_screen_displayed",
			error_level: "log",
			payload: {},
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	/* -------------------------------------------------------------------------- */
	/*                              ローカル永続化                                 */
	/* -------------------------------------------------------------------------- */

	const saveDismissedIds = useCallback(async (ids: Set<string>) => {
		try {
			await AsyncStorage.setItem(DISMISSED_IDS_STORAGE_KEY, JSON.stringify([...ids]));
		} catch (err) {
			console.error("Failed to save dismissed IDs", err);
		}
	}, []);

	/* -------------------------------------------------------------------------- */
	/*                              ヘルプボタン                                  */
	/* -------------------------------------------------------------------------- */

	const handleHelpPress = useCallback(() => {
		setShowTutorial(true);
		tutorialModal.open();
		logFrontendEvent({
			event_name: "dish_manual_text_supply_help_opened",
			error_level: "log",
			payload: {},
		});
	}, [tutorialModal, logFrontendEvent]);

	const closeTutorial = useCallback(async () => {
		tutorialModal.close();
		setShowTutorial(false);
		try {
			await AsyncStorage.setItem(TUTORIAL_STORAGE_KEY, "true");
		} catch (err) {
			console.warn("Failed to save tutorial status", err);
		}
	}, [tutorialModal]);

	/* -------------------------------------------------------------------------- */
	/*                              現在のカード                                  */
	/* -------------------------------------------------------------------------- */

	const currentItem = useMemo(() => {
		if (currentIndex < allItems.length) {
			return allItems[currentIndex];
		}
		return null;
	}, [allItems, currentIndex]);

	/* -------------------------------------------------------------------------- */
	/*                    先読み用 5枚の画像URLリスト                             */
	/* -------------------------------------------------------------------------- */

	useEffect(() => {
		const urls = allItems.slice(currentIndex, currentIndex + 5).map((i) => i.imageUrl);
		Image.prefetch(urls); // これが “先読み” の本命
	}, [allItems, currentIndex]);

	/* -------------------------------------------------------------------------- */
	/*                              スワイプ処理                                  */
	/* -------------------------------------------------------------------------- */

	const moveToNext = useCallback(() => {
		setCurrentIndex((prev) => prev + 1);
		// #749 【設計】UIスレッドで即座にリセット（次のカード表示用）
		translateX.value = withTiming(0, { duration: 0 });
		translateY.value = withTiming(0, { duration: 0 });
	}, [translateX, translateY]);

	// #749 【処理】右スワイプ/右ボタン → OK（ローカル永続化のみ、POSTなし）
	const handleOk = useCallback(() => {
		if (!currentItem) return;

		mediumImpact();
		const newDismissed = new Set(dismissedIds);
		newDismissed.add(currentItem.item_qid);
		setDismissedIds(newDismissed);
		saveDismissedIds(newDismissed);

		logFrontendEvent({
			event_name: "dish_manual_text_supply_ok_confirmed",
			error_level: "log",
			payload: { targetId: currentItem.item_qid },
		});

		moveToNext();
	}, [currentItem, dismissedIds, saveDismissedIds, mediumImpact, logFrontendEvent, moveToNext]);

	// #749 【処理】スキップ（永続化しない）
	const handleSkip = useCallback(() => {
		if (!currentItem) return;

		lightImpact();
		setSkippedIndices((prev) => [...prev, currentIndex]);

		logFrontendEvent({
			event_name: "dish_manual_text_supply_skipped",
			error_level: "log",
			payload: { targetId: currentItem.item_qid },
		});

		moveToNext();
	}, [currentItem, currentIndex, lightImpact, logFrontendEvent, moveToNext]);

	// #749 【処理】左スワイプ/左ボタン → 編集モーダルを開く
	const handleEdit = useCallback(() => {
		if (!currentItem) return;

		lightImpact();
		setEditingItem(currentItem);
		setEditTitle(currentItem.title);
		setEditSubTitle(currentItem.subtitle);
		setValidationError("");
		editModal.open();

		logFrontendEvent({
			event_name: "dish_manual_text_supply_edit_opened",
			error_level: "log",
			payload: { targetId: currentItem.item_qid },
		});
	}, [currentItem, lightImpact, editModal, logFrontendEvent]);

	// #749 【処理】スワイプジェスチャー
	const panGesture = useMemo(
		() =>
			Gesture.Pan()
				.onUpdate((event) => {
					translateX.value = event.translationX;
					translateY.value = event.translationY;
				})
				.onEnd((event) => {
					if (event.translationX > SWIPE_THRESHOLD) {
						// 右スワイプ → OK
						translateX.value = withTiming(1000, { duration: 200 }, () => {
							runOnJS(handleOk)();
						});
					} else if (event.translationX < -SWIPE_THRESHOLD) {
						// 左スワイプ → 編集（UIスレッドで即座にリセット）
						translateX.value = withTiming(-1000, { duration: 200 }, () => {
							runOnJS(handleEdit)();
						});
						// #749 【設計】編集モーダル表示後に位置をリセット（UIスレッドで実行）
						translateX.value = withTiming(0, { duration: 0 });
					} else {
						// 元に戻す
						translateX.value = withSpring(0);
						translateY.value = withSpring(0);
					}
				}),
		[translateX, translateY, handleOk, handleEdit],
	);

	const animatedCardStyle = useAnimatedStyle(() => {
		const rotate = interpolate(translateX.value, [-200, 0, 200], [-10, 0, 10], Extrapolate.CLAMP);

		return {
			transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { rotate: `${rotate}deg` }],
		};
	});

	/* -------------------------------------------------------------------------- */
	/*                              編集モーダル                                  */
	/* -------------------------------------------------------------------------- */

	const validateEdit = useCallback(() => {
		if (!editingItem) return false;

		if (!editTitle.trim() || !editSubTitle.trim()) {
			setValidationError("タイトルとサブタイトルは空にできません");
			return false;
		}

		if (editTitle === editingItem.title && editSubTitle === editingItem.subtitle) {
			setValidationError("少し直してみてください");
			return false;
		}

		setValidationError("");
		return true;
	}, [editingItem, editTitle, editSubTitle]);

	const handleEditSubmit = useCallback(async () => {
		if (!editingItem) return;
		if (!validateEdit()) return;

		// #1205 多重実行の判定は ref で行う（宣言箇所のコメント参照）。
		// バリデーションの early return より後に立てること（手前だと解除されない）
		if (isSubmittingRef.current) return;
		isSubmittingRef.current = true;

		setIsSubmitting(true);
		mediumImpact();

		logFrontendEvent({
			event_name: "dish_manual_text_supply_edit_submit_started",
			error_level: "log",
			payload: { targetId: editingItem.item_qid },
		});

		try {
			await callBackend<any, any>("v1/contribution-tasks", {
				method: "POST",
				requestPayload: {
					type: TYPE,
					taskKey: TASK_KEY,
					targetType: TARGET_TYPE,
					targetId: editingItem.item_qid,
					payload: {
						original: {
							title: editingItem.title,
							subTitle: editingItem.subtitle,
						},
						proposed: {
							title: editTitle,
							subTitle: editSubTitle,
						},
						source: {
							cdnJsonPath: CDN_JSON_PATH,
						},
					},
				},
			});

			// #749 【設計】送信成功時のみローカル永続化
			const newDismissed = new Set(dismissedIds);
			newDismissed.add(editingItem.item_qid);
			setDismissedIds(newDismissed);
			saveDismissedIds(newDismissed);

			showSnackbar("改善案を送信しました！");

			logFrontendEvent({
				event_name: "dish_manual_text_supply_edit_submit_success",
				error_level: "log",
				payload: { targetId: editingItem.item_qid },
			});

			editModal.close();
			setEditingItem(null);
			moveToNext();
		} catch (err) {
			console.error("Failed to submit edit", err);
			showSnackbar("送信に失敗しました");

			logFrontendEvent({
				event_name: "dish_manual_text_supply_edit_submit_error",
				error_level: "error",
				payload: {
					targetId: editingItem.item_qid,
					error: toErrorLogMessage(err),
				},
			});
		} finally {
			// #1205 送信失敗後も押し直せるよう、成功・失敗のいずれでも必ず解除する
			isSubmittingRef.current = false;
			setIsSubmitting(false);
		}
	}, [
		editingItem,
		editTitle,
		editSubTitle,
		validateEdit,
		mediumImpact,
		callBackend,
		dismissedIds,
		saveDismissedIds,
		showSnackbar,
		logFrontendEvent,
		editModal,
		moveToNext,
	]);

	const handleEditClose = useCallback(() => {
		editModal.close();
		setEditingItem(null);

		// #749 【設計】編集モーダルを閉じる際にカード位置をリセット（UIスレッドで実行）
		translateX.value = withTiming(0, { duration: 0 });

		logFrontendEvent({
			event_name: "dish_manual_text_supply_edit_closed",
			error_level: "log",
			payload: { targetId: editingItem?.item_qid },
		});
	}, [editModal, editingItem, translateX, logFrontendEvent]);

	/* -------------------------------------------------------------------------- */
	/*                              完了判定                                      */
	/* -------------------------------------------------------------------------- */

	useEffect(() => {
		if (currentIndex >= allItems.length && !isLoadingCandidates) {
			// 全件終了
			if (skippedIndices.length > 0) {
				setShowReshowButton(true);
			} else {
				setShowThanks(true);
			}
		}
	}, [currentIndex, allItems.length, skippedIndices.length, isLoadingCandidates]);

	const handleReshowSkipped = useCallback(() => {
		setCurrentIndex(skippedIndices[0]);
		setSkippedIndices([]);
		setShowReshowButton(false);
	}, [skippedIndices]);

	/* -------------------------------------------------------------------------- */
	/*                              レンダリング                                  */
	/* -------------------------------------------------------------------------- */

	// #749 【UI】ローディング
	if (isLoadingCandidates) {
		return (
			<View style={[styles.container, { paddingTop: insets.top }]}>
				<ActivityIndicator size="large" color={colors.brandAlt} style={{ marginTop: 100 }} />
				<Text style={styles.loadingText}>読み込み中...</Text>
			</View>
		);
	}

	// #749 【UI】エラー
	if (loadError) {
		return (
			<View style={[styles.container, { paddingTop: insets.top }]}>
				<Text style={styles.errorText}>{loadError}</Text>
				<PrimaryButton label="再試行" onPress={loadCandidates} style={{ marginTop: 20 }} />
			</View>
		);
	}

	// #749 【UI】サンクス画面
	if (showThanks) {
		return (
			<View style={[styles.container, { paddingTop: insets.top }]}>
				<View style={styles.thanksContainer}>
					<Text style={styles.thanksTitle}>ありがとうございました！</Text>
					<Text style={styles.thanksMessage}>
						ご協力ありがとうございました。内容確認後、アプリに反映して、もっとなに食べよを使いやすくしていきます！
					</Text>
					<PrimaryButton label="閉じる" onPress={() => router.back()} style={{ marginTop: 40 }} />
				</View>
			</View>
		);
	}

	// #749 【UI】スキップ再表示ボタン
	if (showReshowButton) {
		return (
			<View style={[styles.container, { paddingTop: insets.top }]}>
				<View style={styles.thanksContainer}>
					<Text style={styles.thanksTitle}>全て確認しました</Text>
					<Text style={styles.thanksMessage}>スキップしたものがあります。もう一度確認しますか？</Text>
					<PrimaryButton label="スキップしたものを再表示" onPress={handleReshowSkipped} style={{ marginTop: 20 }} />
					<Pressable onPress={() => setShowThanks(true)} style={{ marginTop: 20 }}>
						<Text style={styles.skipLink}>今日はこれで終わる</Text>
					</Pressable>
				</View>
			</View>
		);
	}

	const cardHeight = height * 0.6;

	return (
		<View style={[styles.container, { paddingTop: insets.top }]}>
			{/* ヘッダー */}
			<View style={styles.header}>
				<Text style={styles.headerTitle}>文言改善にご協力ください</Text>
				<Pressable onPress={handleHelpPress} hitSlop={10}>
					<HelpCircle size={24} color={colors.textPrimarySoft} />
				</Pressable>
			</View>

			{/* カードエリア */}
			<View style={styles.cardArea}>
				{currentItem ? (
					<GestureDetector gesture={panGesture}>
						<Animated.View style={[animatedCardStyle, { width: width - 32 }]}>
							<CardView item={currentItem} cardHeight={cardHeight} />
						</Animated.View>
					</GestureDetector>
				) : null}
			</View>

			{/* ボタンエリア */}
			{currentItem && (
				<View style={styles.buttonArea}>
					<Pressable style={styles.actionButton} onPress={handleEdit}>
						{/* 塗り潰したボタン（brandAlt）の上の白。地が振れないので文字も振らない */}
						<Edit3 size={24} color={FixedColors.onFilled} />
						<Text style={styles.buttonText}>改善案を送る</Text>
					</Pressable>
					<Pressable style={[styles.actionButton, styles.skipButton]} onPress={handleSkip}>
						<SkipForward size={24} color={colors.textMuted} />
						<Text style={styles.buttonText}>スキップ</Text>
					</Pressable>
					<Pressable style={[styles.actionButton, styles.okButton]} onPress={handleOk}>
						{/* 塗り潰したボタン（successAlt）の上の白 */}
						<Check size={24} color={FixedColors.onFilled} />
						<Text style={styles.buttonText}>このままでOK</Text>
					</Pressable>
				</View>
			)}

			{/* チュートリアルモーダル */}
			{showTutorial && (
				<tutorialModal.LegacyBlurModal contentContainerStyle={styles.modalContent}>
					<View style={styles.tutorialContainer}>
						<Text style={styles.tutorialTitle}>文言改善にご協力ください</Text>
						<Text style={styles.tutorialText}>
							料理カテゴリの説明文をより魅力的に改善します。{"\n\n"}
							<Text style={styles.tutorialBold}>右スワイプ/右ボタン:</Text> このままでOK{"\n"}
							<Text style={styles.tutorialBold}>左スワイプ/左ボタン:</Text> 改善案を送る{"\n"}
							<Text style={styles.tutorialBold}>中央ボタン:</Text> スキップ（後でまた出る）
						</Text>
						<PrimaryButton label="始める" onPress={closeTutorial} style={{ marginTop: 30 }} />
					</View>
				</tutorialModal.LegacyBlurModal>
			)}

			{/* 編集モーダル */}
			{editingItem && (
				<editModal.LegacyBlurModal contentContainerStyle={styles.modalContent} showCloseButton={false}>
					<View style={{ height }}>
						<ScrollView
							style={styles.editContainer}
							keyboardShouldPersistTaps="handled"
							contentContainerStyle={{ paddingBottom: 40 }}>
							<Text style={styles.editTitle}>改善案を入力</Text>

							<Text style={styles.inputLabel}>タイトル</Text>
							<TextInput
								style={styles.textInput}
								value={editTitle}
								onChangeText={setEditTitle}
								placeholder="タイトルを入力"
								// #1629 ダークで既定色（濃いグレー）のまま地に埋もれるため、テーマのトークンを明示する
								placeholderTextColor={colors.textSecondary}
								multiline
							/>

							<Text style={styles.inputLabel}>サブタイトル</Text>
							<TextInput
								style={[styles.textInput, styles.textInputMulti]}
								value={editSubTitle}
								onChangeText={setEditSubTitle}
								placeholder="サブタイトルを入力"
								// #1629 ダークで既定色（濃いグレー）のまま地に埋もれるため、テーマのトークンを明示する
								placeholderTextColor={colors.textSecondary}
								multiline
								numberOfLines={3}
							/>

							{validationError ? <Text style={styles.validationError}>{validationError}</Text> : null}

							{/* プレビュー */}
							<Text style={styles.previewLabel}>プレビュー</Text>
							<View style={{ alignItems: "center" }}>
								<CardView
									item={{
										...editingItem,
										title: editTitle || editingItem.title,
										subtitle: editSubTitle || editingItem.subtitle,
									}}
									cardHeight={300}
									isPreview
								/>
							</View>

							{/* ボタン */}
							<View style={styles.editButtons}>
								<Pressable
									style={[styles.editButton, styles.editButtonSecondary]}
									onPress={handleEditClose}
									disabled={isSubmitting}>
									<Text style={styles.editButtonTextSecondary}>閉じる</Text>
								</Pressable>
								<Pressable
									style={[styles.editButton, styles.editButtonPrimary, isSubmitting && styles.editButtonDisabled]}
									onPress={handleEditSubmit}
									disabled={isSubmitting}>
									{isSubmitting ? (
										<ActivityIndicator size="small" color={FixedColors.onFilled} />
									) : (
										<Text style={styles.editButtonTextPrimary}>送信</Text>
									)}
								</Pressable>
							</View>
						</ScrollView>
					</View>
				</editModal.LegacyBlurModal>
			)}
		</View>
	);
}

/* -------------------------------------------------------------------------- */
/*                              カードコンポーネント                            */
/* -------------------------------------------------------------------------- */

const CardView = ({
	item,
	cardHeight,
	isPreview = false,
}: {
	item: CandidateItem;
	cardHeight: number;
	isPreview?: boolean;
}) => {
	const { logFrontendEvent } = useLogger();
	// #1629 このカードは画面本体とは別コンポーネントなので、ここでもテーマを解決する
	const styles = useThemedStyles(createStyles);
	// #958 【修正】以前は features/dishCategories/constants.ts の CARD_WIDTH(モジュール評価時の
	// window幅で固定、リサイズ非追従)を直接使っていた。本ツールは中央カラム対象外(社内管理画面)
	// のためウィンドウ幅そのままでよいが、削除された CARD_WIDTH の代わりに素の window 幅を使う
	const { width: cardWidth } = useWindowDimensions();

	// #749 【設計】画像ロード管理
	const {
		uri: imageUrl,
		loadState,
		isRetrying,
		handlers,
	} = useImageLoadWithRetry({
		uri: item.imageUrl,
		cacheBustingKey: item.item_qid,
		onErrorCountChange: (count, errorMessage) => {
			if (!isPreview) {
				logFrontendEvent({
					event_name: "dish_manual_text_supply_image_load_error",
					error_level: "log",
					payload: {
						target_id: item.item_qid,
						error_count: count,
						image_url: item.imageUrl,
						error_message: errorMessage,
					},
				});
			}
		},
	});

	const shouldShowSkeleton = loadState === "loading" || isRetrying;

	return (
		<View style={[styles.card, { width: cardWidth - 32, height: cardHeight }]}>
			<Image
				source={{ uri: imageUrl }}
				cachePolicy="memory"
				transition={100}
				style={styles.cardImage}
				onLoadStart={handlers.onLoadStart}
				onLoad={handlers.onLoad}
				onError={handlers.onError}
			/>

			{shouldShowSkeleton && (
				<View style={styles.skeletonOverlay}>
					<SkeletonShimmer width="100%" height="100%" borderRadius={24} />
				</View>
			)}

			{/* Content Overlay */}
			<View style={styles.cardOverlay}>
				<View style={styles.cardContent}>
					<Text style={styles.cardTitle}>{item.title}</Text>
					<Text style={styles.cardDescription}>{item.subtitle}</Text>
				</View>
			</View>
		</View>
	);
};

/* -------------------------------------------------------------------------- */
/*                               スタイル定義                                  */
/* -------------------------------------------------------------------------- */

// #1629 パレットを受け取るファクトリにし、画面側で `useThemedStyles` から呼ぶ（`contexts/ThemeProvider.tsx`）。
const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			backgroundColor: c.backgroundAlt,
		},
		header: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			paddingHorizontal: 20,
			paddingVertical: 16,
		},
		headerTitle: {
			fontSize: 18,
			fontWeight: "700",
			color: c.textPrimarySoft,
		},
		cardArea: {
			flex: 1,
			alignItems: "center",
			justifyContent: "center",
		},
		card: {
			borderRadius: 24,
			overflow: "hidden",
			backgroundColor: c.surfaceSunken,
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 4 },
			shadowOpacity: 0.3,
			shadowRadius: 12,
			elevation: 12,
		},
		cardImage: {
			width: "100%",
			height: "100%",
		},
		skeletonOverlay: {
			position: "absolute",
			top: 0,
			left: 0,
			right: 0,
			bottom: 0,
			zIndex: 1,
		},
		cardOverlay: {
			position: "absolute",
			top: 0,
			left: 0,
			right: 0,
			bottom: 0,
			backgroundColor: "rgba(0, 0, 0, 0.1)",
			padding: 24,
			justifyContent: "flex-end",
			zIndex: 3,
		},
		cardContent: {
			flex: 1,
			justifyContent: "flex-end",
		},
		cardTitle: {
			fontSize: 32,
			fontWeight: "700",
			color: FixedColors.onMedia,
			marginBottom: 16,
			textShadowColor: "rgba(0, 0, 0, 0.8)",
			textShadowOffset: { width: 0, height: 2 },
			textShadowRadius: 4,
			lineHeight: 40,
			letterSpacing: -0.5,
		},
		cardDescription: {
			fontSize: 18,
			color: FixedColors.onMedia,
			lineHeight: 28,
			textShadowColor: "rgba(0, 0, 0, 0.8)",
			textShadowOffset: { width: 0, height: 1 },
			textShadowRadius: 3,
			fontWeight: "500",
		},
		buttonArea: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			paddingHorizontal: 20,
			paddingBottom: 20,
			gap: 12,
		},
		actionButton: {
			flexDirection: "column",
			alignItems: "center",
			height: "100%",
			backgroundColor: c.brandAlt,
			paddingHorizontal: 20,
			paddingVertical: 16,
			borderRadius: 30,
			gap: 8,
			flex: 1,
			justifyContent: "center",
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 2 },
			shadowOpacity: 0.2,
			shadowRadius: 4,
			elevation: 4,
		},
		skipButton: {
			backgroundColor: c.surfaceDisabled,
			paddingHorizontal: 20,
		},
		okButton: {
			backgroundColor: c.successAlt,
		},
		buttonText: {
			fontSize: 12,
			fontWeight: "600",
			color: FixedColors.onFilled,
		},
		loadingText: {
			fontSize: 16,
			color: c.textMuted,
			marginTop: 20,
			textAlign: "center",
		},
		errorText: {
			fontSize: 16,
			color: c.dangerAlt,
			marginTop: 100,
			textAlign: "center",
			paddingHorizontal: 20,
		},
		thanksContainer: {
			flex: 1,
			alignItems: "center",
			justifyContent: "center",
			paddingHorizontal: 40,
		},
		thanksTitle: {
			fontSize: 28,
			fontWeight: "700",
			color: c.textPrimarySoft,
			marginBottom: 20,
			textAlign: "center",
		},
		thanksMessage: {
			fontSize: 16,
			color: c.textMuted,
			lineHeight: 24,
			textAlign: "center",
		},
		skipLink: {
			fontSize: 16,
			color: c.brandAlt,
			textDecorationLine: "underline",
		},
		modalContent: {
			marginHorizontal: 20,
			// #1629 LegacyBlurModal の «本体» の地。膜だけ暗くならないようここもテーマへ追従させる
			backgroundColor: c.surface,
			borderRadius: 16,
			padding: 24,
			maxWidth: 500,
			alignSelf: "center",
			width: "100%",
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 4 },
			shadowOpacity: 0.3,
			shadowRadius: 12,
			elevation: 12,
		},
		tutorialContainer: {
			alignItems: "center",
		},
		tutorialTitle: {
			fontSize: 24,
			fontWeight: "700",
			color: c.textPrimarySoft,
			marginBottom: 20,
			textAlign: "center",
		},
		tutorialText: {
			fontSize: 16,
			color: c.textMuted,
			lineHeight: 24,
			textAlign: "left",
		},
		tutorialBold: {
			fontWeight: "700",
			color: c.textPrimarySoft,
		},
		editContainer: {
			flex: 1,
		},
		editTitle: {
			fontSize: 22,
			fontWeight: "700",
			color: c.textPrimarySoft,
			marginBottom: 20,
			textAlign: "center",
		},
		inputLabel: {
			fontSize: 14,
			fontWeight: "600",
			color: c.textPrimarySoft,
			marginBottom: 8,
			marginTop: 16,
		},
		textInput: {
			borderWidth: 1,
			borderColor: c.borderSoft,
			borderRadius: 8,
			padding: 12,
			fontSize: 16,
			color: c.textPrimarySoft,
			backgroundColor: c.surface,
		},
		textInputMulti: {
			minHeight: 80,
			textAlignVertical: "top",
		},
		validationError: {
			fontSize: 14,
			color: c.dangerAlt,
			marginTop: 8,
		},
		previewLabel: {
			fontSize: 14,
			fontWeight: "600",
			color: c.textPrimarySoft,
			marginTop: 24,
			marginBottom: 12,
		},
		editButtons: {
			flexDirection: "row",
			gap: 12,
			marginTop: 24,
		},
		editButton: {
			flex: 1,
			paddingVertical: 16,
			borderRadius: 8,
			alignItems: "center",
			justifyContent: "center",
		},
		editButtonPrimary: {
			backgroundColor: c.brandAlt,
		},
		editButtonSecondary: {
			backgroundColor: c.surfaceDisabled,
		},
		editButtonDisabled: {
			backgroundColor: c.surfaceDisabledStrong,
		},
		editButtonTextPrimary: {
			fontSize: 16,
			fontWeight: "600",
			color: FixedColors.onFilled,
		},
		editButtonTextSecondary: {
			fontSize: 16,
			fontWeight: "600",
			color: c.textMuted,
		},
	});
