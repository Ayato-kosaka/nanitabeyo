import React, { useState, useCallback } from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";

interface ProfileEditFormProps {
	/** Initial value for the bio input */
	initialValue: string;
	/** Called when user saves the form with the final value */
	onSubmit: (value: string) => void;
	/** Called when user cancels (usually to close modal) */
	onCancel: () => void;
	/** Label for the input field */
	label?: string;
	/** Placeholder text for the input */
	placeholder?: string;
	/** Whether the input should be multiline */
	multiline?: boolean;
	/** Number of lines for multiline input */
	numberOfLines?: number;
}

/**
 * Profile edit form component that manages its own internal state to prevent
 * Japanese IME composition issues. Only communicates final values back to parent.
 */
export function ProfileEditForm({
	initialValue,
	onSubmit,
	onCancel,
	label = i18n.t("Profile.labels.bio"),
	placeholder = i18n.t("Profile.placeholders.enterBio"),
	multiline = true,
	numberOfLines = 4,
}: ProfileEditFormProps) {
	// Internal state - isolated from parent re-renders
	const [value, setValue] = useState(initialValue);

	const handleSave = useCallback(() => {
		onSubmit(value);
	}, [value, onSubmit]);

	const handleCancel = useCallback(() => {
		onCancel();
	}, [onCancel]);

	return (
		<>
			<Card>
				<Text style={styles.label}>{label}</Text>
				<TextInput
					style={styles.input}
					value={value}
					onChangeText={setValue}
					multiline={multiline}
					numberOfLines={numberOfLines}
					placeholder={placeholder}
					placeholderTextColor="#666"
					textAlignVertical={multiline ? "top" : "center"}
				/>
			</Card>
			<PrimaryButton style={{ marginHorizontal: 16 }} onPress={handleSave} label={i18n.t("Common.save")} />
		</>
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
		minHeight: 80,
	},
});
