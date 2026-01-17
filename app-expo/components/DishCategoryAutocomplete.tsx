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
import { useDishCategorySearch } from "@/hooks/useDishCategorySearch";
import { useHaptics } from "@/hooks/useHaptics";
import i18n from "@/lib/i18n";
import type { QueryDishCategoryVariantsResponse } from "@shared/api/v1/res";
import { ChefHat, X } from "lucide-react-native";

interface DishCategoryAutocompleteProps {
	/** 入力値 */
	value: string;
	/** テキスト変更時のコールバック */
	onChangeText: (text: string) => void;
	/** 候補選択時のコールバック */
	onSelectSuggestion: (suggestion: QueryDishCategoryVariantsResponse[number]) => void;
	/** クリアボタン押下時のコールバック */
	onClear?: () => void;
	/** プレースホルダー */
	placeholder?: string;
	/** 右側に追加表示する要素 */
	renderInputRight?: React.ReactNode;
	/** マウント時に自動フォーカスするか */
	autofocus?: boolean;
	/** テスト用ID */
	testID?: string;
}

/**
 * 料理カテゴリのオートコンプリートコンポーネント
 * LocationAutocompleteの実装パターンを踏襲し、
 * デバウンス、API呼び出し、キーボードナビゲーション、アクセシビリティに対応
 */
