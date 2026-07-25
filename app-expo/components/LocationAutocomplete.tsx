import React, { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { useLocationSearch, type LocationSearchStatus } from "@/hooks/useLocationSearch";
import { useHaptics } from "@/hooks/useHaptics";
import i18n from "@/lib/i18n";
import { type AutocompleteLocation } from "@shared/api/v1/res";
import { isFoodAndDrinkPlaceForUser } from "@shared/utils/google_places_restaurant_type";
import { MapPin, Utensils, X } from "lucide-react-native";
import { LoadingIndicator } from "./LoadingIndicator";

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
}: LocationAutocompleteProps) {
	const [showSuggestions, setShowSuggestions] = useState(false);
	const [isFocused, setIsFocused] = useState(false);
	// #931 【設計】デバウンス待機中(=まだAPIを呼んでいない)かどうかはHookの外側(このコンポーネント)でしか
	// 分からないため、ローカルで保持しHookの status と合成して表示状態を決定する。
	const [isDebouncing, setIsDebouncing] = useState(false);
	const inputRef = useRef<TextInput>(null);
	const debounceRef = useRef<number | null>(null);
	// #931 【設計】ブラーによる遅延非表示タイマー。フォーカスが戻った場合はキャンセルする必要がある
	// (例: 再試行ボタン押下でクリック直後に blur→非表示が予約された後、focus() で復帰するケース)
	const blurTimeoutRef = useRef<number | null>(null);
	// #931 【設計】エラー時の再試行ボタンで直前のクエリを再実行するために保持
	const lastQueryRef = useRef("");

	const { suggestions, status, searchLocations, clearSuggestions } = useLocationSearch();
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

			// #931 【修正】検索条件を満たさない場合は Hook 側の候補も破棄する。
			// 従来は表示フラグを畳むだけで suggestions が残存し、再入力の1文字目で
			// 直前の(無関係な)候補が一瞬再表示されるバグがあった。
			if (!hasEnoughChars) {
				setIsDebouncing(false);
				clearSuggestions();
				return;
			}

			// #931 【設計】デバウンス待機中フラグを立てる。この間は "debouncing" として
			// ローディング表示のみ行い、0件文言のフラッシュを防ぐ。
			setIsDebouncing(true);

			// Debounce the API call
			debounceRef.current = setTimeout(() => {
				setIsDebouncing(false);
				lastQueryRef.current = trimmed;
				searchLocations(trimmed).catch((error) => {
					console.warn("Location search failed:", error);
				});
			}, DEBOUNCE_DELAY_MS) as unknown as number;
		},
		[onChangeText, searchLocations, isFocused, clearSuggestions],
	);

	// Handle input focus
	const handleFocus = useCallback(() => {
		// #931 【修正】直前の blur による遅延非表示予約が残っている場合はキャンセルする。
		// キャンセルしないと、再フォーカス直後に表示した結果パネルが遅れて閉じてしまう
		// (再試行ボタン押下 → blur予約 → focus復帰 → 予約がそのまま発火、という不具合があった)
		if (blurTimeoutRef.current) {
			clearTimeout(blurTimeoutRef.current);
			blurTimeoutRef.current = null;
		}

		setIsFocused(true);

		if (autoClearOnFocus && value.length > 0) {
			// クリアボタンと同じ順序に揃える
			onChangeText("");
			onClear?.();

			// #931 【修正】自動クリア時も Hook 側の候補・状態を初期化し、
			// 直後の入力で無関係な旧候補が再表示されないようにする
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
			}
			setIsDebouncing(false);
			clearSuggestions();

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
		blurTimeoutRef.current = setTimeout(() => {
			setIsFocused(false);
			setShowSuggestions(false);
			blurTimeoutRef.current = null;
		}, BLUR_SUGGESTION_HIDE_DELAY_MS) as unknown as number;
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

	// Handle clear button press
	const handleClear = useCallback(() => {
		lightImpact();
		onChangeText("");
		setShowSuggestions(false);

		// #931 【修正】クリア操作では query だけでなく Hook 側の候補・状態も同時初期化する
		// (座標や選択状態の初期化は onClear 経由で呼び出し元の handleLocationClear が担う)
		if (debounceRef.current) {
			clearTimeout(debounceRef.current);
		}
		setIsDebouncing(false);
		clearSuggestions();

		if (onClear) {
			onClear();
		}
		inputRef.current?.focus();
	}, [onChangeText, onClear, lightImpact, clearSuggestions]);

	// Cleanup debounce timer on unmount
	useEffect(() => {
		return () => {
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
			}
			if (blurTimeoutRef.current) {
				clearTimeout(blurTimeoutRef.current);
			}
		};
	}, []);

	// #931 【設計】検索失敗時の再試行。直前に実際に投げたクエリ(lastQueryRef)を再送する。
	// 再試行ボタンはTextInputの外側にあるため押下でblurが発生し結果パネルが閉じてしまう。
	// 明示的に再フォーカスして handleFocus 側のキャンセル処理でパネルを開いたままにする。
	const handleRetry = useCallback(() => {
		if (!lastQueryRef.current) return;
		inputRef.current?.focus();
		searchLocations(lastQueryRef.current).catch((error) => {
			console.warn("Location search retry failed:", error);
		});
	}, [searchLocations]);

	const trimmedValueLength = value.trim().length;
	const hasEnoughCharsForSearch = trimmedValueLength >= MIN_SEARCH_LENGTH;

	// #931 【設計】デバウンス待機中はHookの検索がまだ始まっていないため、ローカルの isDebouncing を
	// 優先した合成ステータスを画面表示に使う。これにより「デバウンス中に0件文言が一瞬出る」バグを防ぐ。
	const displayStatus: LocationSearchStatus | "idle" = !hasEnoughCharsForSearch
		? "idle"
		: isDebouncing
			? "debouncing"
			: status;

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
						accessibilityRole="button"
						accessibilityLabel={i18n.t("Search.accessibility.clearLocation")}
						testID={`${testID}-clear`}>
						<X size={16} color="#6B7280" />
					</TouchableOpacity>
				)}
				{renderInputRight}
			</View>

			{/* #931 Loading indicator: デバウンス待機中とAPI呼び出し中の両方で表示する */}
			{(displayStatus === "debouncing" || displayStatus === "searching") && (
				<View style={styles.loadingContainer}>
					<LoadingIndicator size="small" />
					<Text style={styles.loadingText}>{i18n.t("Search.loading")}</Text>
				</View>
			)}

			{/* Suggestions List */}
			{showSuggestions && displayStatus === "success" && suggestions.length > 0 && (
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

			{/* #931 No results message: 0件が確定した(status === "empty")ときのみ表示し、
			    デバウンス待機中/検索中に一瞬フラッシュしないようにする */}
			{showSuggestions && displayStatus === "empty" && (
				<View style={styles.noResultsContainer}>
					<Text style={styles.noResultsText}>{i18n.t("Search.noLocationsFound")}</Text>
				</View>
			)}

			{/* #931 Error message: 0件(=正常応答)とは別文言で表示し、再試行を提供する */}
			{showSuggestions && displayStatus === "error" && (
				<View style={styles.noResultsContainer}>
					<Text style={styles.noResultsText}>{i18n.t("Search.errors.searchFailed")}</Text>
					<TouchableOpacity
						style={styles.retryButton}
						onPress={handleRetry}
						accessibilityRole="button"
						accessibilityLabel={i18n.t("Common.retry")}
						testID={`${testID}-retry`}>
						<Text style={styles.retryButtonText}>{i18n.t("Common.retry")}</Text>
					</TouchableOpacity>
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
	retryButton: {
		marginTop: 12,
		backgroundColor: "#F05537",
		paddingHorizontal: 20,
		paddingVertical: 10,
		borderRadius: 20,
	},
	retryButtonText: {
		color: "#FFFFFF",
		fontWeight: "600",
		fontSize: 14,
	},
});
