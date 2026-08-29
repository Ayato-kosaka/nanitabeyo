import React, { useState, useCallback } from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { Calendar } from "lucide-react-native";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { useLocale } from "@/hooks/useLocale";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import type { Palette } from "@/constants/Palette";

interface BidFormProps {
	/** Initial bid amount */
	initialBidAmount?: string;
	/** Called when user submits the form */
	onSubmit: (bidAmount: string) => void;
	/** Called when user cancels */
	onCancel: () => void;
	/** Whether form is processing */
	isProcessing?: boolean;
}

/**
 * Bid form component that manages its own internal state to prevent
 * Japanese IME composition issues. Only communicates final values back to parent.
 */
export function BidForm({ initialBidAmount = "", onSubmit, onCancel, isProcessing = false }: BidFormProps) {
	// Internal state - isolated from parent re-renders
	// #1629 このフォームは «入札シートの中身» で、地図タイルの上には載らない。
	// だから面・文字・罫線はすべてテーマへ追従させる（固定色にする理由が無い）。
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const [bidAmount, setBidAmount] = useState(initialBidAmount);
	// #1599 隣のラベル（Map.labels.endDate）は 8 ロケール全てに翻訳があるのに、
	// 日付の書式だけ "ja-JP" 固定だった。この画面にロケール限定のガードは無いので、
	// 日本語以外のユーザーには «ラベルは英語・日付は 2026/9/25（年/月/日）» という
	// ちぐはぐな表示になっていた。
	const { locale } = useLocale();

	const handleSubmit = useCallback(() => {
		onSubmit(bidAmount);
	}, [bidAmount, onSubmit]);

	const handleCancel = useCallback(() => {
		onCancel();
	}, [onCancel]);

	const isValid = bidAmount.trim();

	return (
		<>
			<Card>
				<Text style={styles.inputLabel}>{i18n.t("Map.inputs.bidAmount")}</Text>
				<TextInput
					style={styles.textInput}
					placeholder={i18n.t("Map.placeholders.enterBidAmount")}
					// #1629 ダークで既定色（濃いグレー）のまま地に埋もれるため、テーマのトークンを明示する
					placeholderTextColor={colors.textSecondary}
					value={bidAmount}
					onChangeText={setBidAmount}
					keyboardType="numeric"
				/>
			</Card>

			<View style={styles.bidInfo}>
				<View style={styles.bidInfoRow}>
					<Calendar size={16} color={colors.textMuted} />
					<Text style={styles.bidInfoText}>
						{i18n.t("Map.labels.endDate")} {new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString(locale)}
					</Text>
				</View>
			</View>

			{isProcessing && (
				<View style={styles.processingContainer}>
					<LoadingIndicator size="large" />
					<Text style={styles.processingText}>{i18n.t("Map.labels.paymentProcessing")}</Text>
				</View>
			)}

			<PrimaryButton
				label={i18n.t("Map.buttons.bid")}
				onPress={handleSubmit}
				disabled={isProcessing || !isValid}
				style={{ marginHorizontal: 16 }}
			/>
		</>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		inputLabel: {
			fontSize: 16,
			fontWeight: "600",
			color: c.textStrong,
			marginBottom: 8,
		},
		textInput: {
			borderWidth: 1,
			borderColor: c.borderFaint,
			borderRadius: 8,
			paddingHorizontal: 12,
			paddingVertical: 12,
			fontSize: 16,
			color: c.textStrong,
		},
		bidInfo: {
			marginHorizontal: 16,
			marginBottom: 24,
		},
		bidInfoRow: {
			flexDirection: "row",
			alignItems: "center",
			marginBottom: 8,
		},
		bidInfoText: {
			fontSize: 14,
			color: c.textMuted,
			marginLeft: 8,
		},
		processingContainer: {
			alignItems: "center",
			paddingVertical: 32,
		},
		processingText: {
			fontSize: 16,
			color: c.textMuted,
			marginTop: 16,
		},
	});