export function DishCategoryAutocomplete({
	value,
	onChangeText,
	onSelectSuggestion,
	onClear,
	placeholder = i18n.t("Map.placeholders.enterDishCategory"),
	autofocus = false,
	renderInputRight,
	testID = "dish-category-autocomplete",
}: DishCategoryAutocompleteProps) {
	const [showSuggestions, setShowSuggestions] = useState(false);
	const [isFocused, setIsFocused] = useState(false);
	const inputRef = useRef<TextInput>(null);
	const debounceRef = useRef<number | null>(null);

	const { suggestions, isSearching, searchDishCategories } = useDishCategorySearch();
	const { lightImpact } = useHaptics();

	// マウント時に自動フォーカス
	useEffect(() => {
		if (autofocus) {
			const timer = setTimeout(() => {
				inputRef.current?.focus();
			}, 100);
			return () => clearTimeout(timer);
		}
	}, [autofocus]);

	// テキスト変更時のハンドラ（デバウンス付き）
	const handleTextChange = useCallback(
		(text: string) => {
			onChangeText(text);

			// 前回のデバウンスタイマーをクリア
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
			}

			// テキストがあり、フォーカス中の場合は候補を表示
			setShowSuggestions(text.length > 0 && isFocused);

			// 2文字以上でAPI呼び出し（300msデバウンス）
			if (text.length >= 2) {
				debounceRef.current = setTimeout(() => {
					searchDishCategories(text).catch((error) => {
						console.warn("Dish category search failed:", error);
					});
				}, 300);
			}
		},
		[onChangeText, searchDishCategories, isFocused],
	);

	// フォーカス時のハンドラ
	const handleFocus = useCallback(() => {
		setIsFocused(true);
		setShowSuggestions(value.length > 0);

		// アクセシビリティ告知
		if (Platform.OS === "ios" || Platform.OS === "android") {
			AccessibilityInfo.announceForAccessibility(i18n.t("Map.accessibility.dishCategoryInputFocused"));
		}
	}, [value.length]);

	// ブラー時のハンドラ
	const handleBlur = useCallback(() => {
		// 候補選択を許可するため、少し遅延させてから非表示
		setTimeout(() => {
			setIsFocused(false);
			setShowSuggestions(false);
		}, 150);
	}, []);

	// 候補選択時のハンドラ
	const handleSuggestionPress = useCallback(
		(suggestion: QueryDishCategoryVariantsResponse[number]) => {
			lightImpact();
			onSelectSuggestion(suggestion);
			setShowSuggestions(false);

			// アクセシビリティ告知
			if (Platform.OS === "ios" || Platform.OS === "android") {
				AccessibilityInfo.announceForAccessibility(
					i18n.t("Map.accessibility.dishCategorySelected", { category: suggestion.label }),
				);
			}

			// 親の状態更新完了を待ってからブラー
			setTimeout(() => {
				inputRef.current?.blur();
			}, 100);
		},
		[onSelectSuggestion, lightImpact],
	);

	// クリアボタン押下時のハンドラ
	const handleClear = useCallback(() => {
		lightImpact();
		onChangeText("");
		if (onClear) {
			onClear();
		}
		inputRef.current?.focus();
	}, [onChangeText, onClear, lightImpact]);

	// アンマウント時にデバウンスタイマーをクリーンアップ
	useEffect(() => {
		return () => {
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
			}
		};
	}, []);

	// ローディング状態が変わった時のアクセシビリティ告知
	useEffect(() => {
		if (isSearching && (Platform.OS === "ios" || Platform.OS === "android")) {
			AccessibilityInfo.announceForAccessibility(i18n.t("Map.accessibility.dishCategorySearching"));
		}
	}, [isSearching]);

	// 検索結果が変わった時のアクセシビリティ告知
	useEffect(() => {
		if (!isSearching && showSuggestions && (Platform.OS === "ios" || Platform.OS === "android")) {
			const count = suggestions.length;
			if (count > 0) {
				AccessibilityInfo.announceForAccessibility(i18n.t("Map.accessibility.dishCategorySuggestionsFound", { count }));
			} else if (value.length >= 2) {
				AccessibilityInfo.announceForAccessibility(i18n.t("Map.accessibility.dishCategoryNoResults"));
			}
		}
	}, [isSearching, suggestions.length, showSuggestions, value.length]);

	return (
		<View style={styles.container}>
			<View style={styles.dishCategoryInputContainer}>
				{/* テキスト入力 */}
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
					accessibilityLabel={i18n.t("Map.inputs.dishCategory")}
					accessibilityHint="Enter a dish category to search"
					testID={`${testID}-input`}
				/>
				{/* クリアボタン */}
				{value.length > 0 && (
					<TouchableOpacity
						style={styles.clearButton}
						onPress={handleClear}
						accessibilityRole="button"
						accessibilityLabel="Clear dish category"
						testID={`${testID}-clear`}>
						<X size={16} color="#6B7280" />
					</TouchableOpacity>
				)}
				{renderInputRight && renderInputRight}
			</View>

			{/* ローディングインジケーター */}
			{isSearching && (
				<View style={styles.loadingContainer}>
					<ActivityIndicator size="small" color="#F05537" />
					<Text style={styles.loadingText}>{i18n.t("Profile.loading")}</Text>
				</View>
			)}

			{/* 候補リスト */}
			{showSuggestions && suggestions.length > 0 && (
				<View style={styles.suggestionsContainer}>
					<ScrollView
						keyboardShouldPersistTaps="handled"
						showsVerticalScrollIndicator={false}
						style={styles.suggestionsList}
						testID={`${testID}-suggestions`}>
						{suggestions.map((suggestion, index) => (
							<TouchableOpacity
								key={`${suggestion.dishCategoryId}-${index}`}
								style={[styles.suggestionItem, index === suggestions.length - 1 && styles.lastSuggestionItem]}
								onPress={() => handleSuggestionPress(suggestion)}
								accessibilityRole="button"
								accessibilityLabel={suggestion.label}
								accessibilityHint="Select this dish category"
								testID={`${testID}-suggestion-${index}`}>
								<ChefHat size={16} color="#6B7280" />
								<View style={styles.suggestionText}>
									<Text style={styles.suggestionMainText}>{suggestion.label}</Text>
								</View>
							</TouchableOpacity>
						))}
					</ScrollView>
				</View>
			)}

			{/* 結果なしメッセージ */}
			{showSuggestions && !isSearching && suggestions.length === 0 && value.length >= 2 && (
				<View style={styles.noResultsContainer}>
					<Text style={styles.noResultsText}>{i18n.t("Map.noResultsFound")}</Text>
				</View>
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1 },
	dishCategoryInputContainer: {
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
