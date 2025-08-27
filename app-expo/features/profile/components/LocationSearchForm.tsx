import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Card } from "@/components/Card";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import i18n from "@/lib/i18n";
import type { AutocompleteLocation } from "@shared/api/v1/res";

interface LocationSearchFormProps {
	/** Initial location text value */
	initialLocationText?: string;
	/** Called when user selects a location */
	onSubmit: (location: AutocompleteLocation) => void;
	/** Called when user cancels */
	onCancel: () => void;
	/** Placeholder text for the location input */
	placeholder?: string;
	/** Modal title */
	title?: string;
	/** Test ID for the autocomplete input */
	testID?: string;
}

/**
 * Location search form component that manages its own internal state to prevent
 * Japanese IME composition issues. Only communicates final values back to parent.
 */
export function LocationSearchForm({
	initialLocationText = "",
	onSubmit,
	onCancel,
	placeholder = i18n.t("Search.placeholders.enterLocation"),
	title = i18n.t("Search.locationModal.title"),
	testID,
}: LocationSearchFormProps) {
	// Internal state - isolated from parent re-renders
	const [locationText, setLocationText] = useState(initialLocationText);

	const handleLocationSelect = useCallback(
		(location: AutocompleteLocation) => {
			onSubmit(location);
		},
		[onSubmit],
	);

	const handleCancel = useCallback(() => {
		onCancel();
	}, [onCancel]);

	return (
		<Card>
			<Text style={styles.modalTitle}>{title}</Text>
			<LocationAutocomplete
				value={locationText}
				onChangeText={setLocationText}
				onSelectSuggestion={handleLocationSelect}
				placeholder={placeholder}
				autofocus={true}
				testID={testID}
			/>
		</Card>
	);
}

const styles = StyleSheet.create({
	modalTitle: {
		fontSize: 18,
		fontWeight: "700",
		color: "#1A1A1A",
		marginBottom: 16,
		textAlign: "center",
		letterSpacing: -0.3,
	},
});
