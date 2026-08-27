// app-expo/app/[locale]/contribution-tasks/dish-copy-survey.tsx
//
// #559 料理コピー調査アンケート（10枚カルーセル＋LegacyBlurModal）実装
// 運営用ツール - 各料理画像にタイトル+タグラインを選択してもらう

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { FixedColors, type Palette } from "@/constants/Palette";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import {
	View,
	StyleSheet,
	Text,
	Pressable,
	ScrollView,
	TextInput,
	useWindowDimensions,
	TouchableOpacity,
	Modal,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HelpCircle, CheckCircle2, Circle } from "lucide-react-native";
import { Carousel } from "react-native-reanimated-carousel";
import { generateUUID } from "@/lib/uuid";

import { useLegacyBlurModal } from "@/features/contributionTasks/legacyBlurModal/useLegacyBlurModal";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Env } from "@/constants/Env";

/* -------------------------------------------------------------------------- */
/*                                    型定義                                   */
/* -------------------------------------------------------------------------- */

/** 候補コピー情報 */
type CandidateCopy = {
	type: "五感直撃型" | "欲望肯定型" | "感情スイッチ型";
	title: string;
	tagline: string;
};

/** 料理データ（CDNから取得） */
type DishData = {
	qid: string;
	label: string;
	image: string;
	candidates: CandidateCopy[];
};

/** 食べたくなる度 */
type AppetiteLevel = "want_now" | "ok" | "no";

/** コピー選択モード */
type SelectionMode = "candidate" | "custom";

/** 刺さったポイント理由 */
type ReasonKey = "imagined_taste" | "concise" | "decisive" | "exciting" | "calming" | "self_permission";

/** 刺さらなかった理由 */
type RejectedReason = "not_appealing" | "no_image" | "too_long" | "too_strong" | "generic";

/** モーダル内の回答状態 */
type ModalAnswer = {
	selectedMode: SelectionMode | null;
	selectedSource: "五感直撃型" | "欲望肯定型" | "感情スイッチ型" | null;
	customTitle: string;
	customTagline: string;
	appetite: AppetiteLevel | null;
	reasons: ReasonKey[];
	reasonFree: string;
	rejectedReason: RejectedReason | null;
	rejectedFree: string;
};

/** 確定済み回答 */
type FinalAnswer = {
	dishQid: string;
	selectedMode: SelectionMode;
	selectedSource: "五感直撃型" | "欲望肯定型" | "感情スイッチ型" | null;
	finalTitle: string;
	finalTagline: string;
	appetite: AppetiteLevel;
	reasons: ReasonKey[];
	reasonFree: string;
	rejectedReason: RejectedReason | null;
	rejectedFree: string;
	modalOpenedAt: string;
	modalClosedAt: string;
	modalDurationMs: number;
	timeToFirstSelectionMs: number;
	selectionChangedCount: number;
};

/** 送信用ペイロード */
type SubmitPayload = {
	sessionId: string;
	startedAt: string;
	submittedAt: string;
	answers: FinalAnswer[];
};

/* -------------------------------------------------------------------------- */
/*                                定数・文言                                   */
/* -------------------------------------------------------------------------- */

// CDNベースURL（環境変数から取得、フォールバック付き）
const CDN_BASE_URL = Env.CDN_PUBLIC_HOST || "https://storage.googleapis.com/nanitabeyo-static";
const CDN_JSON_URL = `https://${CDN_BASE_URL}/tickets/559/dish-copy-survey-data.json`;

// 【仕様】多言語対応は不要（日本語固定文言でOK）- issue要件より
const APPETITE_LABELS: Record<AppetiteLevel, string> = {
	want_now: "いま食べたい",
	ok: "食べてもいい",
	no: "食べたくない",
};

const REASON_LABELS: Record<ReasonKey, string> = {
	imagined_taste: "口の中が想像できた（香り/食感/温度）",
	concise: "言葉が短くてスッと入った",
	decisive: '"これだ"って決めやすかった',
	exciting: "気分が上がった / ワクワクした",
	calming: "ほっとした / 落ち着いた",
	self_permission: "自分にOK出せた感じがした（ご褒美・背徳の肯定）",
};

const REJECTED_LABELS: Record<RejectedReason, string> = {
	not_appealing: "そそられない",
	no_image: "イメージが湧かない",
	too_long: "くどい/長い",
	too_strong: "強すぎる/押しつけ",
	generic: "ありきたり",
};

