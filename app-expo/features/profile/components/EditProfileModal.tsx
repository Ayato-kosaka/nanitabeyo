import React from "react";
import { View, Text, StyleSheet, TextInput } from "react-native";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";

interface EditProfileModalProps {
	BlurModal: React.ComponentType<{ children: React.ReactNode }>;
	editedBio: string;
	setEditedBio: (bio: string) => void;
	onSaveProfile: () => void;
}

/**
 * EditProfileModal コンポーネント
 * プロフィール編集モーダルを表示する
 */
export function EditProfileModal({ BlurModal, editedBio, setEditedBio, onSaveProfile }: EditProfileModalProps) {
	return (
		<BlurModal>
			<Card>
				<Text style={styles.editLabel}>{i18n.t("Profile.labels.bio")}</Text>
				<TextInput
					style={styles.editInput}
					value={editedBio}
					onChangeText={setEditedBio}
					multiline
					numberOfLines={4}
					placeholder={i18n.t("Profile.placeholders.enterBio")}
					placeholderTextColor="#666"
				/>
			</Card>
			<PrimaryButton style={{ marginHorizontal: 16 }} onPress={onSaveProfile} label={i18n.t("Common.save")} />
		</BlurModal>
	);
}

const styles = StyleSheet.create({
	editLabel: {
		fontSize: 17,
		fontWeight: "700",
		color: "#1A1A1A",
		marginBottom: 8,
		letterSpacing: -0.3,
	},
	editInput: {
		backgroundColor: "#F8F9FA",
		borderRadius: 12,
		paddingHorizontal: 12,
		paddingVertical: 12,
		fontSize: 15,
		color: "#1A1A1A",
		textAlignVertical: "top",
		minHeight: 100,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 1 },
		shadowOpacity: 0.05,
		shadowRadius: 2,
		elevation: 1,
	},
});
