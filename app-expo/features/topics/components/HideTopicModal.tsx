import React from "react";
import {
        Modal,
        View,
        Text,
        StyleSheet,
        TouchableOpacity,
        TextInput,
} from "react-native";
import { X } from "lucide-react-native";
import { width } from "@/features/topics/constants";

interface Props {
        visible: boolean;
        onRequestClose: () => void;
        hideReason: string;
        setHideReason: (text: string) => void;
        confirmHideCard: () => void;
}

// Modal displayed when a user chooses to hide a topic card
export const HideTopicModal = ({
        visible,
        onRequestClose,
        hideReason,
        setHideReason,
        confirmHideCard,
}: Props) => (
        <Modal
                visible={visible}
                transparent={true}
                animationType="fade"
                onRequestClose={onRequestClose}>
                <View style={styles.modalOverlay}>
                        <View style={styles.modalContainer}>
                                <View style={styles.modalHeader}>
                                        <Text style={styles.modalTitle}>非表示にする</Text>
                                        <TouchableOpacity onPress={onRequestClose}>
                                                <X size={24} color="#49454F" />
                                        </TouchableOpacity>
                                </View>

                                <Text style={styles.modalDescription}>非表示にする理由を教えてください（任意）</Text>

                                <TextInput
                                        style={styles.reasonInput}
                                        placeholder="理由を入力してください..."
                                        value={hideReason}
                                        onChangeText={setHideReason}
                                        multiline
                                        numberOfLines={3}
                                        textAlignVertical="top"
                                        placeholderTextColor="#79747E"
                                />

                                <View style={styles.modalActions}>
                                        <TouchableOpacity style={styles.cancelButton} onPress={onRequestClose}>
                                                <Text style={styles.cancelButtonText}>キャンセル</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity style={styles.confirmButton} onPress={confirmHideCard}>
                                                <Text style={styles.confirmButtonText}>非表示にする</Text>
                                        </TouchableOpacity>
                                </View>
                        </View>
                </View>
        </Modal>
);

const styles = StyleSheet.create({
        modalOverlay: {
                flex: 1,
                backgroundColor: "rgba(0, 0, 0, 0.6)",
                justifyContent: "center",
                alignItems: "center",
        },
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
