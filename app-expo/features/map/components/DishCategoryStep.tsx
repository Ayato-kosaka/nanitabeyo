/*
#1375（6 巡目・オーナー指示）**記録フローの 1 歩目は «料理カテゴリー» にする。**

## 何が変わったか

5 巡目までの「食べたを記録」は
「お店を選ぶ → **写真を選ぶ** → 一言レビュー・料理カテゴリー・料金・おすすめ度」
の順だった。オーナーの指示は

  お店を選ぶ → **料理カテゴリーを選ぶ** → 写真を選ぶ（選ばなくてもよい）→ 残り

である。理由は写真の選び方に効く: 先に料理が決まっていれば、**その料理の既存の写真**を
「この店の写真から選ぶ」に出せる。順序が逆だと «どの料理か分からないまま写真を探す» になる。

## この部品がやること

- 未入力のあいだは、そのお店で既に記録がある料理カテゴリーを **縦に全部**並べて選ばせる
  （`useRestaurantDishCategories`。API は増やさず、店舗フィードの既存 1 本から数える）
- 打ち始めたら **料理カテゴリーのマスタも引く**（`GET /v1/dish-category-variants`）。
  #1629 のオーナー実機報告「オートコンプリートじゃない / 背脂ラーメンと打っても出ない」への対処で、
  その店にまだ記録が無い料理も候補に出る（詳細は下の `visible` のコメント）
- どちらにも無ければ **自由入力**で決める（打った名前は呼び出し側が新規カテゴリとして作る）

「縦グリッド」と言われているが 1 列の縦並びにしている。カテゴリー名は
「味玉ラーメン」のように長さがまちまちで、2 列にすると片方だけ 2 行になって
行の高さが揃わない。押す対象としても 1 行 1 件のほうが外しにくい。

## 一覧が空のときは «入力だけ» になる

新しい店（まだ誰も記録していない）では候補が 0 件になる。そのときは見出しも出さず、
入力欄と «この名前で決める» だけを出す。空の一覧の枠だけが残ると «壊れている» に見える。
*/
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Search, Utensils } from "lucide-react-native";

