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
	ActivityIndicator,
} from "react-native";
import { useLocationSearch } from "@/hooks/useLocationSearch";
import { useHaptics } from "@/hooks/useHaptics";
import i18n from "@/lib/i18n";
import type { AutocompleteLocation } from "@shared/api/v1/res";
import { MapPin, X } from "lucide-react-native";

interface LocationAutocompleteProps {
	/** Current value of the input */
	value: string;
	/** Called when text changes */
	onChangeText: (text: string) => void;
	/** Called when a suggestion is selected */
	onSelectSuggestion: (location: AutocompleteLocation) => void;
	/** Called when clear button is pressed */
	onClear?: () => void;
	/** Placeholder text for the input */
	placeholder?: string;
	/** Optional right-side icon or element */
	renderInputRight?: React.ReactNode;
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
	onClear,
	placeholder = i18n.t("Search.currentLocation"),
	autofocus = false,
	renderInputRight,
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
			// Delay the blur to allow the parent state update to complete
			setTimeout(() => {
				inputRef.current?.blur();
			}, 100);
		},
		[onSelectSuggestion, lightImpact],
	);

	// Handle clear button press
	const handleClear = useCallback(() => {
		lightImpact();
		onChangeText("");
		if (onClear) {
			onClear();
		}
		inputRef.current?.focus();
	}, [onChangeText, onClear, lightImpact]);

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
			<View style={styles.locationInputContainer}>
				{/* Text Input */}
				<TextInput
					ref={inputRef}
					style={[styles.input, isFocused && styles.inputFocused]}
					value={value}
					onChangeText={handleTextChange}
					onFocus={handleFocus}
					onBlur={handleBlur}
					placeholder={placeholder}
					placeholderTextColor="#6B7280"
					autoComplete="off"
					autoCorrect={false}
					autoCapitalize="words"
					keyboardType="default"
					returnKeyType="search"
					accessibilityLabel={i18n.t("Search.sections.location")}
					accessibilityHint="Enter a location to search for restaurants"
					testID={`${testID}-input`}
				/>
				{/* Clear button */}
				{value.length > 0 && (
					<TouchableOpacity
						style={styles.clearButton}
						onPress={handleClear}
						accessibilityRole="button"
						accessibilityLabel="Clear location"
						testID={`${testID}-clear`}>
						<X size={16} color="#6B7280" />
					</TouchableOpacity>
				)}
				{renderInputRight && renderInputRight}
			</View>

			{/* Loading indicator */}
			{isSearching && (
				<View style={styles.loadingContainer}>
					<ActivityIndicator size="small" color="#5EA2FF" />
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
								<MapPin size={16} color="#6B7280" />
								<View style={styles.suggestionText}>
									<Text style={styles.suggestionMainText}>{suggestion.mainText}</Text>
									{suggestion.secondaryText && (
										<Text style={styles.suggestionSecondaryText}>{suggestion.secondaryText}</Text>
									)}
								</View>
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
	container: { flex: 1 },
	locationInputContainer: {
		flexDirection: "row",
		alignItems: "center",
		borderRadius: 16,
		backgroundColor: "#F8F9FA",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 1 },
		shadowOpacity: 0.05,
		shadowRadius: 2,
		elevation: 1,
	},
	input: {
		flex: 1,
		paddingHorizontal: 20,
		paddingVertical: 16,
		fontSize: 16,
		color: "#1A1A1A",
	},
	inputFocused: {},
	clearButton: {
		padding: 12,
		marginRight: 4,
	},
	loadingContainer: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		paddingVertical: 20,
		marginTop: 12,
		backgroundColor: "#FFF",
		borderRadius: 16,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.1,
		shadowRadius: 24,
		elevation: 4,
	},
	loadingText: {
		marginLeft: 8,
		fontSize: 14,
		color: "#6B7280",
	},
	suggestionsContainer: {
		marginTop: 12,
		backgroundColor: "#FFF",
		borderRadius: 16,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.1,
		shadowRadius: 24,
		elevation: 4,
	},
	suggestionsList: {},
	suggestionItem: {
		flexDirection: "row",
		alignItems: "center",
		paddingHorizontal: 20,
		paddingVertical: 16,
		borderBottomWidth: 0.5,
		borderBottomColor: "#F3F4F6",
	},
	lastSuggestionItem: {
		borderBottomWidth: 0,
	},
	suggestionText: {
		marginLeft: 16,
		flex: 1,
	},
	suggestionMainText: {
		fontSize: 16,
		color: "#1A1A1A",
		fontWeight: "600",
	},
	suggestionSecondaryText: {
		fontSize: 14,
		color: "#6B7280",
		marginTop: 4,
	},
	noResultsContainer: {
		minHeight: 60,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#FFFFFF",
		borderRadius: 12,
		marginTop: 12,
		paddingVertical: 20,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.1,
		shadowRadius: 24,
		elevation: 4,
	},
	noResultsText: {
		fontSize: 14,
		color: "#6B7280",
	},
});
