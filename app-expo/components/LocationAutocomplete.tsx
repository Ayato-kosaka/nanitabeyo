import React, { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { useLocationSearch } from "@/hooks/useLocationSearch";
import { useHaptics } from "@/hooks/useHaptics";
import i18n from "@/lib/i18n";
import { type AutocompleteLocation } from "@shared/api/v1/res";
import { isFoodAndDrinkPlaceForUser } from "@shared/utils/google_places_restaurant_type";
import { MapPin, Utensils, X, History, Trash2 } from "lucide-react-native";
import type { LocationDetailsResponse } from "@shared/api/v1/res";
import { LoadingIndicator } from "./LoadingIndicator";

/**
 * #953 【仕様】details API のレスポンスから viewport を除いたもの＋検索画面の表示用文字列。
 * 「最近使った場所」として再選択した際に details API を呼び直さず復元できる形にする。
 */
export type RecentLocation = Omit<LocationDetailsResponse, "viewport"> & {
	locationQuery: string;
};

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
	/** Whether to auto clear input on focus */
	autoClearOnFocus?: boolean;
	/** Test ID for testing */
	testID?: string;
	/** #953 未入力でのフォーカス時に「最近使った場所」として提示する候補(最大5件) */
	recentLocations?: RecentLocation[];
	/** #953 「最近使った場所」の1件が選択されたときのハンドラ */
	onSelectRecentLocation?: (location: RecentLocation) => void;
	/** #953 「最近使った場所」を全件クリアするハンドラ。未指定なら消去ボタンを出さない */
	onClearRecentLocations?: () => void;
}