import i18n from "@/lib/i18n";
import { type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { useRestaurantDishCategories } from "@/features/map/hooks/useRestaurantDishCategories";
import { useDishCategorySearch } from "@/hooks/useDishCategorySearch";

/** 入力が止まってからマスタを引くまでの猶予（`RestaurantNameSearch` と揃える） */
const SEARCH_DEBOUNCE_MS = 300;

export type DishCategoryStepProps = {
	restaurantId: string;
	/** 一覧から選んだとき。呼び出し側は id と名前の両方を確定できる */
	onSelectExisting: (category: { dishCategoryId: string; label: string }) => void;
	/** 一覧に無い名前を打って決めたとき。呼び出し側が新規カテゴリを作る */
	onSubmitTyped: (name: string) => void;
	testID?: string;
};

export function DishCategoryStep({ restaurantId, onSelectExisting, onSubmitTyped, testID }: DishCategoryStepProps) {
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { categories, isLoading } = useRestaurantDishCategories(restaurantId);
	const [query, setQuery] = useState("");

	/*
	#1629【オーナー実機報告】**ここをオートコンプリートにする。**

	> 料理カテゴリーを選択するボックスがオートコンプリートじゃなくて «寿司で決める» とか
	> 出てくるのって、そういう仕様仕組みなんでしたっけ。オートコンプリートの方が使いやすい。
	> このお店検索のボックスが何を入力しても出ないのがちょっと気になりますね。
	> 背脂ラーメンってカタカナで打っても出ない。

	原因は、この欄が **その店に «既に記録がある» 料理しか見ていなかった**こと
	（`useRestaurantDishCategories`）。その店の初めての料理を記録するときは候補が 0 件なので、
	何を打っても «◯◯ で決める» しか出ない ＝ オートコンプリートに見えない。

	料理カテゴリーのマスタを引く API は既にある（`GET /v1/dish-category-variants?q=&lang=`。
	SNS 取り込み画面 `add-record.tsx` の ③ が同じものを使っている）。打ち始めたらそちらも引き、
	**その店の候補 → マスタの候補** の順で並べる（同じ id は 1 回だけ）。

	«◯◯ で決める»（自由入力 → 新規カテゴリ作成）は残す。**候補が 1 件も無いときだけ**出す。
	マスタに無い料理を記録する唯一の道なので、消すと行き止まりになる。
	*/
	const { suggestions, searchDishCategories } = useDishCategorySearch();
	const trimmed = query.trim();

	// ⚠️ 1 文字打つたびに叩かない。確定は «入力が止まってから»（RestaurantNameSearch と同じ 300ms）
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => {
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => {
			debounceRef.current = null;
			void searchDishCategories(trimmed);
		}, SEARCH_DEBOUNCE_MS);
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [searchDishCategories, trimmed]);

	/** その店の候補（名前で絞り込み）→ マスタの候補。同じ id は 1 回だけ出す */
	const visible = useMemo(() => {
		if (!trimmed) return categories;
		const lowered = trimmed.toLowerCase();
		const mine = categories.filter((category) => category.label.toLowerCase().includes(lowered));
		const seen = new Set(mine.map((category) => category.dishCategoryId));
		const fromMaster = suggestions
			.filter((suggestion) => suggestion.dishCategoryId && suggestion.label && !seen.has(suggestion.dishCategoryId))
			.map((suggestion) => ({
				dishCategoryId: suggestion.dishCategoryId,
				label: suggestion.label,
				// マスタ由来はその店での件数を持たない。件数の «0» を出すと «0 件ある» に読めるので出さない
				count: null as number | null,
			}));
		return [...mine, ...fromMaster];
	}, [categories, suggestions, trimmed]);

	const handleSubmit = useCallback(() => {
		if (!trimmed) return;
		// 打った名前が候補と完全一致するなら、新規作成ではなくその候補を選ぶ
		const exact = visible.find((category) => category.label.toLowerCase() === trimmed.toLowerCase());
		if (exact) {
			onSelectExisting({ dishCategoryId: exact.dishCategoryId, label: exact.label });
			return;
		}
		onSubmitTyped(trimmed);
	}, [onSelectExisting, onSubmitTyped, trimmed, visible]);

	return (
		<View style={styles.container} testID={testID}>
			<View style={styles.headingRow}>
				<Utensils size={18} color={colors.textSecondary} />
				<Text style={styles.heading}>{i18n.t("Map.actions.selectDishCategory")}</Text>
			</View>

			<View style={styles.inputContainer}>
				<Search size={18} color={colors.textSecondary} style={styles.searchIcon} />
				<TextInput
					testID={testID ? `${testID}-input` : undefined}
					style={styles.input}
					value={query}
					onChangeText={setQuery}
					placeholder={i18n.t("Map.placeholders.searchDishCategory")}
					placeholderTextColor={colors.textPlaceholder}
					returnKeyType="done"
					onSubmitEditing={handleSubmit}
				/>
			</View>

			{/* 打った名前が候補に無いときの逃げ道。«入力できること» を画面の中で見せる */}
			{trimmed.length > 0 && visible.length === 0 && (
				<TouchableOpacity
					testID={testID ? `${testID}-submit-typed` : undefined}
					style={styles.typedButton}
					onPress={handleSubmit}
					accessibilityRole="button">
					<Text style={styles.typedButtonLabel} numberOfLines={1}>
						{i18n.t("Map.actions.useTypedDishCategory", { name: trimmed })}
					</Text>
				</TouchableOpacity>
			)}

			{visible.length > 0 && (
				<>
					{!trimmed && <Text style={styles.listHeading}>{i18n.t("Map.labels.dishesAtThisRestaurant")}</Text>}
					{/* 縦に全部出す。件数の多い順は hook が並べている */}
					<ScrollView style={styles.list} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
						{/*
						⚠️ testID は **並び順**（`-item-0`, `-item-1` …）にする。カテゴリ id を入れると
						   Detox から «先頭の候補» を指せない（Detox の `by.id` は前方一致を持たず、
						   id を知らないと要素を指定できない）。#1629 でこの欄をオートコンプリートに
						   したところ、既存の Detox ヘルパーが «候補が出ると先頭を押せない» で落ちた。
						   e2e-web は `[data-testid^="review-dish-category-step-item-"]` の前方一致で
						   拾っているので、こちらの変更でも壊れない。
						   カテゴリ id は `accessibilityLabel`（表示名）と onPress の引数で足りる。
						*/}
						{visible.map((category, index) => (
							<TouchableOpacity
								key={category.dishCategoryId}
								testID={testID ? `${testID}-item-${index}` : undefined}
								style={styles.listItem}
								onPress={() => onSelectExisting({ dishCategoryId: category.dishCategoryId, label: category.label })}
								accessibilityRole="button"
								accessibilityLabel={category.label}>
								<Text style={styles.listItemLabel} numberOfLines={1} ellipsizeMode="tail">
									{category.label}
								</Text>
								{category.count !== null && <Text style={styles.listItemCount}>{category.count}</Text>}
							</TouchableOpacity>
						))}
					</ScrollView>
				</>
			)}

			{/* 候補ゼロ・未入力のときだけ «ここで打つ» と伝える（読み込み中は何も言わない） */}
			{!isLoading && categories.length === 0 && !trimmed && (
				<Text style={styles.emptyHint}>{i18n.t("Map.labels.noDishesAtThisRestaurant")}</Text>
			)}
		</View>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			gap: 12,
		},
		headingRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: 6,
		},
		heading: {
			fontSize: 14,
			fontWeight: "700",
			color: c.textPrimary,
		},
		inputContainer: {
			flexDirection: "row",
			alignItems: "center",
			borderRadius: 16,
			backgroundColor: c.surface,
			borderWidth: 1,
			borderColor: c.border,
		},
		searchIcon: {
			marginLeft: 16,
		},
		input: {
			flex: 1,
			paddingHorizontal: 12,
			paddingVertical: 16,
			fontSize: 16,
			color: c.textPrimary,
		},
		typedButton: {
			paddingHorizontal: 16,
			paddingVertical: 14,
			borderRadius: 16,
			borderWidth: 1,
			borderColor: c.brandBorder,
			backgroundColor: c.brandTint,
		},
		typedButtonLabel: {
			fontSize: 15,
			fontWeight: "700",
			color: c.brand,
		},
		listHeading: {
			fontSize: 12,
			fontWeight: "700",
			color: c.textSecondary,
		},
		list: {
			// 一覧が長くても画面を占領しない。ここだけスクロールする
			maxHeight: 320,
		},
		listItem: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			paddingHorizontal: 16,
			paddingVertical: 14,
			borderBottomWidth: StyleSheet.hairlineWidth,
			borderBottomColor: c.dividerMuted,
		},
		listItemLabel: {
			flex: 1,
			fontSize: 16,
			color: c.textPrimary,
		},
		listItemCount: {
			marginLeft: 12,
			fontSize: 13,
			color: c.textTertiary,
		},
		emptyHint: {
			fontSize: 13,
			color: c.textSecondary,
		},
	});
