// app-expo/app/[locale]/contribution-tasks/dish-category-manual-image-supply.tsx
//
// #703 【実装】dish category 手動画像供給画面（ポップUI）実装
// ユーザー協力で料理カテゴリの画像を改善するための単体画面

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
	View,
	StyleSheet,
	ScrollView,
	Pressable,
	Text,
	ActivityIndicator,
	useWindowDimensions,
	FlatList,
	NativeScrollEvent,
	NativeSyntheticEvent,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HelpCircle, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";

import { useLegacyBlurModal } from "@/features/contributionTasks/legacyBlurModal/useLegacyBlurModal";
import { useLogger } from "@/hooks/useLogger";
import { useAPICall } from "@/hooks/useAPICall";
import { useFileUploader } from "@/hooks/useFileUploader";
import { selectMedia } from "@/lib/mediaSelection";
import { PrimaryButton } from "@/components/PrimaryButton";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { Env } from "@/constants/Env";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { Dimensions } from "react-native";
import { toErrorLogMessage } from "@/lib/errorMessage";

/* -------------------------------------------------------------------------- */
/*                                    型定義                                   */
/* -------------------------------------------------------------------------- */

// #703 【設計】CDN JSON から取得する候補アイテムの型
// #1553 【互換性】`topicTitle` は公開済み CDN JSON と contribution-tasks API のフィールド名
// （DB 列 topic_title 由来）。データ契約なのでアプリ内リネームの対象外（変えるならデータ側と同時）
type CandidateItem = {
	category_id: string; // dish_category_id (Wikidata QID)
	category: string; // 表示名
	imageUrl: string; // 候補画像
	topicTitle: string; // モーダル下部に表示するタイトル
	reason: string; // モーダル下部に表示する理由
};

// #703 【設計】CDN JSON のスキーマ
type CandidateJson = CandidateItem[];

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

const TARGET_TYPE = "dish_categories";
const TYPE = "image_feedback";
const DEFAULT_TASK_VERSION = "v2";
const TASK_KEY_PREFIX = "dish_category_manual_image_supply";
const CDN_JSON_PATH_PREFIX = "tickets/703/dish_category_manual_image_supply";

const TUTORIAL_STORAGE_KEY = "dish_manual_image_supply_tutorial_shown";

// 一度に表示するアイテム数
const ITEMS_PER_PAGE = 30;
// #703 【設計】チュートリアル2ページ目に表示する9:16画像サンプル（4枚）
const TUTORIAL_EXAMPLE_IMAGES = [
	`https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q483163/22dadd09-d4e6-4e6d-a5bb-5cea3eb1ecb3.webp`,
	`https://i.ibb.co/hJcLYmQf/unnamed-2-1.jpg`,
	`https://i.ibb.co/vx61LhRy/unnamed-1.jpg`,
	`https://i.ibb.co/8g4ZN3nh/unnamed.jpg`,
];

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const PAGE_WIDTH = SCREEN_WIDTH - 48;

type SearchParamValue = string | string[] | undefined;

const firstSearchParam = (value: SearchParamValue): string | undefined => {
	const firstValue = Array.isArray(value) ? value[0] : value;
	const trimmed = firstValue?.trim();
	return trimmed || undefined;
};

const normalizeTaskVersion = (value: string | undefined): string => {
	if (!value) return DEFAULT_TASK_VERSION;
	return value.startsWith("v") ? value : `v${value}`;
};

/* -------------------------------------------------------------------------- */
/*                              メインコンポーネント                             */
/* -------------------------------------------------------------------------- */

