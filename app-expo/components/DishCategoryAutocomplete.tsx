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
	Keyboard,
} from "react-native";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { useDishCategorySearch } from "@/hooks/useDishCategorySearch";
import { useHaptics } from "@/hooks/useHaptics";
import i18n from "@/lib/i18n";
import type { QueryDishCategoryVariantsResponse } from "@shared/api/v1/res";
import { ChefHat, X } from "lucide-react-native";
import { LoadingIndicator } from "./LoadingIndicator";

// #931 【設計】検索APIを呼ぶ最小文字数。showSuggestions の判定・デバウンス起動・
// 「結果なし」文言の表示条件すべてでこの値を揃え、旧実装で起きていた
// 「閾値未満でも直前の(無関係な)候補が一瞬表示される」不整合を防ぐ
const MIN_SEARCH_LENGTH = 2;
const DEBOUNCE_DELAY_MS = 300;

/**
 * #991 【修正】web で候補パネル内の mousedown の既定動作(TextInput からのフォーカス移動)を抑止する。
 * 抑止しないと mousedown → 即 blur → 150ms 後にパネル非表示が予約され、mousedown→mouseup が
 * 150ms を超える人間の普通のクリックでは押し終わる前に行が消えて onPress が発火しない
 * (詳細は LocationAutocomplete.tsx の同名定数を参照。native には mouse イベントが無く影響しない)
 */
const preventFocusStealOnWeb = {
	onMouseDown: (event: { preventDefault: () => void }) => event.preventDefault(),
} as Record<string, unknown>;

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
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const [showSuggestions, setShowSuggestions] = useState(false);
	const [isFocused, setIsFocused] = useState(false);
	// #931 【設計】デバウンス待機中(=まだAPIを呼んでいない)かどうかを保持し、
	// LocationAutocompleteと同型のバグ(デバウンス中に「結果なし」文言が一瞬フラッシュする)を防ぐ
	const [isDebouncing, setIsDebouncing] = useState(false);
	const inputRef = useRef<TextInput>(null);
	// #1092 PR3 `number` 決め打ちにしない。@types/node を app-expo の devDependency へ明示したことで
	// setTimeout の戻り値型が環境によって number / NodeJS.Timeout のどちらにも解決しうるため
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

			const hasEnoughChars = text.length >= MIN_SEARCH_LENGTH;

			// #931 【修正】検索閾値未満では候補欄自体を出さない。
			// 従来は text.length > 0 で表示していたため、1文字だけ入力した際に
			// 直前の(無関係な)候補が API 未呼び出しのまま一瞬表示されるバグがあった。
			setShowSuggestions(hasEnoughChars && isFocused);

			if (!hasEnoughChars) {
				setIsDebouncing(false);
				return;
			}

			// #931 【設計】デバウンス待機中フラグを立て、「結果なし」文言のフラッシュを防ぐ
			setIsDebouncing(true);

			// 2文字以上でAPI呼び出し（300msデバウンス）
			debounceRef.current = setTimeout(() => {
				setIsDebouncing(false);
				searchDishCategories(text).catch((error) => {
					console.warn("Dish category search failed:", error);
				});
			}, DEBOUNCE_DELAY_MS);
		},
		[onChangeText, searchDishCategories, isFocused],
	);

	// フォーカス時のハンドラ
	const handleFocus = useCallback(() => {
		setIsFocused(true);
		setShowSuggestions(value.length >= MIN_SEARCH_LENGTH);

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
			// #528 【設計】キーボードを閉じる責務は子（＝候補を押されたこのコンポーネント）が持つ。
			// 以前は親の BlurModal がタップ**開始**時に閉じており、レイアウト再計算で候補リストが
			// unmount されて onPress が潰れていた。onPress まで来ていればタップは成立済み。
			// 詳細は LocationAutocomplete.tsx の同じ箇所を参照。
			Keyboard.dismiss();
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
		setShowSuggestions(false);

		// #931 【修正】保留中のデバウンスタイマーが残っていると、クリア後に
		// 前回入力に対する検索が発火し候補が復活してしまうため破棄する
		if (debounceRef.current) {
			clearTimeout(debounceRef.current);
		}
		setIsDebouncing(false);

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
	// #931 【修正】isDebouncing 中は suggestions が直前検索の残留値のままのため、
	// 確定前に「0件」または誤った件数を読み上げてしまわないようガードを追加
	useEffect(() => {
		if (!isDebouncing && !isSearching && showSuggestions && (Platform.OS === "ios" || Platform.OS === "android")) {
			const count = suggestions.length;
			if (count > 0) {
				AccessibilityInfo.announceForAccessibility(i18n.t("Map.accessibility.dishCategorySuggestionsFound", { count }));
			} else if (value.length >= MIN_SEARCH_LENGTH) {
				AccessibilityInfo.announceForAccessibility(i18n.t("Map.accessibility.dishCategoryNoResults"));
			}
		}
	}, [isDebouncing, isSearching, suggestions.length, showSuggestions, value.length]);

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
					placeholderTextColor={colors.textSecondary}
					autoComplete="off"
					autoCorrect={false}
					autoCapitalize="words"
					keyboardType="default"
					returnKeyType="search"
					accessibilityLabel={i18n.t("Map.inputs.dishCategory")}
					accessibilityHint={i18n.t("Map.accessibility.dishCategoryInputHint")}
					testID={`${testID}-input`}
				/>
				{/* クリアボタン */}
				{value.length > 0 && (
					<TouchableOpacity
						style={styles.clearButton}
						onPress={handleClear}
						accessibilityRole="button"
						accessibilityLabel={i18n.t("Map.accessibility.clearDishCategory")}
						testID={`${testID}-clear`}>
						<X size={16} color={colors.textSecondary} />
					</TouchableOpacity>
				)}
				{renderInputRight && renderInputRight}
			</View>

			{/* #931 ローディングインジケーター: デバウンス待機中とAPI呼び出し中の両方で表示する */}
			{(isDebouncing || isSearching) && (
				<View style={styles.loadingContainer}>
					<LoadingIndicator size="small" />
					<Text style={styles.loadingText}>{i18n.t("Profile.loading")}</Text>
				</View>
			)}

			{/* 候補リスト */}
			{showSuggestions && suggestions.length > 0 && (
				<View style={styles.suggestionsContainer} {...preventFocusStealOnWeb}>
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
								accessibilityHint={i18n.t("Map.accessibility.selectDishCategory")}
								testID={`${testID}-suggestion-${index}`}>
								<ChefHat size={16} color={colors.textSecondary} />
								<View style={styles.suggestionText}>
									<Text style={styles.suggestionMainText}>{suggestion.label}</Text>
								</View>
							</TouchableOpacity>
						))}
					</ScrollView>
				</View>
			)}

			{/* #931 結果なしメッセージ: デバウンス待機中/検索中は出さず、確定後のみ表示する */}
			{showSuggestions &&
				!isDebouncing &&
				!isSearching &&
				suggestions.length === 0 &&
				value.length >= MIN_SEARCH_LENGTH && (
					<View style={styles.noResultsContainer}>
						<Text style={styles.noResultsText}>{i18n.t("Map.noResultsFound")}</Text>
					</View>
				)}
		</View>
	);
}

