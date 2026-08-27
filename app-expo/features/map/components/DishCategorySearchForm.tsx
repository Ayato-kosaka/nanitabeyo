import React, { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import { type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";
import i18n from "@/lib/i18n";
import type { QueryDishCategoryVariantsResponse } from "@shared/api/v1/res";
import { Card } from "@/components/Card";
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
	/**
	 * 見出し。`null` を渡すと描かない。
	 *
	 * #1386 ルート（`app/[locale]/restaurant/[restaurantId]/dish-category.tsx`）に
	 * 載せるときは `ScreenHeader` がタイトルを持つため `null` を渡す。
	 * `features/profile/components/LocationSearchForm.tsx` と同じ形。
	 */
	title?: string | null;
	/** Test ID for the autocomplete input */
	testID?: string;
}

/**
 * Dish Category Search Form Component
 *
 * #1130 【修正】BlurModal の中身が SafeArea へ食い込んでいた。
 * 旧実装は `marginHorizontal` だけの素の View だったため、中身の上端は BlurModal の
 * `paddingVertical`（既定 32）ぶんしか下がらず、Android のステータスバー領域に重なっていた。
 * 見本として指定された「保存料理カテゴリの地点検索」（features/profile/components/LocationSearchForm.tsx）と
 * 同じく Card（margin 16 + paddingVertical 20）＋タイトルの構成に揃え、中身の上端を
 * 32 + 16 + 20 = 68px まで下げる。× ボタンは BlurModal 側で `top: insets.top` に絶対配置されており
 * SafeArea にかかったままで良い（Issue 本文の指定どおり）ので、共通実装には手を入れていない。
 */
export function DishCategorySearchForm({
	onSuggestionSelect,
	onClear,
	onMount,
	onUnmount,
	placeholder = i18n.t("Map.placeholders.enterDishCategory"),
	title = i18n.t("Map.actions.selectDishCategory"),
	testID,
}: DishCategorySearchFormProps) {
	const styles = useThemedStyles(createStyles);
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
		<Card>
			{title ? <Text style={styles.modalTitle}>{title}</Text> : null}
			<View style={styles.autocompleteContainer}>
				<DishCategoryAutocomplete
					value={dishCategoryName}
					onChangeText={setDishCategoryName}
					onSelectSuggestion={handleSuggestionSelect}
					onClear={handleClear}
					placeholder={placeholder}
					autofocus={true}
					testID={testID}
				/>
			</View>
		</Card>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		// LocationSearchForm.tsx の modalTitle と同じ指定（見本に揃えるため）
		modalTitle: {
			fontSize: 18,
			fontWeight: "700",
			color: c.textPrimary,
			marginBottom: 16,
			textAlign: "center",
			letterSpacing: -0.3,
		},
		autocompleteContainer: {
			// 左右の余白は Card（margin 16 + paddingHorizontal 16）が持つため marginHorizontal は不要。
			// 候補リストが出るまでモーダルの高さが跳ねないよう minHeight は維持する
			minHeight: 300,
		},
	});
