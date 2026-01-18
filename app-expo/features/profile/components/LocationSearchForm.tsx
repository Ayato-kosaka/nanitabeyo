import React, { useCallback } from "react";
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
 * #681 【設計】LocationAutocomplete の新 API を使用するように更新
 */
export function LocationSearchForm({
	initialLocationText = "",
	onSubmit,
	onCancel,
	placeholder = i18n.t("Search.placeholders.enterLocation"),
	title = i18n.t("Search.locationModal.title"),
	testID,
}: LocationSearchFormProps) {
	// #681 【設計】onSuggestionSelect でカスタムハンドリング（AutocompleteLocation を返す）
	const handleSuggestionSelect = useCallback(
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
			<View style={styles.locationSection}>
				{/* #681 【設計】新しい API で LocationAutocomplete を使用 */}
				<LocationAutocomplete
					onLocationChange={() => {}}
					onSuggestionSelect={handleSuggestionSelect}
					initialLocation={
						initialLocationText
							? {
									location: { location: { latitude: 0, longitude: 0 }, address: "", localLanguageCode: "" },
									label: initialLocationText,
								}
							: undefined
					}
					placeholder={placeholder}
					autofocus={true}
					testID={testID}
				/>
			</View>
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
	locationSection: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 12,
	},
});
