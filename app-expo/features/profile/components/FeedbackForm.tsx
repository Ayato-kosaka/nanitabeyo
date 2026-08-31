import React, { useState, useCallback, useRef } from "react";
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Platform } from "react-native";
import Constants from "expo-constants";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";
import { useAPICall } from "@/hooks/useAPICall";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import type { CreateFeedbackDto } from "@shared/api/v1/dto";
import { Keyboard } from "react-native";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

interface FeedbackFormProps {
	/** Initial feedback type */
	initialType?: "request" | "bug";
	/** Initial title value */
	initialTitle?: string;
	/** Initial message value */
	initialMessage?: string;
	/** Called when user submits the form successfully */
	onSubmit: (data: {
		type: "request" | "bug";
		title: string;
		message: string;
		issueNumber: number;
		issueUrl: string;
	}) => void;
	/** Called when user cancels */
	onCancel: () => void;
}

/**
 * Feedback form component that manages its own internal state to prevent
 * Japanese IME composition issues. Only communicates final values back to parent.
 */
export function FeedbackForm({
	initialType = "request",
	initialTitle = "",
	initialMessage = "",
	onSubmit,
	onCancel,
}: FeedbackFormProps) {
	// #1629 オーナー実機報告「ご意見・不具合を送る画面もダークモードに対応してない」。
	// ラベル・入力欄・エラー表示がライト固定の直書きだったためテーマのトークンへ移した
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();

	// Internal state - isolated from parent re-renders
	const [feedbackType, setFeedbackType] = useState<"request" | "bug">(initialType);
	const [feedbackTitle, setFeedbackTitle] = useState(initialTitle);
	const [feedbackMessage, setFeedbackMessage] = useState(initialMessage);
	const [submitError, setSubmitError] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	/**
	 * #1205 【修正】フィードバック送信の多重実行を防ぐ同期ガード。
	 *
	 * `isSubmitting`（useState）は **送信ボタンを disabled にする表示用途**であって、
	 * 多重実行の判定には使えない。React が再レンダリングをコミットする前に 2 発目の押下が
	 * 処理されると、両方が `isSubmitting === false`（＝`canSubmit === true`）を読んで通過しうるためで、
	 * 通過すると `v1/feedback/issue` の POST が 2 回走り、
	 * **GitHub Issue が 2 件立つ**（`api/src/v1/feedback/feedback.service.ts` の `createIssue` に重複排除は無い）。
	 * 外部サービスへ出てしまうため取り消しが効かず、運用側の手作業になる。
	 *
	 * ref への代入は同期的に確定するため、同一 JS タスク内の連続呼び出しでもレースしない。
	 * ReviewForm.tsx の `isSubmittingRef` と同じ方式。
	 */
	const isSubmittingRef = useRef(false);
	// #951 【仕様】送信ボタンをdisabledにする(=押下自体ができなくなる)ため、押下をトリガーにした
	// 事後バリデーションでは有効範囲を利用者に伝えられない。フィールドを一度離れたことをトリガーに、
	// 現在値が範囲外ならエラーを表示するリアルタイムバリデーションに変更する。
	const [titleTouched, setTitleTouched] = useState(false);
	const [messageTouched, setMessageTouched] = useState(false);

	const isTitleValid = feedbackTitle.length >= 5 && feedbackTitle.length <= 80;
	const isMessageValid = feedbackMessage.length >= 10 && feedbackMessage.length <= 2000;
	const canSubmit = isTitleValid && isMessageValid && !isSubmitting;
	const titleError = titleTouched && !isTitleValid ? i18n.t("Feedback.errors.titleLength") : "";
	const messageError = messageTouched && !isMessageValid ? i18n.t("Feedback.errors.messageLength") : "";

	const { callBackend } = useAPICall();
	const { mediumImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();

	const handleTitleChange = useCallback((text: string) => {
		setFeedbackTitle(text);
	}, []);

	const handleMessageChange = useCallback((text: string) => {
		setFeedbackMessage(text);
	}, []);

	const handleSubmit = useCallback(async () => {
		// #951 【仕様】ボタンは範囲外の間disabledで押下自体ができないため、ここに到達する時点で
		// タイトル・本文は必ず有効範囲内(canSubmitがtrueの状態でしか呼ばれない)。

		// #1205 多重送信の判定は ref で行う（useState の isSubmitting はレースが残る。宣言箇所のコメント参照）。
		// ここより後に送信処理を書くこと
		if (isSubmittingRef.current) return;
		isSubmittingRef.current = true;

		Keyboard.dismiss();
		setSubmitError("");
		setIsSubmitting(true);

		try {
			mediumImpact();

			// Get device information
			const deviceInfo = Constants.deviceName || "Unknown Device";
			const osInfo =
				Platform.OS === "ios"
					? `iOS ${Constants.platform?.ios?.systemVersion || "Unknown"}`
					: Platform.OS === "android"
						? `Android ${Platform.Version}`
						: Platform.OS;

			// Call API to submit feedback
			const response = await callBackend<CreateFeedbackDto, { issueNumber: number; issueUrl: string }>(
				"v1/feedback/issue",
				{
					method: "POST",
					requestPayload: {
						type: feedbackType,
						title: feedbackTitle,
						message: feedbackMessage,
						os: osInfo,
						device: deviceInfo,
					},
				},
			);

			logFrontendEvent({
				event_name: "feedback_submitted_success",
				error_level: "log",
				payload: {
					type: feedbackType,
					titleLength: feedbackTitle.length,
					messageLength: feedbackMessage.length,
					issueNumber: response.issueNumber,
				},
			});

			// Pass the response data to parent
			onSubmit({
				type: feedbackType,
				title: feedbackTitle,
				message: feedbackMessage,
				issueNumber: response.issueNumber,
				issueUrl: response.issueUrl,
			});
		} catch (error) {
			logFrontendEvent({
				event_name: "feedback_submitted_error",
				error_level: "error",
				payload: {
					type: feedbackType,
					titleLength: feedbackTitle.length,
					messageLength: feedbackMessage.length,
					error: (error as Error).message,
				},
			});
			setSubmitError(i18n.t("Feedback.errors.submitFailed"));
		} finally {
			// #1205 送信失敗後も送り直せるよう、表示用 state と同じタイミングで同期ガードも解除する。
			// 成功・失敗・例外のいずれでも必ず通る唯一の場所で、try 側の各 return 直前に散らすと
			// 解除漏れ（＝一度失敗したら二度と送信できない）を作る
			isSubmittingRef.current = false;
			setIsSubmitting(false);
		}
	}, [feedbackType, feedbackTitle, feedbackMessage, mediumImpact, logFrontendEvent, callBackend, onSubmit]);

	const handleCancel = useCallback(() => {
		onCancel();
	}, [onCancel]);

	return (
		<>
			<Card style={{ gap: 16 }}>
				{/* #951 【設計】タイトルは呼び出し元の画面(profile/feedback)の ScreenHeader が表示するため、
				    フォーム内では重複表示しない */}

				{/* Submit Error Display */}
				{submitError ? (
					<View style={styles.errorContainer}>
						<Text style={styles.errorText}>{submitError}</Text>
					</View>
				) : null}

				{/* Type Selection */}
				<View>
					<Text style={styles.feedbackLabel}>{i18n.t("Feedback.labels.type")}</Text>
					<View style={styles.radioGroup}>
						<TouchableOpacity style={styles.radioOption} onPress={() => setFeedbackType("request")}>
							<View style={[styles.radioCircle, feedbackType === "request" && styles.radioSelected]} />
							<Text style={styles.radioLabel}>{i18n.t("Feedback.types.request")}</Text>
						</TouchableOpacity>
						<TouchableOpacity style={styles.radioOption} onPress={() => setFeedbackType("bug")}>
							<View style={[styles.radioCircle, feedbackType === "bug" && styles.radioSelected]} />
							<Text style={styles.radioLabel}>{i18n.t("Feedback.types.bug")}</Text>
						</TouchableOpacity>
					</View>
				</View>

				{/* Title Input */}
				<View>
					<Text style={styles.feedbackLabel} nativeID="feedback-title-label">
						{i18n.t("Feedback.labels.title")}
					</Text>
					<TextInput
						style={[styles.feedbackInput, titleError && styles.feedbackInputError]}
						value={feedbackTitle}
						onChangeText={handleTitleChange}
						onBlur={() => setTitleTouched(true)}
						placeholder={i18n.t("Feedback.placeholders.title")}
						placeholderTextColor={colors.textMuted}
						maxLength={80}
						editable={!isSubmitting}
						// #951 【仕様】placeholder は入力後に消えるため、ラベルをアクセシブル名として明示する
						accessibilityLabel={i18n.t("Feedback.labels.title")}
						accessibilityLabelledBy="feedback-title-label"
					/>
					<Text style={styles.characterCount}>{feedbackTitle.length}/80</Text>
					{titleError ? (
						<Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="polite">
							{titleError}
						</Text>
					) : null}
				</View>

				{/* Message Input */}
				<View>
					<Text style={styles.feedbackLabel} nativeID="feedback-message-label">
						{i18n.t("Feedback.labels.message")}
					</Text>
					<TextInput
						style={[styles.feedbackInput, styles.feedbackTextArea, messageError && styles.feedbackInputError]}
						value={feedbackMessage}
						onChangeText={handleMessageChange}
						onBlur={() => setMessageTouched(true)}
						placeholder={i18n.t("Feedback.placeholders.message")}
						placeholderTextColor={colors.textMuted}
						multiline
						numberOfLines={6}
						maxLength={2000}
						textAlignVertical="top"
						editable={!isSubmitting}
						accessibilityLabel={i18n.t("Feedback.labels.message")}
						accessibilityLabelledBy="feedback-message-label"
					/>
					<Text style={styles.characterCount}>{feedbackMessage.length}/2000</Text>
					{messageError ? (
						<Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="polite">
							{messageError}
						</Text>
					) : null}
				</View>
			</Card>
			<PrimaryButton
				style={{ marginHorizontal: 16 }}
				onPress={handleSubmit}
				label={i18n.t("Feedback.buttons.submit")}
				disabled={!canSubmit}
				loading={isSubmitting}
			/>
		</>
	);
}

// #1629 ここで «赤の使用量» は変えていない。エラーの地・罫線・文字はそのまま赤の役割で、
// ライト / ダークそれぞれの値へ追従させただけである
const createStyles = (colors: Palette) =>
	StyleSheet.create({
		feedbackLabel: {
			fontSize: 16,
			fontWeight: "600",
			color: colors.textPrimary,
			marginBottom: 8,
		},
		radioGroup: {
			flexDirection: "row",
			gap: 24,
		},
		radioOption: {
			flexDirection: "row",
			alignItems: "center",
			gap: 8,
		},
		radioCircle: {
			width: 20,
			height: 20,
			borderRadius: 10,
			borderWidth: 2,
			borderColor: colors.trackMuted,
		},
		radioSelected: {
			backgroundColor: colors.brand,
			borderColor: colors.brand,
		},
		radioLabel: {
			fontSize: 16,
			color: colors.textSecondaryStrong,
		},
		feedbackInput: {
			backgroundColor: colors.surfaceMuted,
			borderRadius: 12,
			paddingHorizontal: 12,
			paddingVertical: 12,
			fontSize: 15,
			color: colors.textPrimary,
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 1 },
			shadowOpacity: 0.05,
			shadowRadius: 2,
			elevation: 1,
		},
		feedbackTextArea: {
			minHeight: 120,
			textAlignVertical: "top",
		},
		characterCount: {
			fontSize: 12,
			color: colors.textSecondary,
			textAlign: "right",
			marginTop: 4,
		},
		errorContainer: {
			backgroundColor: colors.dangerTintSoft,
			borderRadius: 8,
			padding: 12,
			borderLeftWidth: 4,
			borderLeftColor: colors.danger,
		},
		errorText: {
			fontSize: 14,
			color: colors.danger,
			fontWeight: "500",
			marginTop: 4,
		},
		feedbackInputError: {
			borderWidth: 1,
			borderColor: colors.danger,
			backgroundColor: colors.dangerTintSoft,
		},
	});
