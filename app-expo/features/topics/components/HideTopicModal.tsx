import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from "react-native";
import { X } from "lucide-react-native";
import { width } from "@/features/topics/constants";
import i18n from "@/lib/i18n";

interface Props {
        onClose: () => void;
        hideReason: string;
        setHideReason: (text: string) => void;
        confirmHideCard: () => void;
}

// Content for the hide topic modal
export const HideTopicModal = ({ onClose, hideReason, setHideReason, confirmHideCard }: Props) => (
        <View style={styles.modalContainer}>
                <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>{i18n.t("Topics.HideTopicModal.title")}</Text>
                        <TouchableOpacity onPress={onClose}>
                                <X size={24} color="#49454F" />
                        </TouchableOpacity>
                </View>

                <Text style={styles.modalDescription}>{i18n.t("Topics.HideTopicModal.description")}</Text>

                <TextInput
                        style={styles.reasonInput}
                        placeholder={i18n.t("Topics.HideTopicModal.placeholder")}
                        value={hideReason}
                        onChangeText={setHideReason}
                        multiline
                        numberOfLines={3}
                        textAlignVertical="top"
                        placeholderTextColor="#79747E"
                />

                <View style={styles.modalActions}>
                        <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
                                <Text style={styles.cancelButtonText}>{i18n.t("Common.cancel")}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.confirmButton} onPress={confirmHideCard}>
                                <Text style={styles.confirmButtonText}>{i18n.t("Topics.HideTopicModal.confirm")}</Text>
                        </TouchableOpacity>
                </View>
        </View>
);

const styles = StyleSheet.create({
        modalContainer: {
                backgroundColor: "#FFFFFF",
                borderRadius: 24,
                padding: 24,
                width: width - 48,
                maxWidth: 400,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.3,
		shadowRadius: 24,
		elevation: 12,
	},
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
