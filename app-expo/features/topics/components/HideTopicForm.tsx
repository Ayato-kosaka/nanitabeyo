import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from "react-native";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";
import { Card } from "@/components/Card";

interface Props {
	initialValue?: string;
	onSubmit: (hideReason: string) => void;
	onCancel: () => void;
}

// Self-contained form component for hiding topics with internal state management
// This prevents parent re-renders during typing, preserving Japanese IME composition
export const HideTopicForm = ({ initialValue = "", onSubmit, onCancel }: Props) => {
	// Internal state - this is the key to fixing Japanese input
	const [hideReason, setHideReason] = useState(initialValue);
	const { lightImpact, errorNotification } = useHaptics();

	const handleCancel = () => {
		lightImpact();
		onCancel();
	};

	const handleConfirm = () => {
		errorNotification();
		onSubmit(hideReason);
	};

	return (
		<Card>
			<View style={styles.modalHeader}>
				<Text style={styles.modalTitle}>{i18n.t("Topics.HideTopicModal.title")}</Text>
			</View>

			<Text style={styles.modalDescription}>{i18n.t("Topics.HideTopicModal.description")}</Text>

			<TextInput
				style={styles.reasonInput}
				placeholder={i18n.t("Topics.HideTopicModal.placeholder")}
				value={hideReason}
				onChangeText={setHideReason} // Internal state only - no parent re-renders
				multiline
				numberOfLines={3}
				textAlignVertical="top"
				placeholderTextColor="#79747E"
			/>

			<View style={styles.modalActions}>
				<TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
					<Text style={styles.cancelButtonText}>{i18n.t("Common.cancel")}</Text>
				</TouchableOpacity>
				<TouchableOpacity style={styles.confirmButton} onPress={handleConfirm}>
					<Text style={styles.confirmButtonText}>{i18n.t("Topics.HideTopicModal.confirm")}</Text>
				</TouchableOpacity>
			</View>
		</Card>
	);
};

const styles = StyleSheet.create({
	modalHeader: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		marginBottom: 16,
	},
	modalTitle: {
		fontSize: 22,
		fontWeight: "700",
		color: "#1C1B1F",
		letterSpacing: -0.3,
	},
	modalDescription: {
		fontSize: 16,
		color: "#49454F",
		marginBottom: 16,
		lineHeight: 24,
		fontWeight: "500",
	},
	reasonInput: {
		borderWidth: 1,
		borderColor: "#E5E7EB",
		borderRadius: 16,
		paddingHorizontal: 16,
		paddingVertical: 16,
		fontSize: 16,
		color: "#1C1B1F",
		backgroundColor: "#FFFFFF",
		minHeight: 100,
		marginBottom: 24,
		textAlignVertical: "top",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 1 },
		shadowOpacity: 0.05,
		shadowRadius: 2,
		elevation: 1,
	},
	modalActions: {
		flexDirection: "row",
		gap: 12,
	},
	cancelButton: {
		flex: 1,
		paddingVertical: 16,
		borderRadius: 16,
		alignItems: "center",
		backgroundColor: "#F8F9FA",
		shadowColor: "#F8F9FA",
		shadowOffset: { width: 0, height: 0 },
		shadowRadius: 10,
		elevation: 6,
	},
	cancelButtonText: {
		fontSize: 16,
		color: "#6B7280",
		fontWeight: "600",
	},
	confirmButton: {
		flex: 1,
		backgroundColor: "#EF4444",
		paddingVertical: 16,
		borderRadius: 16,
		alignItems: "center",
		shadowColor: "#EF4444",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.4,
		shadowRadius: 10,
		elevation: 6,
	},
	confirmButtonText: {
		fontSize: 16,
		color: "#FFFFFF",
		fontWeight: "600",
	},
});
