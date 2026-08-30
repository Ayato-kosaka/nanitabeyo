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
- 打ち始めたら **プロジェクト標準のオートコンプリート**（`components/DishCategoryAutocomplete`）へ渡す。
  デバウンス・ローディング・アクセシビリティ・web のフォーカス問題の回避が入っており、
  SNS 取り込み画面や検索画面と **同じ見た目・同じ挙動**になる（#1629 オーナー指示）

## «この名前で決める» は置かない（#1629 オーナー指示）

> 食べたを記録の「入力文字列」で決めるボタンは不要じゃない？これ何のためにある？
> 押しても料理カテゴリが見つかりませんって出ますよ？普通にローディング＋オートコンプリートでよいかと。

自由入力は `POST /v1/dish-category-variants` を叩き、Wikidata に当たらない名前では **404 になる**。
つまり «押せるのに必ず失敗する» ボタンだった。候補から選ぶ道だけを残す。

「縦グリッド」と言われているが 1 列の縦並びにしている。カテゴリー名は
「味玉ラーメン」のように長さがまちまちで、2 列にすると片方だけ 2 行になって
行の高さが揃わない。押す対象としても 1 行 1 件のほうが外しにくい。

## 一覧が空のときは «入力だけ» になる

新しい店（まだ誰も記録していない）では候補が 0 件になる。そのときは見出しも出さず、
入力欄と «この名前で決める» だけを出す。空の一覧の枠だけが残ると «壊れている» に見える。
*/
import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Utensils } from "lucide-react-native";

import i18n from "@/lib/i18n";
import { type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { useRestaurantDishCategories } from "@/features/map/hooks/useRestaurantDishCategories";
import { DishCategoryAutocomplete } from "@/components/DishCategoryAutocomplete";

export type DishCategoryStepProps = {
	restaurantId: string;
	/** 一覧から選んだとき。呼び出し側は id と名前の両方を確定できる */
	onSelectExisting: (category: { dishCategoryId: string; label: string }) => void;
	testID?: string;
};

export function DishCategoryStep({ restaurantId, onSelectExisting, testID }: DishCategoryStepProps) {
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { categories, isLoading } = useRestaurantDishCategories(restaurantId);
	const [query, setQuery] = useState("");

	const trimmed = query.trim();

	return (
		<View style={styles.container} testID={testID}>
			<View style={styles.headingRow}>
				<Utensils size={18} color={colors.textSecondary} />
				<Text style={styles.heading}>{i18n.t("Map.actions.selectDishCategory")}</Text>
			</View>

			{/*
			#1629【オーナー指示】**プロジェクト標準のオートコンプリートを使う。**
			デバウンス・ローディング・候補なしの文言・web のフォーカス問題の回避が入っている。
			自前で組み直すと、この画面だけ挙動が違う状態へ戻る。
			*/}
			<DishCategoryAutocomplete
				value={query}
				onChangeText={setQuery}
				onSelectSuggestion={(suggestion) =>
					onSelectExisting({ dishCategoryId: suggestion.dishCategoryId, label: suggestion.label })
				}
				onClear={() => setQuery("")}
				placeholder={i18n.t("Map.placeholders.searchDishCategory")}
				testID={testID ? `${testID}-search` : undefined}
			/>

			{/*
			打っていないあいだだけ «この店の料理» を出す。打ち始めたら上のオートコンプリートが
			マスタ全体から探すので、ここに古い候補が残っていると «どちらを見ればよいか» が分からない。
			*/}
			{!trimmed && categories.length > 0 && (
				<>
					<Text style={styles.listHeading}>{i18n.t("Map.labels.dishesAtThisRestaurant")}</Text>
					{/* 縦に全部出す。件数の多い順は hook が並べている */}
					<ScrollView style={styles.list} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
						{categories.map((category, index) => (
							<TouchableOpacity
								key={category.dishCategoryId}
								/*
								⚠️ testID は **並び順**にする。カテゴリ id を入れると Detox から «先頭の候補» を
								   指せない（`by.id` に前方一致が無い）。e2e-web は前方一致で拾っている
								*/
								testID={testID ? `${testID}-item-${index}` : undefined}
								style={styles.listItem}
								onPress={() => onSelectExisting({ dishCategoryId: category.dishCategoryId, label: category.label })}
								accessibilityRole="button"
								accessibilityLabel={category.label}>
								<Text style={styles.listItemLabel} numberOfLines={1} ellipsizeMode="tail">
									{category.label}
								</Text>
								<Text style={styles.listItemCount}>{category.count}</Text>
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
