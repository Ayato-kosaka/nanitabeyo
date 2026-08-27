import React, { memo } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";
import i18n from "@/lib/i18n";
import { MY_DISH_STATUS_COLORS } from "@/features/myDishes/statusColors";

/**
 * #1375 実機確認（5 巡目）: 緑 / 赤の丸だけでは «どちらが食べたいか» が分からない、という指摘への対処。
 *
 * カレンダーの最下部と地図のシート見出しに同じ形で置く。文言は絞り込みの状態チップと
 * **同じキー**（`MyDishes.filters.status.*`）を読む — 同じものを 2 通りの言葉で呼ばないため。
 *
 * 装飾なので支援技術からは隠す（`accessibilityElementsHidden`）。個々のバッジ側が
 * 読み上げ用のラベルを持っているので、ここを読ませると同じ情報が二重になる。
 */
export const MyDishStatusLegend = memo(function MyDishStatusLegend({
	style,
	testID = "my-dish-status-legend",
}: {
	style?: StyleProp<ViewStyle>;
	testID?: string;
}) {
	const styles = useThemedStyles(createStyles);

	return (
		<View
			style={[styles.row, style]}
			testID={testID}
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants">
			{(["want", "eaten"] as const).map((status) => (
				<View key={status} style={styles.item}>
					<View
						style={[
							styles.dot,
							{
								backgroundColor: MY_DISH_STATUS_COLORS[status].fill,
								borderColor: MY_DISH_STATUS_COLORS[status].border,
							},
						]}
					/>
					<Text style={styles.label}>{i18n.t(`MyDishes.filters.status.${status}`)}</Text>
				</View>
			))}
		</View>
	);
});

const createStyles = (c: Palette) =>
	StyleSheet.create({
		row: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			gap: 14,
		},
		item: {
			flexDirection: "row",
			alignItems: "center",
			gap: 5,
		},
		// 塗りの有無で区別するので、凡例の丸にも必ず枠を描く
		// （白塗りの側は枠が無いと «何も無い» に見える）
		dot: {
			width: 10,
			height: 10,
			borderRadius: 5,
			borderWidth: 1.5,
		},
		label: {
			fontSize: 11,
			fontWeight: "600",
			// 説明文の淡い灰（docs/design-guidelines.md §2）
			color: c.textSecondary,
		},
	});
