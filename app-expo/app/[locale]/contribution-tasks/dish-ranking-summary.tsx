// app-expo/app/[locale]/contribution-tasks/dish-ranking-summary.tsx
//
// 料理ランキングレビュー
// - 条件プルダウン + ランキング一覧
// - 右下固定「総括コメント」ボタン
// - 各料理行に MessageCircle アイコンで「料理別レビュー」導線
// - HelpCircle（ヘッダ右）で説明モーダル
// - submit log は event_name を統一（dish_ranking_summary_submitted）し、payload.submissionType で判別
//
// なるべく既存実装からの差分を小さくしつつ、ベストプラクティス寄りに整理

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
	View,
	StyleSheet,
	Text,
	Pressable,
	FlatList,
	TextInput,
	ActivityIndicator,
	ScrollView,
	Dimensions,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HelpCircle, ChevronDown, MessageCircle } from "lucide-react-native";
import { generateUUID } from "@/lib/uuid";

import { useLegacyBlurModal } from "@/features/contributionTasks/legacyBlurModal/useLegacyBlurModal";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useLogger } from "@/hooks/useLogger";
import { PrimaryButton } from "@/components/PrimaryButton";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

/* -------------------------------------------------------------------------- */
/*                                    型定義                                   */
/* -------------------------------------------------------------------------- */

type Condition = { key: string; label: string };
type DishRankItem = { qid: string; label: string; image: string | null };

type CdnPayload = {
	conditions: Condition[];
	rankings: Record<string, DishRankItem[]>;
};

type SubmitCommonPayload = {
	sessionId: string;
	startedAt: string;
	submittedAt: string;
	conditionKey: string;
	conditionLabel: string;
	rankedQids: string[];
};

type SubmitSummaryPayload = SubmitCommonPayload & {
	submissionType: "summary";
	comment: string;
};

type SubmitDishPayload = SubmitCommonPayload & {
	submissionType: "dish";
	dishQid: string;
	dishLabel: string;
	dishRank: number; // 1-indexed
	comment: string;
};

type SubmitPayload = SubmitSummaryPayload | SubmitDishPayload;

/* -------------------------------------------------------------------------- */
/*                              定数・固定値                                   */
/* -------------------------------------------------------------------------- */

const CDN_BASE_URL = "https://storage.googleapis.com/nanitabeyo-public";
const CDN_JSON_PATH = "tickets/730/dish-ranking-summary.json";
// キャッシュ回避のためにクエリパラメータでタイムスタンプを付与
const CDN_JSON_URL = `${CDN_BASE_URL}/${CDN_JSON_PATH}?t=${Date.now()}`;

// submissionType ごとのプレースホルダー（例示）
const PLACEHOLDER_SUMMARY = `例:
・この条件だと「軽い/早い」料理が上位のほうが良い
・生姜焼き定食がランキングに無いのは違和感`;

const PLACEHOLDER_DISH = `例:
・もっと上位が良い（理由：早い/満足感）
・順位が高すぎる気がする（理由：重い/コスパ）
・この条件だと食べる頻度が低いので下げたい
・お昼にこの料理は時間がかかるので下げたい`;

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

/* -------------------------------------------------------------------------- */
/*                              メインコンポーネント                             */
/* -------------------------------------------------------------------------- */

