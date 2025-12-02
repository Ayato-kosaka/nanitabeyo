import React, { useState, useCallback, useEffect, useRef } from "react";
import { View, StyleSheet } from "react-native";
import i18n from "@/lib/i18n";
import type { QueryDishCategoryVariantsResponse } from "@shared/api/v1/res";
import { DishCategoryAutocomplete } from "@/components/DishCategoryAutocomplete";

interface DishCategorySearchFormProps {
	/** Called when user selects a suggestion */
	onSuggestionSelect: (suggestion: QueryDishCategoryVariantsResponse[number]) => void;
	/** Called when user clears the input */
	onClear?: () => void;
	/** Called when the component is mounted */
	onMount?: () => void;
	/** Called when the component is unmounted */
	onUnmount?: (dishCategoryName: string) => void;
	/** Placeholder text for the autocomplete input */
	placeholder?: string;
	/** Test ID for the autocomplete input */
	testID?: string;
}

/**
 * Dish Category Search Form Component
 */
export function DishCategorySearchForm({
	onSuggestionSelect,
	onClear,
	onMount,
	onUnmount,
	placeholder = i18n.t("Map.placeholders.enterDishCategory"),
	testID,
}: DishCategorySearchFormProps) {
	// Internal state - isolated from parent re-renders
	const [dishCategoryName, setDishCategoryName] = useState("");
	/* 最新の値をアンマウント時に渡すために使用 */
	const latestRef = useRef(dishCategoryName);

	/* 最新の dishCategoryName を保持 */
	useEffect(() => {
		latestRef.current = dishCategoryName;
	}, [dishCategoryName]);

	/* ライフサイクル管理 */
	useEffect(() => {
		onMount?.();
		return () => {
			onUnmount?.(latestRef.current);
		};
	}, [onMount, onUnmount]);

	/* 提案選択ハンドラ */
	const handleSuggestionSelect = useCallback(
		(suggestion: { dishCategoryId: string; label: string }) => {
			onSuggestionSelect(suggestion);
			// 提案選択後に onUnmount 時に空文字を渡すためにリセット
			latestRef.current = "";
		},
		[onSuggestionSelect],
	);

	/* クリアハンドラ */
	const handleClear = useCallback(() => {
		onClear?.();
		setDishCategoryName("");
	}, [onClear]);

	return (
		<View style={styles.autocompleteContainer}>
			<DishCategoryAutocomplete
				value={dishCategoryName}
				onChangeText={setDishCategoryName}
				onSelectSuggestion={handleSuggestionSelect}
				onClear={handleClear}
				placeholder={i18n.t("Map.placeholders.enterDishCategory")}
				autofocus={true}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	autocompleteContainer: {
		marginHorizontal: 16,
		minHeight: 300,
	},
});
