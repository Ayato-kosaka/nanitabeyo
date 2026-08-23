import React, { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
	MY_DISH_STATUS_COLORS,
	MY_DISH_STATUS_ON_COLOR,
	type MyDishStatusCounts,
} from "@/features/myDishes/statusColors";
import { FixedColors } from "@/constants/Palette";

/**
 * #1375 実機確認（5 巡目）: 「食べたい（緑）/ 食べた（赤）が何件か」を、
 * カレンダーの日と地図の帯タイルの **右下** に同じ形で出す。
 *
 * ## 1 件のときは数字を出さない
 *
 * 最初は常に数字を出したが、自分で撮って見たところ **記録がある日すべてに «1» が付き**、
 * 月グリッドが小さな数字で埋まって読みにくかった（`shots/calendar.png`）。
 * 1 件なら «その色の点があること» 自体が情報（= どちらの状態か）なので、数字は要らない。
 * 2 件以上のときだけ数字を出す。
 *
 * ## 0 件の側は描かない
 *
 * «食べたい 0 / 食べた 3» の店に «0» を出しても読む手間が増えるだけである。
 *
 * ## 白い縁を必ず付ける
 *
 * バッジは **写真の上**に載る。赤い料理の写真に赤いバッジを重ねると輪郭が溶けて
 * 数が読めなくなる（撮って確かめたとき実際にそうなった）。
 * 選択済みバッジ（`FixedColors.badgeBorder`）と同じ考え方で白い縁を回す。
 */
export const MyDishStatusCountBadges = memo(function MyDishStatusCountBadges({
	counts,
	size = "sm",
	testIDPrefix,
}: {
	counts: MyDishStatusCounts;
	/** sm: カレンダーの日セル / md: 地図の帯タイル（画像の上に載るので一回り大きく） */
	size?: "sm" | "md";
	testIDPrefix: string;
}) {
	if (counts.want === 0 && counts.eaten === 0) return null;
	const metrics = size === "md" ? styles.badgeMd : styles.badgeSm;
	const textStyle = size === "md" ? styles.textMd : styles.textSm;
	return (
		<View style={styles.row} pointerEvents="none">
			{(["want", "eaten"] as const).map((status) =>
				counts[status] > 0 ? (
					<View
						key={status}
						testID={`${testIDPrefix}-${status}`}
						style={[metrics, { backgroundColor: MY_DISH_STATUS_COLORS[status] }]}>
						{counts[status] > 1 ? <Text style={textStyle}>{counts[status]}</Text> : null}
					</View>
				) : null,
			)}
		</View>
	);
});

const styles = StyleSheet.create({
	row: {
		flexDirection: "row",
		gap: 3,
		alignItems: "center",
	},
	// 数字が無いときは «丸» に、あるときは数字を包む横長の錠剤になる（minWidth = 高さ）
	badgeSm: {
		minWidth: 14,
		height: 14,
		paddingHorizontal: 3,
		borderRadius: 7,
		borderWidth: 1.5,
		borderColor: FixedColors.badgeBorder,
		alignItems: "center",
		justifyContent: "center",
	},
	badgeMd: {
		minWidth: 17,
		height: 17,
		paddingHorizontal: 4,
		borderRadius: 8.5,
		borderWidth: 1.5,
		borderColor: FixedColors.badgeBorder,
		alignItems: "center",
		justifyContent: "center",
	},
	textSm: {
		fontSize: 9,
		fontWeight: "700",
		color: MY_DISH_STATUS_ON_COLOR,
	},
	textMd: {
		fontSize: 10,
		fontWeight: "700",
		color: MY_DISH_STATUS_ON_COLOR,
	},
});
