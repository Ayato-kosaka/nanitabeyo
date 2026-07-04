import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";
import { Card } from "@/components/Card";

interface Props {
	onSubmit: () => void;
	onCancel: () => void;
}

export const BlockTopicForm = ({ onSubmit, onCancel }: Props) => {
	const { lightImpact, errorNotification } = useHaptics();

	const handleCancel = () => {
		lightImpact();
		onCancel();
	};

	const handleConfirm = () => {
		errorNotification();
		onSubmit();
	};

	return (
		<Card>
			<View style={styles.modalHeader}>
				<Text style={styles.modalTitle}>{i18n.t("Topics.BlockTopicModal.title")}</Text>
			</View>

			<Text style={styles.modalDescription}>{i18n.t("Topics.BlockTopicModal.description")}</Text>
			<Text style={styles.modalSubDescription}>{i18n.t("Topics.BlockTopicModal.note")}</Text>

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
		lineHeight: 24,
		fontWeight: "500",
		marginBottom: 8,
	},
	modalSubDescription: {
		fontSize: 14,
		color: "#6B7280",
		lineHeight: 20,
		marginBottom: 24,
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
	},
	cancelButtonText: {
		fontSize: 16,
		color: "#6B7280",
		fontWeight: "600",
	},
	confirmButton: {
		flex: 1,
		paddingVertical: 16,
		borderRadius: 16,
		alignItems: "center",
		backgroundColor: "#F05537",
	},
	confirmButtonText: {
		fontSize: 16,
		color: "#FFF",
		fontWeight: "700",
	},
});
