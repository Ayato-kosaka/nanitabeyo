import React, { useState, useCallback, useEffect, useRef } from "react";
import {
	View,
	Text,
	TextInput,
	TouchableOpacity,
	StyleSheet,
	ScrollView,
	Platform,
	AccessibilityInfo,
} from "react-native";
import { useLocationSearch } from "@/hooks/useLocationSearch";
import { useHaptics } from "@/hooks/useHaptics";
import i18n from "@/lib/i18n";
import type { AutocompleteLocation } from "@shared/api/v1/res";

interface LocationAutocompleteProps {
	/** Current value of the input */
	value: string;
	/** Called when text changes */
	onChangeText: (text: string) => void;
	/** Called when a suggestion is selected */
	onSelectSuggestion: (location: AutocompleteLocation) => void;
	/** Placeholder text for the input */
	placeholder?: string;
	/** Whether to auto focus the input when mounted */
	autofocus?: boolean;
	/** Test ID for testing */
	testID?: string;
}

/**
 * Unified location autocomplete component that combines text input and suggestions.
 * Handles debouncing, API calls, keyboard navigation, and accessibility.
 */
export function LocationAutocomplete({
	value,
	onChangeText,
	onSelectSuggestion,
	placeholder = i18n.t("Search.currentLocation"),
	autofocus = false,
	testID = "location-autocomplete",
}: LocationAutocompleteProps) {
	const [showSuggestions, setShowSuggestions] = useState(false);
	const [isFocused, setIsFocused] = useState(false);
	const inputRef = useRef<TextInput>(null);
	const debounceRef = useRef<number | null>(null);

	const { suggestions, isSearching, searchLocations } = useLocationSearch();
	const { lightImpact } = useHaptics();

	// Auto focus on mount if requested
	useEffect(() => {
		if (autofocus) {
			const timer = setTimeout(() => {
				inputRef.current?.focus();
			}, 100);
			return () => clearTimeout(timer);
		}
	}, [autofocus]);

	// Handle text changes with debouncing
	const handleTextChange = useCallback(
		(text: string) => {
			onChangeText(text);

			// Clear previous debounce timer
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
			}

			// Show suggestions if there's text and input is focused
			setShowSuggestions(text.length > 0 && isFocused);

			// Debounce the API call
			if (text.length > 2) {
					debounceRef.current = setTimeout(() => {
					searchLocations(text).catch((error) => {
						console.warn("Location search failed:", error);
					});
				}, 300);
			}
		},
		[onChangeText, searchLocations, isFocused],
	);

	// Handle input focus
	const handleFocus = useCallback(() => {
		setIsFocused(true);
		setShowSuggestions(value.length > 0);
	}, [value.length]);

	// Handle input blur
	const handleBlur = useCallback(() => {
		// Delay hiding suggestions to allow for suggestion selection
		setTimeout(() => {
			setIsFocused(false);
			setShowSuggestions(false);
		}, 150);
	}, []);

	// Handle suggestion selection
	const handleSuggestionPress = useCallback(
		(suggestion: AutocompleteLocation) => {
			lightImpact();
			onSelectSuggestion(suggestion);
			setShowSuggestions(false);
			inputRef.current?.blur();
		},
		[onSelectSuggestion, lightImpact],
	);

	// Cleanup debounce timer on unmount
	useEffect(() => {
		return () => {
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
			}
		};
	}, []);

	return (
		<View style={styles.container}>
			{/* Text Input */}
			<TextInput
				ref={inputRef}
				style={[styles.input, isFocused && styles.inputFocused]}
				value={value}
				onChangeText={handleTextChange}
				onFocus={handleFocus}
				onBlur={handleBlur}
				placeholder={placeholder}
				placeholderTextColor="#666"
				autoComplete="off"
				autoCorrect={false}
				autoCapitalize="words"
				keyboardType="default"
				returnKeyType="search"
				accessibilityLabel={i18n.t("Search.sections.location")}
				accessibilityHint="Enter a location to search for restaurants"
				testID={`${testID}-input`}
			/>

			{/* Loading indicator */}
			{isSearching && (
				<View style={styles.loadingContainer}>
					<Text style={styles.loadingText}>{i18n.t("Profile.loading")}</Text>
				</View>
			)}

			{/* Suggestions List */}
			{showSuggestions && suggestions.length > 0 && (
				<View style={styles.suggestionsContainer}>
					<ScrollView
						keyboardShouldPersistTaps="handled"
						showsVerticalScrollIndicator={false}
						style={styles.suggestionsList}
						testID={`${testID}-suggestions`}>
						{suggestions.map((suggestion, index) => (
							<TouchableOpacity
								key={suggestion.place_id || index}
								style={[styles.suggestionItem, index === suggestions.length - 1 && styles.lastSuggestionItem]}
								onPress={() => handleSuggestionPress(suggestion)}
								accessibilityRole="button"
								accessibilityLabel={suggestion.text}
								accessibilityHint="Select this location"
								testID={`${testID}-suggestion-${index}`}>
								<Text style={styles.suggestionMainText}>{suggestion.mainText}</Text>
								{suggestion.secondaryText && (
									<Text style={styles.suggestionSecondaryText}>{suggestion.secondaryText}</Text>
								)}
							</TouchableOpacity>
						))}
					</ScrollView>
				</View>
			)}

			{/* No results message */}
			{showSuggestions && !isSearching && suggestions.length === 0 && value.length > 2 && (
				<View style={styles.noResultsContainer}>
					<Text style={styles.noResultsText}>No locations found</Text>
				</View>
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		position: "relative",
	},
	input: {
		backgroundColor: "#F8F9FA",
		borderRadius: 12,
		paddingHorizontal: 16,
		paddingVertical: 12,
		fontSize: 16,
		color: "#1A1A1A",
		borderWidth: 1,
		borderColor: "#E5E5E5",
		...Platform.select({
			ios: {
				shadowColor: "#000",
				shadowOffset: { width: 0, height: 1 },
				shadowOpacity: 0.05,
				shadowRadius: 2,
			},
			android: {
				elevation: 1,
			},
		}),
	},
	inputFocused: {
		borderColor: "#5EA2FF",
		borderWidth: 2,
	},
	loadingContainer: {
		paddingVertical: 8,
		alignItems: "center",
	},
	loadingText: {
		fontSize: 14,
		color: "#666",
		fontStyle: "italic",
	},
	suggestionsContainer: {
		position: "absolute",
		top: "100%",
		left: 0,
		right: 0,
		backgroundColor: "#FFFFFF",
		borderRadius: 12,
		marginTop: 4,
		maxHeight: 200,
		zIndex: 1000,
		...Platform.select({
			ios: {
				shadowColor: "#000",
				shadowOffset: { width: 0, height: 4 },
				shadowOpacity: 0.1,
				shadowRadius: 8,
			},
			android: {
				elevation: 8,
			},
		}),
	},
	suggestionsList: {
		flex: 1,
	},
	suggestionItem: {
		paddingHorizontal: 16,
		paddingVertical: 12,
		borderBottomWidth: 1,
		borderBottomColor: "#F0F0F0",
	},
	lastSuggestionItem: {
		borderBottomWidth: 0,
	},
	suggestionMainText: {
		fontSize: 16,
		color: "#1A1A1A",
		fontWeight: "500",
		marginBottom: 2,
	},
	suggestionSecondaryText: {
		fontSize: 14,
		color: "#666",
	},
	noResultsContainer: {
		position: "absolute",
		top: "100%",
		left: 0,
		right: 0,
		backgroundColor: "#FFFFFF",
		borderRadius: 12,
		marginTop: 4,
		paddingVertical: 16,
		alignItems: "center",
		...Platform.select({
			ios: {
				shadowColor: "#000",
				shadowOffset: { width: 0, height: 4 },
				shadowOpacity: 0.1,
				shadowRadius: 8,
			},
			android: {
				elevation: 8,
			},
		}),
	},
	noResultsText: {
		fontSize: 14,
		color: "#666",
		fontStyle: "italic",
	},
});