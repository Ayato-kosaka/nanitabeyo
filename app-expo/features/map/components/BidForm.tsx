import React, { useState, useCallback } from "react";
import { View, Text, TextInput, StyleSheet, ActivityIndicator } from "react-native";
import { Calendar } from "lucide-react-native";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";

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
	const [bidAmount, setBidAmount] = useState(initialBidAmount);

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
					value={bidAmount}
					onChangeText={setBidAmount}
					keyboardType="numeric"
				/>
			</Card>

			<View style={styles.bidInfo}>
				<View style={styles.bidInfoRow}>
					<Calendar size={16} color="#666" />
					<Text style={styles.bidInfoText}>
						{i18n.t("Map.labels.endDate")} {new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString("ja-JP")}
					</Text>
				</View>
			</View>

			{isProcessing && (
				<View style={styles.processingContainer}>
					<ActivityIndicator size="large" color="#007AFF" />
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

const styles = StyleSheet.create({
	inputLabel: {
		fontSize: 16,
		fontWeight: "600",
		color: "#000",
		marginBottom: 8,
	},
	textInput: {
		borderWidth: 1,
		borderColor: "#E5E5E5",
		borderRadius: 8,
		paddingHorizontal: 12,
		paddingVertical: 12,
		fontSize: 16,
		color: "#000",
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
		color: "#666",
		marginLeft: 8,
	},
	processingContainer: {
		alignItems: "center",
		paddingVertical: 32,
	},
	processingText: {
		fontSize: 16,
		color: "#666",
		marginTop: 16,
	},
});