/*
#1509 【設計】料理カテゴリの検索欄と候補パネル。

`DishCategorySearchForm` 経由でレビュー投稿フォームからも使われるので、ここが直書きのままだと
**暗い画面の中に白い箱だけが浮く**（実測: run 32693792452 の dark-dish-category）。
影の色だけはテーマで振らない（`FixedColors.shadow`。暗面では実質見えない値）。
*/
const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: { flex: 1 },
		dishCategoryInputContainer: {
			flexDirection: "row",
			alignItems: "center",
			borderRadius: 16,
			backgroundColor: c.surfaceMuted,
			shadowColor: FixedColors.shadow,
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
			color: c.textPrimary,
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
			backgroundColor: c.surface,
			borderRadius: 16,
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 0 },
			shadowOpacity: 0.1,
			shadowRadius: 24,
			elevation: 4,
		},
		loadingText: {
			marginLeft: 8,
			fontSize: 14,
			color: c.textSecondary,
		},
		suggestionsContainer: {
			marginTop: 12,
			backgroundColor: c.surface,
			borderRadius: 16,
			shadowColor: FixedColors.shadow,
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
			borderBottomColor: c.divider,
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
			color: c.textPrimary,
			fontWeight: "600",
		},
		noResultsContainer: {
			minHeight: 60,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.surface,
			borderRadius: 12,
			marginTop: 12,
			paddingVertical: 20,
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 0 },
			shadowOpacity: 0.1,
			shadowRadius: 24,
			elevation: 4,
		},
		noResultsText: {
			fontSize: 14,
			color: c.textSecondary,
		},
	});
