import React, { useState, useCallback } from "react";
import { Text, TextInput, StyleSheet } from "react-native";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareForm } from "@/features/blurModal/components/form";

const FIELD = ["display_name", "avatar", "bio"] as const;
type ProfileEditFormData = { [K in (typeof FIELD)[number]]: string };
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
	const [display_name, setDisplayName] = useState(initialValues.display_name);
	const [bio, setBio] = useState(initialValues.bio);

	const insets = useSafeAreaInsets();

	const handleSave = useCallback(() => {
		onSubmit({ avatar, display_name, bio });
	}, [avatar, display_name, bio, onSubmit]);

	return (
		<KeyboardAwareForm
			fields={FIELD}
			keyboardVerticalOffset={insets.top}
			bottomNode={
				<PrimaryButton style={{ marginHorizontal: 16 }} onPress={handleSave} label={i18n.t("Common.save")} />
			}>
			{({ recordY, onFocusFactory }) => (
				<>
					<Card onLayout={recordY("display_name")}>
						<Text style={styles.label}>{i18n.t("Profile.labels.displayName")}</Text>
						<TextInput
							style={styles.input}
							value={display_name}
							onChangeText={setDisplayName}
							onFocus={onFocusFactory("display_name")}
							multiline={false}
							placeholder={i18n.t("Profile.placeholders.enterDisplayName")}
							placeholderTextColor="#666"
							textAlignVertical="center"
							returnKeyType="next"
						/>
					</Card>

					<Card onLayout={recordY("avatar")}>
						<Text style={styles.label}>{i18n.t("Profile.labels.avatar")}</Text>
						<TextInput
							style={styles.input}
							value={avatar}
							onChangeText={setAvatar}
							onFocus={onFocusFactory("avatar")}
							multiline={false}
							placeholder={i18n.t("Profile.placeholders.enterAvatar")}
							placeholderTextColor="#666"
							textAlignVertical="center"
							returnKeyType="next"
							autoCapitalize="none"
							autoCorrect={false}
						/>
					</Card>

					<Card onLayout={recordY("bio")}>
						<Text style={styles.label}>{i18n.t("Profile.labels.bio")}</Text>
						<TextInput
							style={[styles.input, styles.bioInput]}
							value={bio}
							onChangeText={setBio}
							onFocus={onFocusFactory("bio")}
							multiline
							numberOfLines={4}
							placeholder={i18n.t("Profile.placeholders.enterBio")}
							placeholderTextColor="#666"
							textAlignVertical="top"
							returnKeyType="default"
						/>
					</Card>
				</>
			)}
		</KeyboardAwareForm>
	);
}

const styles = StyleSheet.create({
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
	bioInput: { minHeight: 80 },
});
