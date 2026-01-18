import React, { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { useLocationSearch } from "@/hooks/useLocationSearch";
import { useHaptics } from "@/hooks/useHaptics";
import i18n from "@/lib/i18n";
import { type AutocompleteLocation, type LocationDetailsResponse } from "@shared/api/v1/res";
import { isFoodAndDrinkPlaceForUser } from "@shared/utils/google_places_restaurant_type";
import { MapPin, Utensils, X, Navigation } from "lucide-react-native";

interface LocationAutocompleteProps {
	/**
	 * 選択された LocationDetails と表示用ラベルを親に返す
	 * - location: Place Details / 現在地の詳細（null の場合は未選択）
	 * - label: 画面上でユーザーに見せるための文字列（例: "渋谷駅", "現在地"）
	 * - onSuggestionSelect が指定されている場合はオプション
	 */
	onLocationChange?: (payload: {
		location: Omit<LocationDetailsResponse, "viewport"> | null;
		label: string | null;
	}) => void;

	/** 初期選択済みの location があれば渡す（再表示時など） */
	initialLocation?: {
		location: Omit<LocationDetailsResponse, "viewport">;
		label: string;
	};

	/** プレースホルダー */
	placeholder?: string;

	/** 「現在地」ボタンで使う表示ラベル（例: i18n.t("Search.currentLocation")） */
	currentLocationLabel?: string;

	/** 検索開始の最小文字数（デフォルト: 1） */
	minSearchLength?: number;

	/** debounce の ms（デフォルト: 300） */
	debounceMs?: number;

	/** autoFocus など既存の挙動は必要に応じて踏襲 */
	autofocus?: boolean;
	testID?: string;

	/**
	 * #681 【設計】サジェスト選択時のカスタムハンドラ（オプション）
	 * - 指定された場合、自動的な location details 取得をスキップし、このコールバックを呼ぶ
	 * - selectRestaurant.tsx などの特殊なケースで使用
	 */
	onSuggestionSelect?: (suggestion: AutocompleteLocation) => void | Promise<void>;
}

/**
 * #681 【設計】場所検索のロジック込みのスマートコンポーネント
 * - 内部で inputText と selectedLabel を管理
 * - フォーカス時に selectedLabel があれば自動クリア
 * - 1文字から検索可能（minSearchLength でカスタマイズ可能）
 * - 現在地ボタンを内蔵
 */
export function LocationAutocomplete({
	onLocationChange,
	initialLocation,
	placeholder = i18n.t("Search.placeholders.enterLocation"),
	currentLocationLabel = i18n.t("Search.currentLocation"),
	minSearchLength = 1,
	debounceMs = 300,
	autofocus = false,
	testID = "location-autocomplete",
	onSuggestionSelect,
}: LocationAutocompleteProps) {
	// #681 【設計】子側で持つ state：inputText と selectedLabel
	const [inputText, setInputText] = useState("");
	const [selectedLabel, setSelectedLabel] = useState<string | null>(initialLocation?.label || null);
	const [showSuggestions, setShowSuggestions] = useState(false);
	const [isFocused, setIsFocused] = useState(false);
	const inputRef = useRef<TextInput>(null);
	const debounceRef = useRef<number | null>(null);

	const { suggestions, isSearching, searchLocations, getCurrentLocation, getLocationDetails } = useLocationSearch();
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

	// #681 【設計】TextInput の表示値は selectedLabel ?? inputText
	const displayValue = selectedLabel ?? inputText;

	// #681 【設計】Handle text changes with debouncing
	const handleTextChange = useCallback(
		(text: string) => {
			setInputText(text);

			// Clear previous debounce timer
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
			}

			// Show suggestions if there's text and input is focused
			setShowSuggestions(text.length > 0 && isFocused);

			// #681 【設計】minSearchLength 以上で検索 API を呼ぶ（デフォルト 1 文字）
			if (text.length >= minSearchLength) {
				debounceRef.current = setTimeout(() => {
					searchLocations(text).catch((error) => {
						console.warn("Location search failed:", error);
					});
				}, debounceMs);
			}
		},
		[searchLocations, isFocused, minSearchLength, debounceMs],
	);

	// #681 【設計】Handle input focus - selectedLabel があれば自動クリア
	const handleFocus = useCallback(() => {
		setIsFocused(true);
		// #681 【設計】selectedLabel が存在する場合、フォーカス時にクリアして検索可能にする
		if (selectedLabel) {
			setInputText("");
			setSelectedLabel(null);
			setShowSuggestions(false);
		} else {
			setShowSuggestions(inputText.length > 0);
		}
	}, [selectedLabel, inputText.length]);

	// Handle input blur
	const handleBlur = useCallback(() => {
		// Delay hiding suggestions to allow for suggestion selection
		setTimeout(() => {
			setIsFocused(false);
			setShowSuggestions(false);
		}, 150);
	}, []);

	// #681 【設計】Handle suggestion selection - Place Details を取得して親に通知
	// または onSuggestionSelect が指定されている場合はそれを呼ぶ
	const handleSuggestionPress = useCallback(
		async (suggestion: AutocompleteLocation) => {
			lightImpact();

			// #681 【設計】カスタムハンドラが指定されている場合はそちらを優先
			if (onSuggestionSelect) {
				setSelectedLabel(suggestion.mainText);
				setInputText(suggestion.mainText);
				setShowSuggestions(false);
				await onSuggestionSelect(suggestion);
				setTimeout(() => {
					inputRef.current?.blur();
				}, 100);
				return;
			}

			// デフォルトの動作: location details を取得
			try {
				const locationDetails = await getLocationDetails(suggestion);
				// #681 【設計】selectedLabel に mainText をセット、inputText も合わせる
				setSelectedLabel(suggestion.mainText);
				setInputText(suggestion.mainText);
				setShowSuggestions(false);
				// #681 【設計】親に location と label を返す（viewport は除外）
				const { viewport, ...locationWithoutViewport } = locationDetails;
				onLocationChange?.({
					location: locationWithoutViewport,
					label: suggestion.mainText,
				});
				// Delay the blur to allow the parent state update to complete
				setTimeout(() => {
					inputRef.current?.blur();
				}, 100);
			} catch (error) {
				console.error("Failed to get location details:", error);
				// エラー時も一旦選択状態にする（親側でエラー処理）
				setSelectedLabel(suggestion.mainText);
				setInputText(suggestion.mainText);
				setShowSuggestions(false);
			}
		},
		[getLocationDetails, lightImpact, onLocationChange, onSuggestionSelect],
	);

	// #681 【設計】Handle clear button press
	const handleClear = useCallback(() => {
		lightImpact();
		setInputText("");
		setSelectedLabel(null);
		onLocationChange?.({ location: null, label: null });
		inputRef.current?.focus();
	}, [lightImpact, onLocationChange]);

	// #681 【設計】現在地ボタンの処理
	const handleUseCurrentLocation = useCallback(async () => {
		lightImpact();
		try {
			const currentLocation = await getCurrentLocation();
			// #681 【設計】selectedLabel に currentLocationLabel をセット
			const label = currentLocationLabel || i18n.t("Search.currentLocation");
			setSelectedLabel(label);
			setInputText("");
			setShowSuggestions(false);
			// #681 【設計】親に現在地情報を返す
			onLocationChange?.({
				location: currentLocation,
				label: label,
			});
			inputRef.current?.blur();
		} catch (error) {
			console.error("Failed to get current location:", error);
			// エラーは親側で処理してもらう想定だが、ここでもログ出力
		}
	}, [getCurrentLocation, currentLocationLabel, lightImpact, onLocationChange]);

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
					value={displayValue}
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
				{displayValue.length > 0 && (
					<TouchableOpacity
						style={styles.clearButton}
						onPress={handleClear}
						accessibilityRole="button"
						accessibilityLabel="Clear location"
						testID={`${testID}-clear`}>
						<X size={16} color="#6B7280" />
					</TouchableOpacity>
				)}
				{/* #681 【設計】現在地ボタンを内蔵 */}
				<TouchableOpacity
					style={styles.currentLocationButton}
					onPress={handleUseCurrentLocation}
					accessibilityRole="button"
					accessibilityLabel={currentLocationLabel}
					testID={`${testID}-current-location`}>
					<Navigation size={20} color="#5EA2FF" />
				</TouchableOpacity>
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
			{showSuggestions && !isSearching && suggestions.length === 0 && inputText.length >= minSearchLength && (
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
	currentLocationButton: {
		padding: 16,
		borderLeftWidth: 0.5,
		borderLeftColor: "#E5E7EB",
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
