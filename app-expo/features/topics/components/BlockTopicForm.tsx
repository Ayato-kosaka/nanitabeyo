import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";
import { Card } from "@/components/Card";

interface Props {
	onConfirm: () => void;
	onCancel: () => void;
}

// #[TICKET] 【設計】Block確認ダイアログ（理由入力なし、確認のみ）
export const BlockTopicForm = ({ onConfirm, onCancel }: Props) => {
	const { lightImpact, errorNotification } = useHaptics();

	const handleCancel = () => {
		lightImpact();
		onCancel();
	};

	const handleConfirm = () => {
		errorNotification();
		onConfirm();
	};

	return (
		<Card>
			<View style={styles.modalHeader}>
				<Text style={styles.modalTitle}>{i18n.t("Topics.BlockTopicModal.title")}</Text>
			</View>

			<Text style={styles.modalDescription}>{i18n.t("Topics.BlockTopicModal.description")}</Text>

			<Text style={styles.modalNote}>{i18n.t("Topics.BlockTopicModal.note")}</Text>

			<View style={styles.modalActions}>
				<TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
					<Text style={styles.cancelButtonText}>{i18n.t("Common.cancel")}</Text>
				</TouchableOpacity>
				<TouchableOpacity style={styles.confirmButton} onPress={handleConfirm}>
					<Text style={styles.confirmButtonText}>{i18n.t("Topics.BlockTopicModal.confirm")}</Text>
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
		marginBottom: 12,
		lineHeight: 24,
		fontWeight: "500",
	},
	modalNote: {
		fontSize: 14,
		color: "#79747E",
		marginBottom: 24,
		lineHeight: 20,
		fontWeight: "400",
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