// ===== Tunables (ベストプラクティス的にマジックナンバーを定数化) =====
const MIN_SEARCH_LENGTH = 1;
const DEBOUNCE_DELAY_MS = 300;
const BLUR_SUGGESTION_HIDE_DELAY_MS = 150;
const BLUR_AFTER_SELECT_DELAY_MS = 100;
const AUTOFOCUS_DELAY_MS = 100;

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
	autoClearOnFocus = false,
	autofocus = false,
	renderInputRight,
	testID = "location-autocomplete",
	recentLocations = [],
	onSelectRecentLocation,
	onClearRecentLocations,
}: LocationAutocompleteProps) {
	const [showSuggestions, setShowSuggestions] = useState(false);
	const [isFocused, setIsFocused] = useState(false);
	const inputRef = useRef<TextInput>(null);
	const debounceRef = useRef<number | null>(null);

	const { suggestions, isSearching, searchLocations } = useLocationSearch();
	const { lightImpact } = useHaptics();

	// Auto focus on mount if requested
	useEffect(() => {
		if (!autofocus) return;

		const timer = setTimeout(() => {
			inputRef.current?.focus();
		}, AUTOFOCUS_DELAY_MS);

		return () => clearTimeout(timer);
	}, [autofocus]);

	// Handle text changes with debouncing
	const handleTextChange = useCallback(
		(text: string) => {
			onChangeText(text);

			const trimmed = text.trim();
			const hasEnoughChars = trimmed.length >= MIN_SEARCH_LENGTH;

			// Clear previous debounce timer
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
			}

			// Show suggestions if there's text and input is focused
			setShowSuggestions(trimmed.length > 0 && isFocused);

			// If入力が短すぎる場合は検索をかけず、サジェストも消す
			if (!hasEnoughChars) {
				return;
			}

			// Debounce the API call
			debounceRef.current = setTimeout(() => {
				searchLocations(trimmed).catch((error) => {
					console.warn("Location search failed:", error);
				});
			}, DEBOUNCE_DELAY_MS) as unknown as number;
		},
		[onChangeText, searchLocations, isFocused],
	);

	// Handle input focus
	const handleFocus = useCallback(() => {
		setIsFocused(true);

		if (autoClearOnFocus && value.length > 0) {
			// クリアボタンと同じ順序に揃える
			onChangeText("");
			onClear?.();

			// 自動クリアしたときは一旦サジェスト閉じる
			setShowSuggestions(false);
			return;
		}

		// 通常時はそのまま
		setShowSuggestions(value.trim().length > 0);
	}, [autoClearOnFocus, value, onChangeText, onClear]);

	// Handle input blur
	const handleBlur = useCallback(() => {
		// Delay hiding suggestions to allow for suggestion selection
		setTimeout(() => {
			setIsFocused(false);
			setShowSuggestions(false);
		}, BLUR_SUGGESTION_HIDE_DELAY_MS);
	}, []);

	// Handle suggestion selection
	const handleSuggestionPress = useCallback(
		(suggestion: AutocompleteLocation) => {
			lightImpact();
			onSelectSuggestion(suggestion);
			setShowSuggestions(false);

			// Delay blur to allow parent state update to complete
			setTimeout(() => {
				inputRef.current?.blur();
			}, BLUR_AFTER_SELECT_DELAY_MS);
		},
		[onSelectSuggestion, lightImpact],
	);

	// #953 【仕様】最近使った場所は details API を呼び直さず、保存済みの location をそのまま復元する
	const handleRecentLocationPress = useCallback(
		(recent: RecentLocation) => {
			lightImpact();
			onSelectRecentLocation?.(recent);
			setIsFocused(false);

			setTimeout(() => {
				inputRef.current?.blur();
			}, BLUR_AFTER_SELECT_DELAY_MS);
		},
		[onSelectRecentLocation, lightImpact],
	);

	// Handle clear button press
	const handleClear = useCallback(() => {
		lightImpact();
		onChangeText("");
		setShowSuggestions(false);

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

	const trimmedValueLength = value.trim().length;
	const hasEnoughCharsForSearch = trimmedValueLength >= MIN_SEARCH_LENGTH;
	// #953 【仕様】未入力でフォーカスしたときだけ「最近使った場所」を出す。文字入力が始まったら
	// 通常の検索候補(showSuggestions)に切り替わるため、両者は同時に表示されない。
	const showRecentLocations = isFocused && trimmedValueLength === 0 && recentLocations.length > 0;

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
					accessibilityHint={i18n.t("Search.accessibility.locationInputHint")}
					testID={`${testID}-input`}
				/>
				{/* Clear button */}
				{value.length > 0 && (
					<TouchableOpacity
						style={styles.clearButton}
						onPress={handleClear}
						hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
						accessibilityRole="button"
						accessibilityLabel={i18n.t("Search.accessibility.clearLocation")}
						testID={`${testID}-clear`}>
						<X size={16} color="#6B7280" />
					</TouchableOpacity>
				)}
				{renderInputRight}
			</View>

			{/* #953 最近使った場所 */}
			{showRecentLocations && (
				<View style={styles.suggestionsContainer}>
					<View style={styles.recentLocationsHeader}>
						<Text style={styles.recentLocationsTitle}>{i18n.t("Search.recentLocations.title")}</Text>
						{onClearRecentLocations && (
							<TouchableOpacity
								onPress={onClearRecentLocations}
								hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
								accessibilityRole="button"
								accessibilityLabel={i18n.t("Search.recentLocations.clear")}
								testID={`${testID}-recent-locations-clear`}>
								<Trash2 size={16} color="#9CA3AF" />
							</TouchableOpacity>
						)}
					</View>
					<ScrollView
						keyboardShouldPersistTaps="handled"
						showsVerticalScrollIndicator={false}
						style={styles.suggestionsList}
						testID={`${testID}-recent-locations`}>
						{recentLocations.map((recent, index) => (
							<TouchableOpacity
								key={`${recent.location.latitude},${recent.location.longitude}`}
								style={[styles.suggestionItem, index === recentLocations.length - 1 && styles.lastSuggestionItem]}
								onPress={() => handleRecentLocationPress(recent)}
								accessibilityRole="button"
								accessibilityLabel={recent.locationQuery}
								accessibilityHint={i18n.t("Search.accessibility.selectLocation")}
								testID={`${testID}-recent-location-${index}`}>
								<History size={16} color="#6B7280" />
								<View style={styles.suggestionText}>
									<Text style={styles.suggestionMainText} numberOfLines={1}>
										{recent.locationQuery}
									</Text>
								</View>
							</TouchableOpacity>
						))}
					</ScrollView>
				</View>
			)}

			{/* Loading indicator */}
			{isSearching && (
				<View style={styles.loadingContainer}>
					<LoadingIndicator size="small" />
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
								accessibilityHint={i18n.t("Search.accessibility.selectLocation")}
								testID={`${testID}-suggestion-${index}`}>
								{isFoodAndDrinkPlaceForUser(suggestion) ? (
									<Utensils size={16} color="#6B7280" />
								) : (
									<MapPin size={16} color="#6B7280" />
								)}
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
			{showSuggestions && !isSearching && suggestions.length === 0 && hasEnoughCharsForSearch && (
				<View style={styles.noResultsContainer}>
					<Text style={styles.noResultsText}>{i18n.t("Search.noLocationsFound")}</Text>
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
		backgroundColor: "#FFFFFF",
		borderWidth: 1,
		borderColor: "#C9C9C9",
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
	recentLocationsHeader: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingHorizontal: 20,
		paddingTop: 14,
		paddingBottom: 4,
	},
	recentLocationsTitle: {
		fontSize: 12,
		fontWeight: "600",
		color: "#9CA3AF",
	},
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