const HELP_TEXT = `各カードをタップして、料理コピー（タイトル＋タグライン）を選んでください。

10枚すべて選択すると送信できます。

候補から選ぶか、自分で入力することもできます。`;

const COMPLETION_MESSAGE = `ご協力ありがとうございました！

この内容をもとに、より食べたいと思ってもらえる料理コピーにしたいと思います！

送信は完了しております。

本日もご安全にお過ごしください。`;

/* -------------------------------------------------------------------------- */
/*                                  メインページ                               */
/* -------------------------------------------------------------------------- */

export default function DishCopySurveyPage() {
	// #1629 プレースホルダー等、スタイル外へ直接渡す色をテーマへ追従させるために読む
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const insets = useSafeAreaInsets();
	const { width: screenWidth, height: screenHeight } = useWindowDimensions();
	const { showSnackbar } = useSnackbar();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const {
		LegacyBlurModal: AnswerBlurModal,
		open: answerOpen,
		close: answerClose,
	} = useLegacyBlurModal({
		intensity: 80,
		closeOnBackdropPress: false,
	});

	// データ取得関連
	const [isLoading, setIsLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [dishes, setDishes] = useState<DishData[]>([]);

	// セッション情報
	const [sessionId] = useState(() => generateUUID());
	const [startedAt] = useState(() => new Date().toISOString());

	// 回答管理
	const [answers, setAnswers] = useState<Map<string, FinalAnswer>>(new Map());
	const [currentIndex, setCurrentIndex] = useState(0);
	const [selectedDish, setSelectedDish] = useState<DishData | null>(null);

	// 送信完了管理
	const [isCompleted, setIsCompleted] = useState(false);

	// モーダル関連
	const [showHelp, setShowHelp] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);

	// カルーセルサイズ計算（9:16）
	const PADDING = 0;
	const carouselHeight = screenHeight - 68 - 36 - 100 - PADDING * 2;
	const carouselWidth = (carouselHeight * 9) / 16;

	/* ------------------------------------------------------------------ */
	/*                             データ取得                              */
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

				const data: DishData[] = await response.json();
				if (!Array.isArray(data) || data.length === 0) {
					throw new Error("Invalid data format or empty array");
				}

				// シャッフルしてセット
				setDishes(data.sort(() => Math.random() - 0.5));

				logFrontendEvent({
					event_name: "dish_copy_survey_data_loaded",
					error_level: "log",
					payload: { count: data.length },
				});
			} catch (error: any) {
				const errorMsg = error?.message || "Unknown error";
				setLoadError(errorMsg);
				logFrontendEvent({
					event_name: "dish_copy_survey_data_load_error",
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
	/*                             進捗計算                               */
	/* ------------------------------------------------------------------ */

	const answeredCount = answers.size;
	const totalCount = dishes.length;
	const allAnswered = answeredCount === totalCount && totalCount > 0;

	/* ------------------------------------------------------------------ */
	/*                          カード表示ロジック                          */
	/* ------------------------------------------------------------------ */

	const openAnswerModal = useCallback(
		(dish: DishData) => {
			lightImpact();
			setSelectedDish(dish);
			answerOpen();
		},
		[lightImpact],
	);

	const renderCard = useCallback(
		(dish: DishData) => {
			const answer = answers.get(dish.qid);
			const isAnswered = !!answer;

			return (
				<Pressable
					key={dish.qid}
					style={[styles.card, { width: carouselWidth, height: carouselHeight }]}
					onPress={() => openAnswerModal(dish)}>
					<Image source={{ uri: dish.image }} style={styles.cardImage} contentFit="cover" />

					{/* 未回答バッジ */}
					<View style={styles.badgeContainer}>
						{isAnswered ? (
							<View style={styles.badge}>
								<CheckCircle2 size={20} color={colors.successAlt} />
								<Text style={styles.badgeTextAnswered}>回答済み</Text>
							</View>
						) : (
							<View style={[styles.badge, styles.badgeUnanswered]}>
								<Circle size={20} color={colors.warningAccent} />
								<Text style={styles.badgeTextUnanswered}>未</Text>
							</View>
						)}
					</View>

					{/* 下部コピー表示エリア */}
					<View style={styles.cardFooter}>
						{isAnswered ? (
							<>
								<Text style={styles.cardTitle} numberOfLines={2}>
									{answer.finalTitle}
								</Text>
								<Text style={styles.cardTagline} numberOfLines={2}>
									{answer.finalTagline}
								</Text>
							</>
						) : (
							<Text style={styles.cardPrompt}>画像をタップしてコピーを選ぶ</Text>
						)}
					</View>
				</Pressable>
			);
		},
		[answers, carouselWidth, carouselHeight, openAnswerModal, styles, colors],
	);

	/* ------------------------------------------------------------------ */
	/*                             送信処理                               */
	/* ------------------------------------------------------------------ */

	const handleSubmit = useCallback(async () => {
		if (!allAnswered) return;

		try {
			setIsSubmitting(true);
			lightImpact();

			const payload: SubmitPayload = {
				sessionId,
				startedAt,
				submittedAt: new Date().toISOString(),
				answers: Array.from(answers.values()).map((ans) => ({
					...ans,
					// ラベル変換
					appetiteLabel: APPETITE_LABELS[ans.appetite],
					reasonLabels: ans.reasons.map((r) => REASON_LABELS[r]),
					rejectedLabel: ans.rejectedReason ? REJECTED_LABELS[ans.rejectedReason] : null,
				})),
			};

			logFrontendEvent({
				event_name: "dish_copy_survey_submitted",
				error_level: "log",
				payload,
			});

			// 送信成功後、完了メッセージ表示
			setIsCompleted(true);
		} catch (error: any) {
			showSnackbar("送信に失敗しました。もう一度お試しください。");
			logFrontendEvent({
				event_name: "dish_copy_survey_submit_error",
				error_level: "error",
				payload: { error: error?.message },
			});
		} finally {
			setIsSubmitting(false);
		}
	}, [allAnswered, sessionId, startedAt, answers, lightImpact, logFrontendEvent, showSnackbar]);

	/* ------------------------------------------------------------------ */
	/*                             レンダリング                            */
	/* ------------------------------------------------------------------ */

	// ローディング表示
	if (isLoading) {
		return (
			<View style={[styles.container, styles.centerContent]}>
				<LoadingIndicator size="large" />
				<Text style={styles.loadingText}>データを読み込んでいます...</Text>
			</View>
		);
	}

	// エラー表示
	if (loadError) {
		return (
			<View style={[styles.container, styles.centerContent]}>
				<Text style={styles.errorText}>データの取得に失敗しました</Text>
				<Text style={styles.errorDetail}>{loadError}</Text>
			</View>
		);
	}

	return (
		<View style={[styles.container, { paddingTop: insets.top }]}>
			{/* 完了メッセージ */}
			{isCompleted ? (
				<View style={styles.modalContent}>
					<Text style={styles.modalTitle}>送信完了</Text>
					<Text style={styles.modalText}>{COMPLETION_MESSAGE}</Text>
				</View>
			) : (
				<>
					{/* ヘッダー */}
					<View style={styles.header}>
						<View style={styles.headerLeft}>
							<Text style={styles.headerTitle}>料理コピーアンケート</Text>
							<Text style={styles.progressText}>
								{answeredCount} / {totalCount}
							</Text>
						</View>
						<TouchableOpacity onPress={() => setShowHelp(true)} style={styles.helpButton}>
							<HelpCircle size={28} color={colors.brand} />
						</TouchableOpacity>
					</View>

					{/* 進捗インジケータ（ドット） */}
					<View style={styles.dotsContainer}>
						{dishes.map((dish, index) => {
							const isAnswered = answers.has(dish.qid);
							const isCurrent = index === currentIndex;
							return (
								<View
									key={dish.qid}
									style={[styles.dot, isAnswered && styles.dotAnswered, isCurrent && styles.dotCurrent]}
								/>
							);
						})}
					</View>

					{/* カルーセル */}
					<View style={styles.carouselContainer}>
						{/* #1156 carousel v5: width/height は style へ、mode/modeConfig は layout へ移行。
						    v5 は loop の既定が false になったため、v4 の挙動を保つよう明示する。 */}
						<Carousel
							data={dishes}
							renderItem={({ item }) => renderCard(item)}
							onSnapToItem={setCurrentIndex}
							loop
							layout={{
								type: "parallax",
								scale: 0.9,
								offset: 100,
							}}
							style={{ width: carouselWidth, height: carouselHeight }}
						/>
					</View>

					{/* 送信ボタン */}
					<View style={styles.submitContainer}>
						<PrimaryButton
							label={isSubmitting ? "送信中..." : "送信する"}
							onPress={handleSubmit}
							disabled={!allAnswered || isSubmitting}
							loading={isSubmitting}
							style={styles.submitButton}
						/>
						{!allAnswered && <Text style={styles.submitHint}>すべての料理にコピーを選択すると送信できます</Text>}
					</View>
				</>
			)}

			{/* 説明モーダル */}
			<Modal visible={showHelp} transparent animationType="fade" onRequestClose={() => setShowHelp(false)}>
				<Pressable style={styles.modalOverlay} onPress={() => setShowHelp(false)}>
					<View style={styles.modalContent}>
						<Text style={styles.modalTitle}>使い方</Text>
						<Text style={styles.modalText}>{HELP_TEXT}</Text>
						<PrimaryButton label="閉じる" onPress={() => setShowHelp(false)} />
					</View>
				</Pressable>
			</Modal>

			{/* 回答モーダル */}
			<AnswerBlurModal>
				{selectedDish && (
					<AnswerModal
						dish={selectedDish}
						existingAnswer={answers.get(selectedDish.qid)}
						onClose={() => {
							setSelectedDish(null);
							answerClose();
						}}
						onSave={(answer) => {
							setAnswers(new Map(answers.set(selectedDish.qid, answer)));
							setSelectedDish(null);
							lightImpact();
						}}
					/>
				)}
			</AnswerBlurModal>
		</View>
	);
}

/* -------------------------------------------------------------------------- */
/*                              回答モーダルコンポーネント                        */
/* -------------------------------------------------------------------------- */

type AnswerModalProps = {
	dish: DishData;
	existingAnswer?: FinalAnswer;
	onClose: () => void;
	onSave: (answer: FinalAnswer) => void;
};

function AnswerModal({ dish, existingAnswer, onClose, onSave }: AnswerModalProps) {
	// #1629 プレースホルダー等、スタイル外へ直接渡す色をテーマへ追従させるために読む
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { height: windowHeight } = useWindowDimensions();

	// モーダル計測用
	const [modalOpenedAt] = useState(() => new Date().toISOString());
	const firstSelectionTimeRef = useRef<number | null>(null);
	const selectionCountRef = useRef(0);
	const previousModeRef = useRef<SelectionMode | null>(null);

	// フォーム状態
	const [state, setState] = useState<ModalAnswer>(() => {
		if (existingAnswer) {
			return {
				selectedMode: existingAnswer.selectedMode,
				selectedSource: existingAnswer.selectedSource,
				customTitle: existingAnswer.selectedMode === "custom" ? existingAnswer.finalTitle : "",
				customTagline: existingAnswer.selectedMode === "custom" ? existingAnswer.finalTagline : "",
				appetite: existingAnswer.appetite,
				reasons: existingAnswer.reasons,
				reasonFree: existingAnswer.reasonFree,
				rejectedReason: existingAnswer.rejectedReason,
				rejectedFree: existingAnswer.rejectedFree,
			};
		}
		return {
			selectedMode: null,
			selectedSource: null,
			customTitle: "",
			customTagline: "",
			appetite: null,
			reasons: [],
			reasonFree: "",
			rejectedReason: null,
			rejectedFree: "",
		};
	});

	useEffect(() => {
		// クリーンアップ: モーダルアンマウント時にrefをクリア
		return () => {
			firstSelectionTimeRef.current = null;
			selectionCountRef.current = 0;
			previousModeRef.current = null;
		};
	}, []);

	/* ------------------------------------------------------------------ */
	/*                         選択モード変更処理                          */
	/* ------------------------------------------------------------------ */

	const handleModeChange = useCallback(
		(mode: SelectionMode, source?: "五感直撃型" | "欲望肯定型" | "感情スイッチ型") => {
			// 初回選択時刻を記録
			if (firstSelectionTimeRef.current === null) {
				firstSelectionTimeRef.current = Date.now();
			}

			// 変更カウント
			if (previousModeRef.current !== null && previousModeRef.current !== mode) {
				selectionCountRef.current += 1;
			} else if (mode === "candidate" && state.selectedSource && state.selectedSource !== source) {
				selectionCountRef.current += 1;
			}

			previousModeRef.current = mode;

			if (mode === "candidate" && source) {
				setState((prev) => ({ ...prev, selectedMode: mode, selectedSource: source }));
			} else if (mode === "custom") {
				setState((prev) => ({ ...prev, selectedMode: mode, selectedSource: null }));
			}
		},
		[state.selectedSource],
	);

	/* ------------------------------------------------------------------ */
	/*                         バリデーション                             */
	/* ------------------------------------------------------------------ */

	const isValid = useMemo(() => {
		// 必須：食べたくなる度
		if (!state.appetite) return false;

		// 必須：コピー選択
		if (state.selectedMode === "candidate" && !state.selectedSource) return false;
		if (state.selectedMode === "custom" && (!state.customTitle.trim() || !state.customTagline.trim())) {
			return false;
		}
		if (!state.selectedMode) return false;

		return true;
	}, [state]);

	/* ------------------------------------------------------------------ */
	/*                           決定処理                                */
	/* ------------------------------------------------------------------ */

	const handleDecide = useCallback(() => {
		if (!isValid || !state.selectedMode || !state.appetite) return;

		const modalClosedAt = new Date().toISOString();
		const openedTime = new Date(modalOpenedAt).getTime();
		const closedTime = new Date(modalClosedAt).getTime();
		const durationMs = closedTime - openedTime;
		const firstSelectionMs = firstSelectionTimeRef.current ? firstSelectionTimeRef.current - openedTime : 0;

		let finalTitle = "";
		let finalTagline = "";

		if (state.selectedMode === "candidate" && state.selectedSource) {
			const candidate = dish.candidates.find((c) => c.type === state.selectedSource);
			if (candidate) {
				finalTitle = candidate.title;
				finalTagline = candidate.tagline;
			}
		} else if (state.selectedMode === "custom") {
			finalTitle = state.customTitle.trim();
			finalTagline = state.customTagline.trim();
		}

		const answer: FinalAnswer = {
			dishQid: dish.qid,
			selectedMode: state.selectedMode,
			selectedSource: state.selectedSource,
			finalTitle,
			finalTagline,
			appetite: state.appetite,
			reasons: state.reasons,
			reasonFree: state.reasonFree.trim(),
			rejectedReason: state.rejectedReason,
			rejectedFree: state.rejectedFree.trim(),
			modalOpenedAt,
			modalClosedAt,
			modalDurationMs: durationMs,
			timeToFirstSelectionMs: firstSelectionMs,
			selectionChangedCount: selectionCountRef.current,
		};

		onClose();
		setTimeout(() => onSave(answer), 300);
	}, [isValid, state, dish, modalOpenedAt, onSave]);

	const handleClose = useCallback(() => {
		onClose();
		setTimeout(() => onClose(), 300);
	}, [onClose]);

	/* ------------------------------------------------------------------ */
	/*                           レンダリング                             */
	/* ------------------------------------------------------------------ */

	return (
		<ScrollView style={{ height: windowHeight * 0.9 }} contentContainerStyle={styles.modalScrollContent}>
			{/* タイトル */}
			<Text style={styles.modalSectionTitle}>料理コピーを選んでください</Text>

			{/* 候補選択 */}
			<View style={styles.section}>
				{dish.candidates.map((candidate) => {
					const isSelected = state.selectedMode === "candidate" && state.selectedSource === candidate.type;
					return (
						<Pressable
							key={candidate.type}
							style={[styles.candidateCard, isSelected && styles.candidateCardSelected]}
							onPress={() => handleModeChange("candidate", candidate.type)}>
							<View style={styles.candidateHeader}>
								{isSelected ? (
									<CheckCircle2 size={24} color={colors.brand} />
								) : (
									<Circle size={24} color={colors.iconPlaceholder} />
								)}
								<Text style={styles.candidateTitle}>{candidate.title}</Text>
							</View>
							<Text style={styles.candidateTagline}>{candidate.tagline}</Text>
						</Pressable>
					);
				})}

				{/* Custom入力 */}
				<Pressable
					style={[styles.candidateCard, state.selectedMode === "custom" && styles.candidateCardSelected]}
					onPress={() => handleModeChange("custom")}>
					<View style={styles.candidateHeader}>
						{state.selectedMode === "custom" ? (
							<CheckCircle2 size={24} color={colors.brand} />
						) : (
							<Circle size={24} color={colors.iconPlaceholder} />
						)}
						<Text style={styles.candidateLabel}>自分で書く</Text>
					</View>
					{state.selectedMode === "custom" && (
						<View style={styles.customInputs}>
							<TextInput
								style={styles.textInput}
								placeholder="タイトル（必須）"
								// #1629 ダークで既定色（濃いグレー）のまま地に埋もれるため、テーマのトークンを明示する
								placeholderTextColor={colors.textSecondary}
								value={state.customTitle}
								onChangeText={(text) => setState((prev) => ({ ...prev, customTitle: text }))}
								multiline
							/>
							<TextInput
								style={styles.textInput}
								placeholder="タグライン（必須）"
								// #1629 ダークで既定色（濃いグレー）のまま地に埋もれるため、テーマのトークンを明示する
								placeholderTextColor={colors.textSecondary}
								value={state.customTagline}
								onChangeText={(text) => setState((prev) => ({ ...prev, customTagline: text }))}
								multiline
							/>
						</View>
					)}
				</Pressable>
			</View>

			{/* 食べたくなる度 */}
			<View style={styles.section}>
				<Text style={styles.sectionTitle}>食べたくなる度（必須）</Text>
				{(["want_now", "ok", "no"] as AppetiteLevel[]).map((level) => {
					const isSelected = state.appetite === level;
					return (
						<Pressable
							key={level}
							style={[styles.radioItem, isSelected && styles.radioItemSelected]}
							onPress={() => setState((prev) => ({ ...prev, appetite: level }))}>
							{isSelected ? (
								<CheckCircle2 size={20} color={colors.brand} />
							) : (
								<Circle size={20} color={colors.iconPlaceholder} />
							)}
							<Text style={styles.radioLabel}>{APPETITE_LABELS[level]}</Text>
						</Pressable>
					);
				})}
			</View>

			{/* 刺さったポイント */}
			<View style={styles.section}>
				<Text style={styles.sectionTitle}>刺さったポイント（任意・複数選択可）</Text>
				{(Object.keys(REASON_LABELS) as ReasonKey[]).map((key) => {
					const isChecked = state.reasons.includes(key);
					return (
						<Pressable
							key={key}
							style={[styles.checkItem, isChecked && styles.checkItemSelected]}
							onPress={() => {
								setState((prev) => ({
									...prev,
									reasons: isChecked ? prev.reasons.filter((r) => r !== key) : [...prev.reasons, key],
								}));
							}}>
							{isChecked ? (
								<CheckCircle2 size={20} color={colors.brand} />
							) : (
								<Circle size={20} color={colors.iconPlaceholder} />
							)}
							<Text style={styles.checkLabel}>{REASON_LABELS[key]}</Text>
						</Pressable>
					);
				})}
				<TextInput
					style={styles.textArea}
					placeholder="その他の理由（任意）"
					// #1629 ダークで既定色（濃いグレー）のまま地に埋もれるため、テーマのトークンを明示する
					placeholderTextColor={colors.textSecondary}
					value={state.reasonFree}
					onChangeText={(text) => setState((prev) => ({ ...prev, reasonFree: text }))}
					multiline
					numberOfLines={3}
				/>
			</View>

			{/* 刺さらなかった理由 */}
			<View style={styles.section}>
				<Text style={styles.sectionTitle}>他の候補が刺さらなかった理由（任意）</Text>
				{(Object.keys(REJECTED_LABELS) as RejectedReason[]).map((key) => {
					const isSelected = state.rejectedReason === key;
					return (
						<Pressable
							key={key}
							style={[styles.radioItem, isSelected && styles.radioItemSelected]}
							onPress={() =>
								setState((prev) => ({
									...prev,
									rejectedReason: isSelected ? null : key,
								}))
							}>
							{isSelected ? (
								<CheckCircle2 size={20} color={colors.brand} />
							) : (
								<Circle size={20} color={colors.iconPlaceholder} />
							)}
							<Text style={styles.radioLabel}>{REJECTED_LABELS[key]}</Text>
						</Pressable>
					);
				})}
				<TextInput
					style={styles.textArea}
					placeholder="その他の理由（任意）"
					// #1629 ダークで既定色（濃いグレー）のまま地に埋もれるため、テーマのトークンを明示する
					placeholderTextColor={colors.textSecondary}
					value={state.rejectedFree}
					onChangeText={(text) => setState((prev) => ({ ...prev, rejectedFree: text }))}
					multiline
					numberOfLines={3}
				/>
			</View>

			{/* 決定ボタン */}
			<View style={styles.buttonContainer}>
				<PrimaryButton label="決定" onPress={handleDecide} disabled={!isValid} style={styles.decideButton} />
				<TouchableOpacity onPress={handleClose} style={styles.cancelButton}>
					<Text style={styles.cancelButtonText}>キャンセル</Text>
				</TouchableOpacity>
			</View>
		</ScrollView>
	);
}

/* -------------------------------------------------------------------------- */
/*                                  スタイル                                   */
/* -------------------------------------------------------------------------- */

// #1629 パレットを受け取るファクトリにし、画面側で `useThemedStyles` から呼ぶ（`contexts/ThemeProvider.tsx`）。
const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			backgroundColor: c.backgroundAlt,
		},
		centerContent: {
			justifyContent: "center",
			alignItems: "center",
		},
		loadingText: {
			marginTop: 16,
			fontSize: 16,
			color: c.textMuted,
		},
		errorText: {
			fontSize: 18,
			fontWeight: "bold",
			color: c.dangerBright,
			textAlign: "center",
			marginBottom: 8,
		},
		errorDetail: {
			fontSize: 14,
			color: c.iconPlaceholder,
			textAlign: "center",
			paddingHorizontal: 24,
		},
		header: {
			flexDirection: "row",
			justifyContent: "space-between",
			alignItems: "center",
			paddingHorizontal: 24,
			paddingVertical: 16,
		},
		headerLeft: {
			flexDirection: "row",
			alignItems: "center",
			gap: 12,
		},
		headerTitle: {
			fontSize: 20,
			fontWeight: "bold",
			color: c.textPrimarySoft,
		},
		progressText: {
			fontSize: 18,
			fontWeight: "600",
			color: c.brand,
		},
		helpButton: {
			padding: 4,
		},
		dotsContainer: {
			flexDirection: "row",
			justifyContent: "center",
			alignItems: "center",
			gap: 8,
			paddingVertical: 12,
		},
		dot: {
			width: 8,
			height: 8,
			borderRadius: 4,
			backgroundColor: c.surfaceSunkenStrong,
			borderWidth: 1,
			borderColor: c.borderSubtle,
		},
		dotAnswered: {
			backgroundColor: c.successAlt,
			borderColor: c.successAlt,
		},
		dotCurrent: {
			width: 12,
			height: 12,
			borderRadius: 6,
			borderWidth: 2,
		},
		carouselContainer: {
			flex: 1,
			justifyContent: "center",
			alignItems: "center",
			paddingVertical: 16,
		},
		card: {
			position: "absolute",
			top: 0,
			left: 0,
			right: 0,
			bottom: 0,
			backgroundColor: "rgba(0, 0, 0, 0.2)",
			borderRadius: 16,
			overflow: "hidden",
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 4 },
			shadowOpacity: 0.1,
			shadowRadius: 8,
			elevation: 4,
		},
		cardImage: {
			flex: 1,
		},
		badgeContainer: {
			position: "absolute",
			top: 12,
			right: 12,
		},
		badge: {
			flexDirection: "row",
			alignItems: "center",
			gap: 4,
			backgroundColor: "rgba(255,255,255,0.95)",
			paddingHorizontal: 10,
			paddingVertical: 6,
			borderRadius: 16,
		},
		badgeUnanswered: {
			backgroundColor: "rgba(255,152,0,0.95)",
		},
		badgeTextAnswered: {
			fontSize: 12,
			fontWeight: "600",
			color: c.successAlt,
		},
		badgeTextUnanswered: {
			fontSize: 12,
			fontWeight: "600",
			// 橙で塗り潰したバッジの上の白。地が振れないので文字も振らない
			color: FixedColors.onFilled,
		},
		cardFooter: {
			position: "absolute",
			bottom: 0,
			left: 0,
			right: 0,
			padding: 16,
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
		cardTagline: {
			fontSize: 18,
			color: FixedColors.onMedia,
			lineHeight: 28,
			marginBottom: 16,
			textShadowColor: "rgba(0, 0, 0, 0.8)",
			textShadowOffset: { width: 0, height: 1 },
			textShadowRadius: 3,
			fontWeight: "500",
		},
		cardPrompt: {
			fontSize: 16,
			fontWeight: "600",
			color: FixedColors.onMedia,
			textAlign: "center",
		},
		submitContainer: {
			paddingHorizontal: 24,
			paddingVertical: 16,
			backgroundColor: c.surface,
			borderTopWidth: 1,
			borderTopColor: c.borderPale,
		},
		submitButton: {
			width: "100%",
		},
		submitHint: {
			marginTop: 8,
			fontSize: 12,
			color: c.iconPlaceholder,
			textAlign: "center",
		},
		modalOverlay: {
			flex: 1,
			backgroundColor: "rgba(0,0,0,0.5)",
			justifyContent: "center",
			alignItems: "center",
			padding: 24,
		},
		modalContent: {
			backgroundColor: c.surface,
			borderRadius: 16,
			padding: 24,
			width: "100%",
			maxWidth: 400,
		},
		modalTitle: {
			fontSize: 20,
			fontWeight: "bold",
			color: c.textPrimarySoft,
			marginBottom: 16,
			textAlign: "center",
		},
		modalText: {
			fontSize: 16,
			color: c.textMuted,
			lineHeight: 24,
			marginBottom: 24,
		},
		modalScrollContent: {
			padding: 24,
		},
		modalSectionTitle: {
			fontSize: 22,
			fontWeight: "bold",
			color: c.textPrimarySoft,
			marginBottom: 16,
			textAlign: "center",
		},
		section: {
			marginBottom: 24,
		},
		sectionTitle: {
			fontSize: 16,
			fontWeight: "600",
			color: c.textPrimarySoft,
			marginBottom: 12,
		},
		candidateCard: {
			backgroundColor: c.surfaceFaintAlt,
			borderRadius: 12,
			padding: 16,
			marginBottom: 12,
			borderWidth: 2,
			borderColor: "transparent",
		},
		candidateCardSelected: {
			backgroundColor: c.surfaceSelectedInfo,
			borderColor: c.brand,
		},
		candidateHeader: {
			flexDirection: "row",
			alignItems: "center",
			gap: 8,
			marginBottom: 8,
		},
		candidateLabel: {
			fontSize: 14,
			fontWeight: "600",
			color: c.textMuted,
		},
		candidateTitle: {
			fontSize: 16,
			fontWeight: "bold",
			color: c.textPrimarySoft,
			marginBottom: 4,
		},
		candidateTagline: {
			fontSize: 14,
			color: c.textMuted,
		},
		customInputs: {
			marginTop: 12,
			gap: 12,
		},
		textInput: {
			backgroundColor: c.surface,
			borderRadius: 8,
			padding: 12,
			fontSize: 14,
			color: c.textPrimarySoft,
			borderWidth: 1,
			borderColor: c.borderSoft,
			minHeight: 44,
		},
		radioItem: {
			flexDirection: "row",
			alignItems: "center",
			gap: 12,
			padding: 12,
			backgroundColor: c.surfaceFaintAlt,
			borderRadius: 8,
			marginBottom: 8,
			borderWidth: 2,
			borderColor: "transparent",
		},
		radioItemSelected: {
			backgroundColor: c.surfaceSelectedInfo,
			borderColor: c.brand,
		},
		radioLabel: {
			fontSize: 14,
			color: c.textPrimarySoft,
			flex: 1,
		},
		checkItem: {
			flexDirection: "row",
			alignItems: "center",
			gap: 12,
			padding: 12,
			backgroundColor: c.surfaceFaintAlt,
			borderRadius: 8,
			marginBottom: 8,
			borderWidth: 2,
			borderColor: "transparent",
		},
		checkItemSelected: {
			backgroundColor: c.surfaceSelectedInfo,
			borderColor: c.brand,
		},
		checkLabel: {
			fontSize: 14,
			color: c.textPrimarySoft,
			flex: 1,
		},
		textArea: {
			backgroundColor: c.surface,
			borderRadius: 8,
			padding: 12,
			fontSize: 14,
			color: c.textPrimarySoft,
			borderWidth: 1,
			borderColor: c.borderSoft,
			minHeight: 80,
			textAlignVertical: "top",
			marginTop: 8,
		},
		buttonContainer: {
			gap: 12,
			marginTop: 24,
			marginBottom: 400,
		},
		decideButton: {
			width: "100%",
		},
		cancelButton: {
			padding: 12,
			alignItems: "center",
		},
		cancelButtonText: {
			fontSize: 16,
			color: c.iconPlaceholder,
		},
	});
