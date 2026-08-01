import React, { useState, useCallback } from "react";
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
	// Internal state - isolated from parent re-renders
	const [feedbackType, setFeedbackType] = useState<"request" | "bug">(initialType);
	const [feedbackTitle, setFeedbackTitle] = useState(initialTitle);
	const [feedbackMessage, setFeedbackMessage] = useState(initialMessage);
	const [submitError, setSubmitError] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
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
						placeholderTextColor="#666"
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
						placeholderTextColor="#666"
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

const styles = StyleSheet.create({
	feedbackLabel: {
		fontSize: 16,
		fontWeight: "600",
		color: "#1A1A1A",
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
		borderColor: "#D1D5DB",
	},
	radioSelected: {
		backgroundColor: "#F05537",
		borderColor: "#F05537",
	},
	radioLabel: {
		fontSize: 16,
		color: "#374151",
	},
	feedbackInput: {
		backgroundColor: "#F8F9FA",
		borderRadius: 12,
		paddingHorizontal: 12,
		paddingVertical: 12,
		fontSize: 15,
		color: "#1A1A1A",
		shadowColor: "#000",
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
		color: "#6B7280",
		textAlign: "right",
		marginTop: 4,
	},
	errorContainer: {
		backgroundColor: "#FEF2F2",
		borderRadius: 8,
		padding: 12,
		borderLeftWidth: 4,
		borderLeftColor: "#DC2626",
	},
	errorText: {
		fontSize: 14,
		color: "#DC2626",
		fontWeight: "500",
		marginTop: 4,
	},
	feedbackInputError: {
		borderWidth: 1,
		borderColor: "#DC2626",
		backgroundColor: "#FEF2F2",
	},
});