export default function DishCategoryManualImageSupplyScreen() {
	const insets = useSafeAreaInsets();
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { width } = useWindowDimensions();
	const router = useRouter();
	const {
		taskVersion: taskVersionParam,
		taskKey: taskKeyParam,
		cdnJsonPath: cdnJsonPathParam,
	} = useLocalSearchParams<{
		taskVersion?: SearchParamValue;
		taskKey?: SearchParamValue;
		cdnJsonPath?: SearchParamValue;
	}>();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const { uploadFile } = useFileUploader();
	const { showSnackbar } = useSnackbar();

	const taskVersion = useMemo(() => normalizeTaskVersion(firstSearchParam(taskVersionParam)), [taskVersionParam]);
	const taskKey = useMemo(
		() => firstSearchParam(taskKeyParam) ?? `${TASK_KEY_PREFIX}_${taskVersion}`,
		[taskKeyParam, taskVersion],
	);
	const cdnJsonPath = useMemo(
		() => firstSearchParam(cdnJsonPathParam) ?? `${CDN_JSON_PATH_PREFIX}_${taskVersion}.latest.json`,
		[cdnJsonPathParam, taskVersion],
	);

	// #703 【状態】候補アイテムリスト（除外後）
	const [items, setItems] = useState<CandidateItem[]>([]);
	// #703 【状態】アイテムごとの状態
	const [itemStates, setItemStates] = useState<Record<string, ItemState>>({});
	// #703 【状態】ローディング
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
	// #703 【状態】エラー
	const [loadError, setLoadError] = useState<string | null>(null);
	// #703 【状態】チュートリアルモーダル
	const [showTutorial, setShowTutorial] = useState(false);
	// #703 【状態】チュートリアルのページ番号（0-indexed）
	const [tutorialPage, setTutorialPage] = useState(0);
	// #703 【状態】サンクス画面表示
	const [showThanks, setShowThanks] = useState(false);
	// #703 【状態】詳細モーダルで選択中のアイテム
	const [selectedItem, setSelectedItem] = useState<CandidateItem | null>(null);

	/* ---- LegacyBlurModal（チュートリアル用） ---- */
	const tutorialModal = useLegacyBlurModal({
		intensity: 80,
		closeOnBackdropPress: false,
	});

	/* ---- LegacyBlurModal（詳細モーダル用） ---- */
	const detailModal = useLegacyBlurModal({
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
			// Step 1: CDN JSONをキャッシュバイパスで取得
			const cdnUrl = `https://${Env.CDN_PUBLIC_HOST}/${cdnJsonPath}?v=${Date.now()}`;
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
							taskKey,
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
			const filteredItems = jsonData
				.filter((item) => !completedIds.includes(item.category_id))
				.slice(0, ITEMS_PER_PAGE); // 一定数に制限
			setItems(filteredItems);

			// Step 4: アイテム状態の初期化
			const initialStates: Record<string, ItemState> = {};
			filteredItems.forEach((item) => {
				initialStates[item.category_id] = { uploadState: "idle" };
			});
			setItemStates(initialStates);
		} catch (err) {
			console.error("Failed to load candidates", err);
			setLoadError("読み込みに失敗しました");
		} finally {
			setIsLoadingCandidates(false);
		}
	}, [callBackend, cdnJsonPath, taskKey]);

	// #703 【処理】候補読み込み
	useEffect(() => {
		loadCandidates();
	}, [loadCandidates]);

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
				payload: { targetId: item.category_id },
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
				payload: { targetId: item.category_id },
			});

			try {
				// 画像選択
				const result = await selectMedia(["images"], {
					allowsEditing: false,
					/*
					#1750 Android の保留結果に «この画面のものだ» という印を付ける。

					⚠️ **この画面は復帰（`recoverPendingMedia`）を実装していない。** 保留結果は
					«どのカテゴリのための画像か» を持たないので、復帰するには対象の id も端末へ
					残す必要があり、そこまでする価値は薄い（貢献者向けの内部画面で、消えても
					もう一度選び直せばよい）。

					それでも印だけは必ず付けること。付けないと、ここで選んだ画像が
					**プロフィール画像やレビュー写真として拾われうる**（lib/mediaSelection.ts 参照）。
					*/
					pendingOwner: "contribution-dish-category-image",
				});

				if (!result.success || !result.media) {
					// キャンセルまたは失敗
					return;
				}

				// アップロード中にセット
				setItemStates((prev) => ({
					...prev,
					[item.category_id]: { ...prev[item.category_id], uploadState: "uploading" },
				}));

				// アップロード
				const { uri, mimeType, width, height } = result.media;
				const fileName = `dish_category_${item.category_id}_${Date.now()}.jpg`;
				const objectPath = await uploadFile(uri, {
					mimeType,
					baseFileName: fileName,
				});

				// 成功
				setItemStates((prev) => ({
					...prev,
					[item.category_id]: {
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
					payload: { targetId: item.category_id, objectPath },
				});
			} catch (err) {
				console.error("Upload failed", err);
				setItemStates((prev) => ({
					...prev,
					[item.category_id]: { ...prev[item.category_id], uploadState: "error" },
				}));

				logFrontendEvent({
					event_name: "dish_manual_image_supply_upload_failed",
					error_level: "error",
					payload: { targetId: item.category_id, error: toErrorLogMessage(err) },
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
			[item.category_id]: { uploadState: "idle", uploaded: undefined },
		}));
	}, []);

	/* -------------------------------------------------------------------------- */
	/*                              送信処理                                      */
	/* -------------------------------------------------------------------------- */

	const handleSubmit = useCallback(async () => {
		// #703 【処理】送信処理（1件ずつPOST）
		const readyItems = items.filter((item) => itemStates[item.category_id]?.uploadState === "success");

		if (readyItems.length === 0) return;

		// #1205 多重実行の判定は ref で行う（宣言箇所のコメント参照）。
		// 早期 return より後、実際の POST より前に立てること
		if (isSubmittingRef.current) return;
		isSubmittingRef.current = true;

		setIsSubmitting(true);
		logFrontendEvent({
			event_name: "dish_manual_image_supply_submit_started",
			error_level: "log",
			payload: { count: readyItems.length },
		});

		let successCount = 0;
		let failCount = 0;

		try {
			for (const item of readyItems) {
				const state = itemStates[item.category_id];
				if (!state?.uploaded) continue;

				try {
					await callBackend<any, any>("v1/contribution-tasks", {
						method: "POST",
						requestPayload: {
							type: TYPE,
							taskKey,
							targetType: TARGET_TYPE,
							targetId: item.category_id,
							payload: {
								category: item.category,
								topicTitle: item.topicTitle,
								reason: item.reason,
								sourceImageUrl: item.imageUrl,
								cdn: { path: cdnJsonPath },
							},
							result: {
								originalPath: state.uploaded.originalPath,
							},
						},
					});
					successCount++;
				} catch (err) {
					// #1599 【バグ】ここで失敗しても uploadState は "success" のまま据え置かれていた。
					// uploadState は «画像をストレージへ上げられたか» であって «送信できたか» ではない。
					// 据え置くと、サンクス画面の remainingItems（uploadState !== "success"）から漏れ、
					// 「もう協力できる料理は無い」と判定されて router.back() される。
					// ユーザーの投稿は誰にも気づかれないまま消える。
					//
					// 送信に失敗した item は "error" へ戻し、«まだ残っている» ものとして扱う。
					// state.uploaded（アップロード済みのパス）は捨てないので、上げ直しにはならない。
					setItemStates((prev) => ({
						...prev,
						[item.category_id]: { ...prev[item.category_id], uploadState: "error" },
					}));
					logFrontendEvent({
						event_name: "dish_manual_image_supply_submit_item_failed",
						error_level: "warn",
						payload: { categoryId: item.category_id, error: toErrorLogMessage(err) },
					});
					failCount++;
				}
			}

			logFrontendEvent({
				event_name: "dish_manual_image_supply_submit_result",
				// #1599 全滅は障害。log のままだと error-triage に乗らず、誰も気づけない
				error_level: failCount > 0 ? "warn" : "log",
				payload: { successCount, failCount },
			});

			// #1599 【バグ】以前は successCount / failCount を一切見ずに無条件で
			// サンクス画面を出していた。全件失敗しても「ありがとうございました」が出るので、
			// ユーザーは貢献できたと思い込む。1 件も通っていないならサンクスは出さない。
			if (successCount === 0) {
				showSnackbar("送信に失敗しました。通信環境を確認して、もう一度お試しください。");
			} else {
				if (failCount > 0) {
					showSnackbar(`${successCount} 件を送信しました。${failCount} 件は失敗したので、もう一度お試しください。`);
				}
				setShowThanks(true);
			}
		} finally {
			// #1205 ⚠️ この try..finally は今回追加した。元は最後に setIsSubmitting(false) を
			// 直接書いており、**ループの途中で例外が抜けると解除されず送信不能のまま固まる**
			// 形だった（各 POST は try..catch で握っているが、それ以外の例外は素通りする）
			isSubmittingRef.current = false;
			setIsSubmitting(false);
		}
	}, [items, itemStates, callBackend, logFrontendEvent, cdnJsonPath, taskKey, showSnackbar]);

	/* -------------------------------------------------------------------------- */
	/*                              サンクス画面                                  */
	/* -------------------------------------------------------------------------- */

	const handleThanksAction = useCallback(() => {
		const remainingItems = items.filter((item) => itemStates[item.category_id]?.uploadState !== "success");

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
		return items.filter((item) => itemStates[item.category_id]?.uploadState === "success").length;
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

	// #703 【コンポーネント】チュートリアルページ1：使い方
	const TutorialPage1 = () => (
		<View style={styles.tutorialPageContainer}>
			<Text style={styles.tutorialPageTitle}>使い方</Text>
			<View style={styles.tutorialStepsContainer}>
				<Text style={styles.tutorialStep}>• 料理カテゴリをタップ</Text>
				<Text style={styles.tutorialStep}>• AIで生成した美味しそうな画像を選択</Text>
				<Text style={styles.tutorialStep}>• 「画像を送信する」ボタンで完了！</Text>
			</View>
		</View>
	);

	// #703 【コンポーネント】チュートリアルページ2：こんな画像が欲しい
	const TutorialPage2 = () => (
		<View style={styles.tutorialPageContainer}>
			<Text style={styles.tutorialPageTitle}>こんな画像が欲しい</Text>
			<View style={styles.tutorialStepsContainer}>
				<Text style={styles.tutorialStep}>• 縦長（9:16）で、料理が主役</Text>
			</View>
			{/* #703 【表示】9:16画像の2×2グリッド */}
			<View style={styles.tutorialImageGrid}>
				{TUTORIAL_EXAMPLE_IMAGES.map((uri, index) => (
					<View key={index} style={styles.tutorialImageWrapper}>
						<Image source={{ uri }} style={styles.tutorialImage} contentFit="cover" />
					</View>
				))}
			</View>
		</View>
	);

	// #703 【コンポーネント】チュートリアルページ3：AI画像生成のやり方
	const TutorialPage3 = () => {
		// #703 【処理】プロンプトをコピー
		const handleCopyPrompt = useCallback(async () => {
			try {
				const promptText =
					"料理名: ★★★ここに料理名を入れる★★★\n\n---\n\n**実在の飲食店で、提供直後に撮影された料理写真。**\n1品のみが写っており、同じ料理が複数並ぶことはない。\n\n料理は\n**その料理が一般的な外食体験において\n「もっとも自然で違和感のない提供方法」**\n（器・盛り付け・台・設備）で提供されている。\n\n迫力のために、\n不自然な器・設備に置き換えられることはない。\n\n---\n\n### 迫力の出し方（ここが肝）\n\n料理の種類に応じて、迫力は以下のいずれかで表現される：\n\n* **設備・熱源・重量感**（焼肉・鉄板系）\n* **完成形の美しさ・質感・艶**（定食・洋食・丼）\n* **量感・立体感・構成**（盛り込み系）\n\n迫力は\n**器を変えることで作らない。**\n料理の本質的な魅力で作る。\n\n---\n\n### 構図・縦長設計（維持）\n\nスマートフォンで縦向きに撮影。\n生成比率は **3:4**、9:16トリミング前提。\n\n* 上下方向に料理の情報が集まる\n* 左右は背景として自然に消える\n* 中央50〜60％に料理が収まる\n\n---\n\n### 器・リアリティ\n\n* 皿料理は **皿で出る**\n* 鉄板料理は **鉄板で出る**\n* 例外的演出は禁止\n\n家庭感・創作感・演出感は禁止。\n**「店でこれが出てきた記憶」と一致することを最優先。**\n\n---\n\n### 禁止事項（v4）\n\n* 迫力目的での鉄板化\n* 常識から外れた提供方法\n* 料理ジャンル無視の器選択\n* AI的演出・過剰な湯気\n";
				await Clipboard.setStringAsync(promptText);
				showSnackbar("プロンプトをコピーしました");

				logFrontendEvent({
					event_name: "dish_manual_image_supply_prompt_copied",
					error_level: "log",
					payload: {},
				});
			} catch (err) {
				console.warn("Failed to copy prompt", err);
			}
		}, [showSnackbar, logFrontendEvent]);

		return (
			<View style={styles.tutorialPageContainer}>
				<Text style={styles.tutorialPageTitle}>AIで画像を作る</Text>
				<View style={styles.tutorialStepsContainer}>
					<Text style={styles.tutorialStep}>• 画像生成アプリで料理名を入れて作ってみてね</Text>
					<Text style={styles.tutorialStep}>• できた画像はこの画面で選んで送信！</Text>
				</View>

				{/* #703 【表示】プロンプト例 */}
				<View style={styles.promptSection}>
					<Text style={styles.promptTitle}>プロンプト例（タップでコピー）</Text>
					<Pressable onPress={handleCopyPrompt} style={styles.promptBox}>
						<Text style={styles.promptText} numberOfLines={10}>
							{
								"料理名: ★★★ここに料理名を入れる★★★\n\n---\n\n**実在の飲食店で、提供直後に撮影された料理写真。**\n1品のみが写っており、同じ料理が複数並ぶことはない。\n\n料理は\n**その料理が一般的な外食体験において\n「もっとも自然で違和感のない提供方法」**\n（器・盛り付け・台・設備）で提供されている。\n\n迫力のために、\n不自然な器・設備に置き換えられることはない。\n\n---\n\n### 迫力の出し方（ここが肝）\n\n料理の種類に応じて、迫力は以下のいずれかで表現される：\n\n* **設備・熱源・重量感**（焼肉・鉄板系）\n* **完成形の美しさ・質感・艶**（定食・洋食・丼）\n* **量感・立体感・構成**（盛り込み系）\n\n迫力は\n**器を変えることで作らない。**\n料理の本質的な魅力で作る。\n\n---\n\n### 構図・縦長設計（維持）\n\nスマートフォンで縦向きに撮影。\n生成比率は **3:4**、9:16トリミング前提。\n\n* 上下方向に料理の情報が集まる\n* 左右は背景として自然に消える\n* 中央50〜60％に料理が収まる\n\n---\n\n### 器・リアリティ\n\n* 皿料理は **皿で出る**\n* 鉄板料理は **鉄板で出る**\n* 例外的演出は禁止\n\n家庭感・創作感・演出感は禁止。\n**「店でこれが出てきた記憶」と一致することを最優先。**\n\n---\n\n### 禁止事項（v4）\n\n* 迫力目的での鉄板化\n* 常識から外れた提供方法\n* 料理ジャンル無視の器選択\n* AI的演出・過剰な湯気\n"
							}
						</Text>
					</Pressable>
				</View>
			</View>
		);
	};

	// #703 【算出】チュートリアルページデータ
	const tutorialPages = useMemo(
		() => [
			{ key: "page1", component: <TutorialPage1 /> },
			{ key: "page2", component: <TutorialPage2 /> },
			{ key: "page3", component: <TutorialPage3 /> },
		],
		// #1629 ここで要素を作り置きするので、テーマが変わったら作り直さないと
		// チュートリアルのページだけ旧テーマのまま残る（ThemeProvider.tsx の JSDoc 参照）。
		[styles],
	);

	// #703 【処理】チュートリアルページスクロール時のページ番号更新
	const handleTutorialScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
		const offsetX = event.nativeEvent.contentOffset.x;
		const currentPage = Math.round(offsetX / PAGE_WIDTH);
		setTutorialPage(currentPage);
	}, []);

	/* -------------------------------------------------------------------------- */
	/*                              レンダリング                                  */
	/* -------------------------------------------------------------------------- */

	// #703 【表示】ローディング中
	if (isLoadingCandidates) {
		return (
			<View style={[styles.container, styles.centered]}>
				<ActivityIndicator size="large" color={colors.accentCoral} />
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
		const hasMoreItems = items.filter((item) => itemStates[item.category_id]?.uploadState !== "success").length > 0;

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
						思わずよだれが出る、美味しそうな料理画像をAIで作って、貼り付けて送信してください！
					</Text>
				</View>
				<Pressable onPress={handleHelpPress} hitSlop={10} style={styles.helpButton}>
					<HelpCircle size={32} color={colors.textMuted} />
				</Pressable>
			</View>

			{/* グリッド */}
			<ScrollView style={styles.scrollView} contentContainerStyle={styles.gridContainer}>
				{items.map((item, index) => {
					const state = itemStates[item.category_id];
					const uploadState = state?.uploadState ?? "idle";
					// #703 【設計】3列目のカードは右マージンなし
					const isLastInRow = (index + 1) % GRID_COLUMNS === 0;

					const imageSource =
						uploadState === "success" && state?.uploaded?.previewUri
							? { uri: state.uploaded.previewUri }
							: { uri: item.imageUrl };

					return (
						<Pressable
							key={item.category_id}
							onPress={() => handleCardPress(item)}
							style={[styles.card, { width: cardWidth, height: cardHeight, marginRight: isLastInRow ? 0 : CARD_GAP }]}>
							<Image source={imageSource} style={styles.cardImage} contentFit="cover" />

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
											<Loader2 size={14} color={FixedColors.onMedia} />
											<Text style={styles.badgeText}>準備中…</Text>
										</View>
									)}
									{uploadState === "success" && (
										<View style={styles.badgeContent}>
											<CheckCircle2 size={14} color={FixedColors.onMedia} />
											<Text style={styles.badgeText}>OK！</Text>
										</View>
									)}
									{uploadState === "error" && (
										<View style={styles.badgeContent}>
											<AlertTriangle size={14} color={FixedColors.onMedia} />
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
			<tutorialModal.LegacyBlurModal showCloseButton={true}>
				<View style={styles.tutorialModal}>
					{/* #703 【表示】ページ化されたチュートリアル（横スワイプ） */}
					<FlatList
						data={tutorialPages}
						horizontal
						pagingEnabled
						showsHorizontalScrollIndicator={false}
						onMomentumScrollEnd={handleTutorialScroll}
						keyExtractor={(item) => item.key}
						renderItem={({ item }) => <View style={[styles.tutorialPageWrapper]}>{item.component}</View>}
						getItemLayout={(_, index) => ({
							length: PAGE_WIDTH,
							offset: PAGE_WIDTH * index,
							index,
						})}
					/>

					{/* #703 【表示】ページインジケーター（ドット3つ） */}
					<View style={styles.pageIndicatorContainer}>
						{tutorialPages.map((_, index) => (
							<View
								key={index}
								style={[styles.pageIndicatorDot, index === tutorialPage && styles.pageIndicatorDotActive]}
							/>
						))}
					</View>

					{/* #703 【ボタン】閉じるボタン */}
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
			</tutorialModal.LegacyBlurModal>

			{/* 詳細モーダル */}
			{selectedItem && (
				<detailModal.LegacyBlurModal showCloseButton={true}>
					<View style={styles.detailModal}>
						{/* 画像 */}
						<View style={styles.detailImageContainer}>
							<Image
								source={{
									uri: itemStates[selectedItem.category_id]?.uploaded?.previewUri ?? selectedItem.imageUrl,
								}}
								style={styles.detailImage}
								contentFit="cover"
							/>
							{/* オーバーレイ */}
							<View style={styles.detailOverlay}>
								<Text style={styles.detailTitle}>{selectedItem.topicTitle}</Text>
								<Text style={styles.detailReason} numberOfLines={3}>
									{selectedItem.reason}
								</Text>
							</View>
						</View>

						{/* ボタン */}
						<View style={styles.detailButtons}>
							{itemStates[selectedItem.category_id]?.uploadState === "success" ? (
								<PrimaryButton
									label="元に戻す"
									onPress={() => handleResetImage(selectedItem)}
									colors={[colors.surface, colors.surface]}
									labelStyle={styles.detailResetButtonText}
									style={styles.detailMainButton}
								/>
							) : (
								<PrimaryButton
									label="画像を選ぶ"
									onPress={() => handleSelectImage(selectedItem)}
									disabled={itemStates[selectedItem.category_id]?.uploadState === "uploading"}
									loading={itemStates[selectedItem.category_id]?.uploadState === "uploading"}
									style={styles.detailMainButton}
								/>
							)}

							{/* 閉じる */}
							<PrimaryButton
								label="閉じる"
								onPress={() => detailModal.close()}
								colors={[colors.surface, colors.surface]}
								labelStyle={styles.detailResetButtonText}
								style={styles.detailMainButton}
							/>

							{/* 状態メッセージ */}
							{itemStates[selectedItem.category_id]?.uploadState === "uploading" && (
								<Text style={styles.detailStatusText}>アップロード中…ちょっと待ってね</Text>
							)}
							{itemStates[selectedItem.category_id]?.uploadState === "error" && (
								<Text style={styles.detailStatusError}>うまくいかなかったみたい。もう一度選んでね</Text>
							)}
						</View>
					</View>
				</detailModal.LegacyBlurModal>
			)}
		</View>
	);
}

/* -------------------------------------------------------------------------- */
/*                              スタイル定義                                  */
/* -------------------------------------------------------------------------- */

// #1629 パレットを受け取るファクトリにし、画面側で `useThemedStyles` から呼ぶ（`contexts/ThemeProvider.tsx`）。
const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			backgroundColor: c.surface,
		},
		centered: {
			justifyContent: "center",
			alignItems: "center",
			padding: 20,
		},
		loadingText: {
			marginTop: 16,
			fontSize: 16,
			color: c.textMuted,
		},
		errorText: {
			fontSize: 16,
			color: c.dangerVivid,
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
			borderBottomColor: c.dividerMuted,
		},
		headerTextContainer: {
			flex: 1,
		},
		headerTitle: {
			fontSize: 20,
			fontWeight: "700",
			color: c.textPrimarySoft,
			marginBottom: 4,
		},
		headerSubtitle: {
			fontSize: 13,
			color: c.textMuted,
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
			backgroundColor: c.surfaceChip,
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
			color: FixedColors.onMedia,
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
			color: FixedColors.onMedia,
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
			borderTopColor: c.dividerMuted,
		},
		footerText: {
			fontSize: 14,
			fontWeight: "600",
			color: c.textPrimarySoft,
		},
		submitButton: {
			paddingHorizontal: 20,
			paddingVertical: 12,
		},
		tutorialModal: {
			// #1629 LegacyBlurModal の «本体» の地。膜（オーバーレイ）だけ暗くならないようここもテーマへ追従させる
			backgroundColor: c.surface,
			borderRadius: 16,
			padding: 24,
			marginHorizontal: 20,
			width: SCREEN_WIDTH,
			alignSelf: "center",
			overflow: "hidden",
		},
		tutorialPageWrapper: {
			width: PAGE_WIDTH,
		},
		tutorialPageContainer: {
			flex: 1,
		},
		tutorialPageContent: {
			padding: 24,
			paddingBottom: 16,
		},
		tutorialPageTitle: {
			fontSize: 22,
			fontWeight: "700",
			color: c.textPrimarySoft,
			marginBottom: 16,
			textAlign: "center",
		},
		tutorialStepsContainer: {
			marginBottom: 20,
		},
		tutorialStep: {
			fontSize: 15,
			color: c.textMuted,
			lineHeight: 24,
			marginBottom: 8,
		},
		tutorialImageGrid: {
			flexDirection: "row",
			flexWrap: "wrap",
			justifyContent: "space-between",
			marginTop: 8,
			marginHorizontal: 16,
		},
		tutorialImageWrapper: {
			width: "40%",
			aspectRatio: 3 / 4,
			borderRadius: 8,
			overflow: "hidden",
			backgroundColor: c.surfaceChip,
			marginBottom: 8,
		},
		tutorialImage: {
			width: "100%",
			height: "100%",
		},
		promptSection: {
			marginTop: 12,
		},
		promptTitle: {
			fontSize: 14,
			fontWeight: "600",
			color: c.textMuted,
			marginBottom: 8,
		},
		promptBox: {
			backgroundColor: c.surfaceChip,
			borderRadius: 8,
			padding: 12,
			borderWidth: 1,
			borderColor: c.borderPale,
		},
		promptText: {
			fontSize: 13,
			color: c.textPrimarySoft,
			lineHeight: 18,
		},
		pageIndicatorContainer: {
			flexDirection: "row",
			justifyContent: "center",
			alignItems: "center",
			paddingVertical: 12,
			gap: 8,
		},
		pageIndicatorDot: {
			width: 8,
			height: 8,
			borderRadius: 4,
			backgroundColor: c.surfaceSunkenStrong,
		},
		pageIndicatorDotActive: {
			backgroundColor: c.accentCoral,
			width: 24,
		},
		tutorialButton: {
			marginHorizontal: 24,
			marginBottom: 24,
			paddingVertical: 14,
		},
		detailModal: {
			// #1629 同上。モーダル本体の地
			backgroundColor: c.surface,
			borderRadius: 16,
			marginHorizontal: 20,
			width: PAGE_WIDTH,
			padding: 16,
			alignSelf: "center",
			alignItems: "center",
			overflow: "hidden",
		},
		detailImageContainer: {
			width: "70%",
			aspectRatio: 9 / 16,
			position: "relative",
		},
		detailImage: {
			width: "100%",
			height: "100%",
		},
		detailOverlay: {
			position: "absolute",
			top: 0,
			left: 0,
			right: 0,
			bottom: 0,
			backgroundColor: "rgba(0, 0, 0, 0.1)", // DishCategoryCard と同じ
			padding: 12, // DishCategoryCard と同じ
			justifyContent: "flex-end", // DishCategoryCard と同じ（上下分離できる）
			zIndex: 3, // DishCategoryCard と同じ（念のため）
		},
		detailTitle: {
			fontSize: 24,
			fontWeight: "700",
			color: FixedColors.onMedia,
			marginBottom: 4,
			textShadowColor: "rgba(0, 0, 0, 0.8)",
			textShadowOffset: { width: 0, height: 2 },
			textShadowRadius: 4,
			lineHeight: 40,
			letterSpacing: -0.5,
		},
		detailReason: {
			fontSize: 18,
			color: FixedColors.onMedia,
			lineHeight: 18,
			marginBottom: 16,
			textShadowColor: "rgba(0, 0, 0, 0.8)",
			textShadowOffset: { width: 0, height: 1 },
			textShadowRadius: 3,
			fontWeight: "500",
		},
		detailButtons: {
			width: "100%",
			padding: 16,
		},
		detailMainButton: {
			paddingVertical: 6,
			marginBottom: 12,
		},
		detailResetButton: {
			paddingVertical: 10,
			alignItems: "center",
			marginBottom: 12,
		},
		detailResetButtonText: {
			color: c.textMuted,
			fontSize: 14,
		},
		detailStatusText: {
			color: c.textMuted,
			fontSize: 13,
			textAlign: "center",
		},
		detailStatusError: {
			color: c.dangerVivid,
			fontSize: 13,
			textAlign: "center",
		},
		thanksTitle: {
			fontSize: 24,
			fontWeight: "700",
			color: c.textPrimarySoft,
			marginBottom: 16,
			textAlign: "center",
		},
		thanksMessage: {
			fontSize: 15,
			color: c.textMuted,
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
