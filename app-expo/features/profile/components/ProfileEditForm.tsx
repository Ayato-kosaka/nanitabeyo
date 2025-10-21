import React, { useState, useCallback } from "react";
import { View, Text, TextInput, StyleSheet, ScrollView } from "react-native";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";

interface ProfileEditFormData {
	avatar: string;
	display_name: string;
	bio: string;
}

interface ProfileEditFormProps {
	/** Initial values for the form */
	initialValues: ProfileEditFormData;
	/** Called when user saves the form with the final values */
	onSubmit: (values: ProfileEditFormData) => void;
	/** Called when user cancels (usually to close modal) */
	onCancel: () => void;
}

/**
 * Profile edit form component that manages its own internal state to prevent
 * Japanese IME composition issues. Only communicates final values back to parent.
 */
export function ProfileEditForm({ initialValues, onSubmit, onCancel }: ProfileEditFormProps) {
	// Internal state - isolated from parent re-renders
	const [avatar, setAvatar] = useState(initialValues.avatar);
	const [displayName, setDisplayName] = useState(initialValues.display_name);
	const [bio, setBio] = useState(initialValues.bio);

	const handleSave = useCallback(() => {
		onSubmit({
			avatar,
			display_name: displayName,
			bio,
		});
	}, [avatar, displayName, bio, onSubmit]);

	const handleCancel = useCallback(() => {
		onCancel();
	}, [onCancel]);

	return (
		<>
			<ScrollView style={styles.scrollView}>
				<Card>
					<Text style={styles.label}>{i18n.t("Profile.labels.displayName")}</Text>
					<TextInput
						style={styles.input}
						value={displayName}
						onChangeText={setDisplayName}
						multiline={false}
						placeholder={i18n.t("Profile.placeholders.enterDisplayName")}
						placeholderTextColor="#666"
						textAlignVertical="center"
					/>
				</Card>
				<Card style={styles.cardSpacing}>
					<Text style={styles.label}>{i18n.t("Profile.labels.avatar")}</Text>
					<TextInput
						style={styles.input}
						value={avatar}
						onChangeText={setAvatar}
						multiline={false}
						placeholder={i18n.t("Profile.placeholders.enterAvatar")}
						placeholderTextColor="#666"
						textAlignVertical="center"
					/>
				</Card>
				<Card style={styles.cardSpacing}>
					<Text style={styles.label}>{i18n.t("Profile.labels.bio")}</Text>
					<TextInput
						style={[styles.input, styles.bioInput]}
						value={bio}
						onChangeText={setBio}
						multiline={true}
						numberOfLines={4}
						placeholder={i18n.t("Profile.placeholders.enterBio")}
						placeholderTextColor="#666"
						textAlignVertical="top"
					/>
				</Card>
			</ScrollView>
			<PrimaryButton style={{ marginHorizontal: 16 }} onPress={handleSave} label={i18n.t("Common.save")} />
		</>
	);
}

const styles = StyleSheet.create({
	scrollView: {
		flex: 1,
	},
	label: {
		fontSize: 16,
		fontWeight: "600",
		color: "#1A1A1A",
		marginBottom: 12,
	},
	input: {
		borderWidth: 1,
		borderColor: "#E5E7EB",
		borderRadius: 12,
		paddingHorizontal: 16,
		paddingVertical: 12,
		fontSize: 16,
		color: "#1A1A1A",
		backgroundColor: "#FFFFFF",
		minHeight: 48,
	},
	bioInput: {
		minHeight: 80,
	},
	cardSpacing: {
		marginTop: 16,
	},
});