export default function DishRankingSummaryScreen() {
	const insets = useSafeAreaInsets();
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { showSnackbar } = useSnackbar();
	const { logFrontendEvent } = useLogger();

	/* ---- State ---- */
	const [isLoading, setIsLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [cdnData, setCdnData] = useState<CdnPayload | null>(null);
	const [selectedConditionKey, setSelectedConditionKey] = useState<string>("");

	// コメントは「条件ごと」に下書きを持つ（条件切替で入力が混ざる事故を防ぐ）
	const [summaryCommentByCondition, setSummaryCommentByCondition] = useState<Record<string, string>>({});
	const [dishCommentByCondition, setDishCommentByCondition] = useState<Record<string, Record<string, string>>>({});

	// モーダル（総括）
	const [isSubmittingSummary, setIsSubmittingSummary] = useState(false);

	// モーダル（料理別）
	const [isSubmittingDish, setIsSubmittingDish] = useState(false);
	const [activeDish, setActiveDish] = useState<{
		qid: string;
		label: string;
		rank: number;
		image: string | null;
	} | null>(null);

	/* ---- Session tracking ---- */
	const sessionId = useMemo(() => generateUUID(), []);
	const startedAt = useMemo(() => new Date().toISOString(), []);

	/* ---- LegacyBlurModal ---- */
	const {
		LegacyBlurModal: SummaryModal,
		open: openSummaryModal,
		close: closeSummaryModal,
	} = useLegacyBlurModal({
		closeOnBackdropPress: false,
	});

	const {
		LegacyBlurModal: DishModal,
		open: openDishModal,
		close: closeDishModal,
	} = useLegacyBlurModal({
		closeOnBackdropPress: false,
	});

	const {
		LegacyBlurModal: ConditionPickerModal,
		open: openConditionPickerModal,
		close: closeConditionPickerModal,
	} = useLegacyBlurModal({
		closeOnBackdropPress: true,
	});

	const {
		LegacyBlurModal: HelpModal,
		open: openHelpModal,
		close: closeHelpModal,
	} = useLegacyBlurModal({
		closeOnBackdropPress: true,
	});

	/* ------------------------------------------------------------------ */
	/*                          CDN データ取得                             */
	/* ------------------------------------------------------------------ */

	useEffect(() => {
		const fetchData = async () => {
			try {
				setIsLoading(true);
				setLoadError(null);

				const response = await fetch(CDN_JSON_URL);
				if (!response.ok) {
					throw new Error(`HTTP ${response.status}: ${response.statusText}`);
				}

				const data: CdnPayload = await response.json();

				if (!data.conditions || !Array.isArray(data.conditions) || data.conditions.length === 0) {
					throw new Error("条件データが不正です");
				}
				if (!data.rankings || typeof data.rankings !== "object") {
					throw new Error("ランキングデータが不正です");
				}

				setCdnData(data);

				// 初期選択：先頭条件
				const firstKey = data.conditions[0].key;
				setSelectedConditionKey(firstKey);

				// 初期の下書き領域も空で用意（後段の参照で undefined を減らす）
				setSummaryCommentByCondition((prev) => ({ ...prev, [firstKey]: prev[firstKey] ?? "" }));
				setDishCommentByCondition((prev) => ({ ...prev, [firstKey]: prev[firstKey] ?? {} }));

				await logFrontendEvent({
					event_name: "dish_ranking_summary_loaded",
					error_level: "log",
					payload: { conditionCount: data.conditions.length },
				});
			} catch (error: any) {
				const errorMsg = error?.message || "Unknown error";
				setLoadError(errorMsg);
				await logFrontendEvent({
					event_name: "dish_ranking_summary_load_error",
					error_level: "error",
					payload: { error: errorMsg },
				});
			} finally {
				setIsLoading(false);
			}
		};

		fetchData();
	}, [logFrontendEvent]);

	/* ------------------------------------------------------------------ */
	/*                          現在選択中のデータ                          */
	/* ------------------------------------------------------------------ */

	const selectedCondition = useMemo(() => {
		if (!cdnData) return null;
		return cdnData.conditions.find((c) => c.key === selectedConditionKey) || null;
	}, [cdnData, selectedConditionKey]);

	const currentRankingItems = useMemo(() => {
		if (!cdnData || !selectedConditionKey) return [];
		return cdnData.rankings[selectedConditionKey] || [];
	}, [cdnData, selectedConditionKey]);

	const rankedQids = useMemo(() => currentRankingItems.map((item) => item.qid), [currentRankingItems]);

	// 現条件の下書き参照（未定義を極力避ける）
	const summaryDraft = summaryCommentByCondition[selectedConditionKey] ?? "";
	const dishDraftMap = dishCommentByCondition[selectedConditionKey] ?? {};

	/* ------------------------------------------------------------------ */
	/*                          条件切替                                  */
	/* ------------------------------------------------------------------ */

	const handleConditionChange = useCallback(
		async (key: string) => {
			setSelectedConditionKey(key);

			// 条件ごとの下書き領域を確保（存在しない場合だけ作る）
			setSummaryCommentByCondition((prev) => ({ ...prev, [key]: prev[key] ?? "" }));
			setDishCommentByCondition((prev) => ({ ...prev, [key]: prev[key] ?? {} }));

			closeConditionPickerModal();

			await logFrontendEvent({
				event_name: "dish_ranking_summary_condition_changed",
				error_level: "log",
				payload: { conditionKey: key },
			});
		},
		[logFrontendEvent, closeConditionPickerModal],
	);

	/* ------------------------------------------------------------------ */
	/*                          モーダルオープン                            */
	/* ------------------------------------------------------------------ */

	const handleOpenSummaryModal = useCallback(async () => {
		openSummaryModal();
		await logFrontendEvent({
			event_name: "dish_ranking_summary_comment_modal_opened",
			error_level: "log",
			payload: { conditionKey: selectedConditionKey, submissionType: "summary" },
		});
	}, [openSummaryModal, logFrontendEvent, selectedConditionKey]);

	const handleOpenDishModal = useCallback(
		async (dish: DishRankItem, rank: number) => {
			setActiveDish({ qid: dish.qid, label: dish.label, image: dish.image, rank });
			openDishModal();

			await logFrontendEvent({
				event_name: "dish_ranking_summary_comment_modal_opened",
				error_level: "log",
				payload: { conditionKey: selectedConditionKey, submissionType: "dish", dishQid: dish.qid, dishRank: rank },
			});
		},
		[openDishModal, logFrontendEvent, selectedConditionKey],
	);

	const handleOpenHelp = useCallback(async () => {
		openHelpModal();
		await logFrontendEvent({
			event_name: "dish_ranking_summary_help_opened",
			error_level: "log",
			payload: { conditionKey: selectedConditionKey },
		});
	}, [openHelpModal, logFrontendEvent, selectedConditionKey]);

	/* ------------------------------------------------------------------ */
	/*                          送信（共通ヘルパ）                           */
	/* ------------------------------------------------------------------ */

	const buildCommonPayload = useCallback((): SubmitCommonPayload | null => {
		if (!selectedCondition) return null;
		return {
			sessionId,
			startedAt,
			submittedAt: new Date().toISOString(),
			conditionKey: selectedConditionKey,
			conditionLabel: selectedCondition.label,
			rankedQids,
		};
	}, [selectedCondition, sessionId, startedAt, selectedConditionKey, rankedQids]);

	/* ------------------------------------------------------------------ */
	/*                          送信（総括）                                */
	/* ------------------------------------------------------------------ */

	const handleSubmitSummary = useCallback(async () => {
		const common = buildCommonPayload();
		if (!common) {
			showSnackbar("条件が選択されていません");
			return;
		}

		const comment = (summaryCommentByCondition[selectedConditionKey] ?? "").trim();
		if (comment.length < 1) {
			showSnackbar("コメントを入力してください");
			return;
		}

		try {
			setIsSubmittingSummary(true);

			const payload: SubmitSummaryPayload = {
				...common,
				submissionType: "summary",
				comment,
			};

			await logFrontendEvent({
				event_name: "dish_ranking_summary_submitted",
				error_level: "log",
				payload,
			});

			showSnackbar("送信しました");
			closeSummaryModal();

			// 送信後は当該条件の下書きをクリア（好みに応じて保持でもOK）
			setSummaryCommentByCondition((prev) => ({ ...prev, [selectedConditionKey]: "" }));
		} catch (error: any) {
			const errorMsg = error?.message || "Unknown error";
			showSnackbar("送信に失敗しました。もう一度お試しください。");
			await logFrontendEvent({
				event_name: "dish_ranking_summary_submit_error",
				error_level: "error",
				payload: { error: errorMsg, submissionType: "summary" },
			});
		} finally {
			setIsSubmittingSummary(false);
		}
	}, [
		buildCommonPayload,
		summaryCommentByCondition,
		selectedConditionKey,
		logFrontendEvent,
		showSnackbar,
		closeSummaryModal,
	]);

	/* ------------------------------------------------------------------ */
	/*                          送信（料理別）                               */
	/* ------------------------------------------------------------------ */

	const handleSubmitDish = useCallback(async () => {
		const common = buildCommonPayload();
		if (!common) {
			showSnackbar("条件が選択されていません");
			return;
		}

		if (!activeDish) {
			showSnackbar("料理が選択されていません");
			return;
		}

		const draft = dishCommentByCondition[selectedConditionKey]?.[activeDish.qid] ?? "";
		const comment = draft.trim();
		if (comment.length < 1) {
			showSnackbar("コメントを入力してください");
			return;
		}

		try {
			setIsSubmittingDish(true);

			const payload: SubmitDishPayload = {
				...common,
				submissionType: "dish",
				dishQid: activeDish.qid,
				dishLabel: activeDish.label,
				dishRank: activeDish.rank,
				comment,
			};

			await logFrontendEvent({
				event_name: "dish_ranking_summary_submitted",
				error_level: "log",
				payload,
			});

			showSnackbar("送信しました");
			closeDishModal();

			// 送信後は当該料理の下書きをクリア
			setDishCommentByCondition((prev) => ({
				...prev,
				[selectedConditionKey]: {
					...(prev[selectedConditionKey] ?? {}),
					[activeDish.qid]: "",
				},
			}));

			setActiveDish(null);
		} catch (error: any) {
			const errorMsg = error?.message || "Unknown error";
			showSnackbar("送信に失敗しました。もう一度お試しください。");
			await logFrontendEvent({
				event_name: "dish_ranking_summary_submit_error",
				error_level: "error",
				payload: { error: errorMsg, submissionType: "dish", dishQid: activeDish.qid },
			});
		} finally {
			setIsSubmittingDish(false);
		}
	}, [
		buildCommonPayload,
		activeDish,
		dishCommentByCondition,
		selectedConditionKey,
		logFrontendEvent,
		showSnackbar,
		closeDishModal,
	]);

	/* ------------------------------------------------------------------ */
	/*                          ランキングアイテム描画                       */
	/* ------------------------------------------------------------------ */

	const renderRankingItem = useCallback(
		({ item, index }: { item: DishRankItem; index: number }) => {
			const rank = index + 1;

			return (
				<View style={styles.rankItem}>
					<View style={styles.rankNumber}>
						<Text style={styles.rankNumberText}>{rank}</Text>
					</View>

					{item.image ? (
						<Image source={{ uri: item.image }} style={styles.dishImage} contentFit="cover" />
					) : (
						<View style={[styles.dishImage, styles.dishImagePlaceholder]} />
					)}

					<Text style={styles.dishLabel} numberOfLines={2}>
						{item.label}
					</Text>

					{/* 料理別レビュー導線（MessageCircle） */}
					<Pressable
						style={styles.dishReviewButton}
						onPress={() => handleOpenDishModal(item, rank)}
						hitSlop={8}
						accessibilityRole="button"
						accessibilityLabel="この料理にコメントする">
						<MessageCircle size={18} color={colors.brand} />
					</Pressable>
				</View>
			);
		},
		[handleOpenDishModal, styles, colors],
	);

	/* ------------------------------------------------------------------ */
	/*                          ローディング・エラー表示                     */
	/* ------------------------------------------------------------------ */

	if (isLoading) {
		return (
			<View style={styles.centerContainer}>
				<ActivityIndicator size="large" color={colors.brand} />
				<Text style={styles.loadingText}>データを読み込み中...</Text>
			</View>
		);
	}

	if (loadError) {
		return (
			<View style={styles.centerContainer}>
				<Text style={styles.errorText}>データの読み込みに失敗しました</Text>
				<Text style={styles.errorDetail}>{loadError}</Text>
			</View>
		);
	}

	if (!cdnData || !selectedCondition) {
		return (
			<View style={styles.centerContainer}>
				<Text style={styles.errorText}>データが不正です</Text>
			</View>
		);
	}

	/* ------------------------------------------------------------------ */
	/*                          メイン UI                                 */
	/* ------------------------------------------------------------------ */

	return (
		<View style={[styles.container, { paddingTop: insets.top }]}>
			{/* ヘッダー */}
			<View style={styles.header}>
				<Text style={styles.headerTitle}>料理ランキングレビュー</Text>

				{/* 右側：ヘルプアイコン */}
				<Pressable style={styles.helpButton} onPress={handleOpenHelp} hitSlop={8}>
					<HelpCircle size={20} color={colors.textPrimarySoft} />
				</Pressable>
			</View>

			{/* 条件プルダウン */}
			<Pressable style={styles.conditionSelector} onPress={openConditionPickerModal}>
				<Text style={styles.conditionLabel}>{selectedCondition.label}</Text>
				<ChevronDown size={20} color={colors.textPrimarySoft} />
			</Pressable>

			{/* ランキング一覧 */}
			{currentRankingItems.length === 0 ? (
				<View style={styles.emptyContainer}>
					<Text style={styles.emptyText}>ランキング準備中</Text>
				</View>
			) : (
				<FlatList
					data={currentRankingItems}
					keyExtractor={(item) => item.qid}
					renderItem={renderRankingItem}
					// 右下固定ボタンに隠れないよう下に余白を追加
					contentContainerStyle={[styles.listContent, { paddingBottom: 16 + FLOATING_BUTTON_HEIGHT + insets.bottom }]}
					showsVerticalScrollIndicator={false}
				/>
			)}

			{/* 右下固定：総括コメントボタン */}
			<View pointerEvents="box-none" style={styles.floatingContainer}>
				<Pressable
					style={[styles.floatingButton, { marginBottom: insets.bottom + 16 }]}
					onPress={handleOpenSummaryModal}>
					<Text style={styles.floatingButtonText}>総括コメント</Text>
				</Pressable>
			</View>

			{/* 総括コメント入力モーダル */}
			<SummaryModal contentContainerStyle={styles.modalContent}>
				<View style={styles.modalInner}>
					<Text style={styles.modalTitle}>総括コメント</Text>

					{/* 選択中条件を表示（混乱防止） */}
					<View style={styles.conditionChip}>
						<Text style={styles.conditionChipText}>条件: {selectedCondition.label}</Text>
					</View>

					<Text style={styles.modalDescription}>この条件に対する総括を入力してください。</Text>

					<TextInput
						style={styles.commentInput}
						placeholder={PLACEHOLDER_SUMMARY}
						placeholderTextColor={colors.iconPlaceholder}
						value={summaryDraft}
						onChangeText={(text) =>
							setSummaryCommentByCondition((prev) => ({
								...prev,
								[selectedConditionKey]: text,
							}))
						}
						multiline
						numberOfLines={8}
						textAlignVertical="top"
					/>

					<View style={styles.modalButtons}>
						<Pressable style={styles.cancelButton} onPress={closeSummaryModal} disabled={isSubmittingSummary}>
							<Text style={styles.cancelButtonText}>キャンセル</Text>
						</Pressable>
						<PrimaryButton
							label="送信"
							onPress={handleSubmitSummary}
							loading={isSubmittingSummary}
							disabled={summaryDraft.trim().length < 1 || isSubmittingSummary}
							style={styles.submitButton}
						/>
					</View>
				</View>
			</SummaryModal>

			{/* 料理別コメント入力モーダル */}
			<DishModal contentContainerStyle={styles.modalContent}>
				<View style={styles.modalInner}>
					<Text style={styles.modalTitle}>料理別レビュー</Text>

					{/* 選択中条件を表示 */}
					<View style={styles.conditionChip}>
						<Text style={styles.conditionChipText}>条件: {selectedCondition.label}</Text>
					</View>

					{/* 料理情報（料理名・順位） */}
					{activeDish ? (
						<View style={styles.dishHeaderRow}>
							{activeDish.image ? (
								<Image source={{ uri: activeDish.image }} style={styles.dishHeaderImage} contentFit="cover" />
							) : (
								<View style={[styles.dishHeaderImage, styles.dishImagePlaceholder]} />
							)}
							<View style={{ flex: 1 }}>
								<Text style={styles.dishHeaderTitle} numberOfLines={2}>
									{activeDish.label}
								</Text>
								<Text style={styles.dishHeaderSub}>現在の順位: {activeDish.rank}位</Text>
							</View>
						</View>
					) : (
						<Text style={styles.modalDescription}>料理が選択されていません。</Text>
					)}

					<Text style={styles.modalDescription}>この料理の順位について、感じたことを入力してください。</Text>

					<TextInput
						style={styles.commentInput}
						placeholder={PLACEHOLDER_DISH}
						placeholderTextColor={colors.iconPlaceholder}
						value={activeDish ? (dishDraftMap[activeDish.qid] ?? "") : ""}
						onChangeText={(text) => {
							if (!activeDish) return;
							setDishCommentByCondition((prev) => ({
								...prev,
								[selectedConditionKey]: {
									...(prev[selectedConditionKey] ?? {}),
									[activeDish.qid]: text,
								},
							}));
						}}
						multiline
						numberOfLines={8}
						textAlignVertical="top"
					/>

					<View style={styles.modalButtons}>
						<Pressable
							style={styles.cancelButton}
							onPress={() => {
								closeDishModal();
								setActiveDish(null);
							}}
							disabled={isSubmittingDish}>
							<Text style={styles.cancelButtonText}>キャンセル</Text>
						</Pressable>
						<PrimaryButton
							label="送信"
							onPress={handleSubmitDish}
							loading={isSubmittingDish}
							disabled={!activeDish || (dishDraftMap[activeDish.qid] ?? "").trim().length < 1 || isSubmittingDish}
							style={styles.submitButton}
						/>
					</View>
				</View>
			</DishModal>

			{/* 条件選択モーダル */}
			<ConditionPickerModal contentContainerStyle={styles.pickerModalContent}>
				<View style={styles.pickerInner}>
					<Text style={styles.pickerTitle}>条件を選択</Text>
					<ScrollView style={styles.pickerScroll}>
						{cdnData.conditions.map((condition) => (
							<Pressable
								key={condition.key}
								style={[styles.pickerItem, condition.key === selectedConditionKey && styles.pickerItemSelected]}
								onPress={() => handleConditionChange(condition.key)}>
								<Text
									style={[
										styles.pickerItemText,
										condition.key === selectedConditionKey && styles.pickerItemTextSelected,
									]}>
									{condition.label}
								</Text>
							</Pressable>
						))}
					</ScrollView>
				</View>
			</ConditionPickerModal>

			{/* ヘルプモーダル */}
			<HelpModal contentContainerStyle={styles.modalContent}>
				<View style={styles.modalInner}>
					<Text style={styles.modalTitle}>この画面について</Text>
					<Text style={styles.helpText}>
						・条件（例: 夜ご飯 × 一人）ごとの料理ランキングを表示します。
						{"\n"}・右下の「総括コメント」から、ランキング全体へのコメントを送れます。
						{"\n"}・各料理行の吹き出しアイコンから、料理単体へのレビューを送れます。
						{"\n"}※条件のプルダウンは、実際に利用されている出現順で並べています。
					</Text>
					<View style={styles.modalButtons}>
						<PrimaryButton label="閉じる" onPress={closeHelpModal} loading={false} disabled={false} />
					</View>
				</View>
			</HelpModal>
		</View>
	);
}

/* -------------------------------------------------------------------------- */
/*                               スタイル定義                                  */
/* -------------------------------------------------------------------------- */

// 右下固定ボタンの高さ（余白計算に使う）
const FLOATING_BUTTON_HEIGHT = 44;

// #1629 パレットを受け取るファクトリにし、画面側で `useThemedStyles` から呼ぶ（`contexts/ThemeProvider.tsx`）。
const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			backgroundColor: c.surface,
		},
		centerContainer: {
			flex: 1,
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
			fontSize: 18,
			fontWeight: "bold",
			color: c.dangerAlt,
			marginBottom: 8,
			textAlign: "center",
		},
		errorDetail: {
			fontSize: 14,
			color: c.textMuted,
			textAlign: "center",
		},

		/* ---- Header ---- */
		header: {
			flexDirection: "row",
			alignItems: "center",
			paddingHorizontal: 16,
			paddingVertical: 12,
			borderBottomWidth: 1,
			borderBottomColor: c.dividerMuted,
		},
		headerTitle: {
			flex: 1,
			fontSize: 18,
			fontWeight: "bold",
			color: c.textPrimarySoft,
		},
		helpButton: {
			padding: 8,
		},

		/* ---- Condition selector ---- */
		conditionSelector: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			paddingHorizontal: 16,
			paddingVertical: 12,
			marginHorizontal: 16,
			marginTop: 12,
			backgroundColor: c.surfaceChip,
			borderRadius: 8,
			borderWidth: 1,
			borderColor: c.borderSoft,
		},
		conditionLabel: {
			fontSize: 16,
			color: c.textPrimarySoft,
			fontWeight: "500",
		},

		/* ---- List ---- */
		listContent: {
			padding: 16,
		},
		rankItem: {
			flexDirection: "row",
			alignItems: "center",
			padding: 12,
			marginBottom: 8,
			backgroundColor: c.surfaceFaintAlt,
			borderRadius: 8,
			borderWidth: 1,
			borderColor: c.dividerMuted,
		},
		rankNumber: {
			width: 32,
			height: 32,
			borderRadius: 16,
			backgroundColor: c.brand,
			justifyContent: "center",
			alignItems: "center",
			marginRight: 12,
		},
		rankNumberText: {
			color: FixedColors.onFilled,
			fontSize: 14,
			fontWeight: "bold",
		},
		dishImage: {
			width: 56,
			height: 56,
			borderRadius: 8,
			backgroundColor: c.surfaceSunken,
			marginRight: 12,
		},
		dishImagePlaceholder: {
			backgroundColor: c.surfaceSunkenStrong,
		},
		dishLabel: {
			flex: 1,
			fontSize: 15,
			color: c.textPrimarySoft,
		},
		dishReviewButton: {
			padding: 8,
			borderRadius: 999,
			backgroundColor: "rgba(240,85,55,0.08)",
			marginLeft: 8,
		},

		emptyContainer: {
			flex: 1,
			justifyContent: "center",
			alignItems: "center",
			padding: 40,
		},
		emptyText: {
			fontSize: 16,
			color: c.iconPlaceholder,
		},

		/* ---- Floating summary button ---- */
		floatingContainer: {
			position: "absolute",
			left: 0,
			right: 0,
			bottom: 0,
			paddingHorizontal: 16,
			// pointerEvents は上で box-none にして、ボタンだけ押せるようにする
		},
		floatingButton: {
			alignSelf: "flex-end",
			height: FLOATING_BUTTON_HEIGHT,
			paddingHorizontal: 16,
			borderRadius: 999,
			backgroundColor: c.brand,
			justifyContent: "center",
			alignItems: "center",
			// 影（iOS/Android）
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 2 },
			shadowOpacity: 0.18,
			shadowRadius: 4,
			elevation: 4,
		},
		floatingButtonText: {
			color: FixedColors.onFilled,
			fontSize: 14,
			fontWeight: "bold",
		},

		/* ---- Modals ---- */
		modalContent: {
			justifyContent: "center",
			alignItems: "center",
			padding: 20,
		},
		modalInner: {
			width: "100%",
			maxWidth: 420,
			// #1629 LegacyBlurModal の «本体» の地。膜だけ暗くならないようここもテーマへ追従させる
			backgroundColor: c.surface,
			borderRadius: 16,
			padding: 24,
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 2 },
			shadowOpacity: 0.25,
			shadowRadius: 4,
			elevation: 5,
		},
		modalTitle: {
			fontSize: 20,
			fontWeight: "bold",
			color: c.textPrimarySoft,
			marginBottom: 8,
		},
		modalDescription: {
			fontSize: 14,
			color: c.textMuted,
			marginBottom: 16,
		},

		// 条件チップ（モーダル内）
		conditionChip: {
			alignSelf: "flex-start",
			paddingHorizontal: 10,
			paddingVertical: 6,
			borderRadius: 999,
			backgroundColor: c.surfaceChip,
			borderWidth: 1,
			borderColor: c.dividerMuted,
			marginBottom: 12,
		},
		conditionChipText: {
			fontSize: 12,
			color: c.textSecondaryDim,
			fontWeight: "600",
		},

		// 料理別モーダルのヘッダ（料理情報）
		dishHeaderRow: {
			flexDirection: "row",
			alignItems: "center",
			marginBottom: 12,
			gap: 12,
		},
		dishHeaderImage: {
			width: 52,
			height: 52,
			borderRadius: 10,
			backgroundColor: c.surfaceSunken,
		},
		dishHeaderTitle: {
			fontSize: 16,
			fontWeight: "700",
			color: c.textPrimarySoft,
			marginBottom: 2,
		},
		dishHeaderSub: {
			fontSize: 12,
			color: c.textMuted,
		},

		commentInput: {
			borderWidth: 1,
			borderColor: c.borderSoft,
			borderRadius: 8,
			padding: 12,
			fontSize: 14,
			// #1629 未指定だと OS 既定の «黒» のままで、ダークでは地に埋もれて読めない
			color: c.textStrong,
			minHeight: 240,
			backgroundColor: c.surfaceFaintAlt,
			marginBottom: 16,
		},
		modalButtons: {
			flexDirection: "row",
			justifyContent: "flex-end",
			gap: 12,
		},
		cancelButton: {
			paddingHorizontal: 20,
			paddingVertical: 10,
			borderRadius: 8,
			backgroundColor: c.surfaceSunken,
		},
		cancelButtonText: {
			fontSize: 14,
			fontWeight: "bold",
			color: c.textMuted,
		},
		submitButton: {
			flex: 1,
		},

		/* ---- Picker modal ---- */
		pickerModalContent: {
			alignItems: "center",
			padding: 20,
		},
		pickerInner: {
			width: "100%",
			maxWidth: 400,
			// LegacyBlurModal では % で高さ指定すると画面全体の % になるため、Dimensions API から計算して指定
			maxHeight: SCREEN_HEIGHT * 0.7,
			// #1629 LegacyBlurModal の «本体» の地。膜だけ暗くならないようここもテーマへ追従させる
			backgroundColor: c.surface,
			borderRadius: 16,
			padding: 24,
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 2 },
			shadowOpacity: 0.25,
			shadowRadius: 4,
			elevation: 5,
		},
		pickerTitle: {
			fontSize: 18,
			fontWeight: "bold",
			color: c.textPrimarySoft,
			marginBottom: 16,
		},
		pickerScroll: {
			flex: 1,
		},
		pickerItem: {
			paddingVertical: 16,
			paddingHorizontal: 16,
			borderRadius: 8,
			marginBottom: 8,
			backgroundColor: c.surfaceChip,
		},
		pickerItemSelected: {
			backgroundColor: c.brand,
		},
		pickerItemText: {
			fontSize: 16,
			color: c.textPrimarySoft,
		},
		pickerItemTextSelected: {
			color: FixedColors.onFilled,
			fontWeight: "bold",
		},

		/* ---- Help ---- */
		helpText: {
			fontSize: 14,
			color: c.textPrimaryMuted,
			lineHeight: 20,
			marginBottom: 16,
		},
	});
