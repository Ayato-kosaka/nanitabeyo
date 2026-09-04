// app-expo/components/DishRating.tsx
//
// #1667 【設計】**レビュー 0 件のときは、評価まわりを何も描かない。**
//
// オーナー確定（2026-09-03）:
//
// > 未評価の場合は何も出さないのが標準かと。
//
// ## なぜコンポーネントにするのか
//
// この規則は最初 `SelectedRestaurantDetails.tsx`（店の評価）にだけ入り、**料理の評価を
// 出す 2 画面が取り残された**。API は `reviewCount: dishStats?.reviewCount ?? 0` と
// 既定値で埋めるので 0 は実際に返り、その行は **★ 空 5 つ + (0)** で描かれて
// «最低評価の料理» と見分けが付かなくなる。
//
// dev の実測（`scripts/db-checks/measure_unrated_dishes.py`）:
//
//     dishes      未評価 1,255 / 2,731 （45.95%）
//     dish_media  未評価 1,443 / 4,922 （29.32%）
//
// **3 割の行がそう描かれていた。** 同じ条件分岐を画面ごとに書き足していくと、
// 4 つ目の画面でまた取り残される。判定をここ 1 箇所に閉じる。
//
// ⚠️ **「未評価」というラベルも出さない。** 無いものを言葉で埋めない、が標準である。

import React from "react";
import { View, Text, StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import Stars from "./Stars";

export type DishRatingProps = {
	/** 平均評価。`reviewCount` が 0 のときは参照されない */
	averageRating: number;
	/** 見えるレビューの件数。**0 なら何も描かない** */
	reviewCount: number;
	containerStyle?: StyleProp<ViewStyle>;
	countStyle?: StyleProp<TextStyle>;
	testID?: string;
};

export function DishRating({ averageRating, reviewCount, containerStyle, countStyle, testID }: DishRatingProps) {
	// ⚠️ ここが «この規則の唯一の置き場» である。呼び出し側で再度 if を書かないこと
	if (reviewCount <= 0) return null;

	return (
		<View style={[styles.container, containerStyle]} testID={testID}>
			<Stars rating={averageRating} />
			<Text style={countStyle} testID={testID ? `${testID}-count` : undefined}>
				({reviewCount})
			</Text>
		</View>
	);
}

const styles = StyleSheet.create({
	container: { flexDirection: "row", alignItems: "center" },
});
