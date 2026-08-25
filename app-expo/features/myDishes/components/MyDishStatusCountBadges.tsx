import React, { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { MY_DISH_STATUS_COLORS, type MyDishStatusCounts } from "@/features/myDishes/statusColors";

/**
 * #1375 実機確認（5 巡目）: 「食べたい / 食べたが何件か」を、
 * カレンダーの日と地図の帯タイルの **右下** に同じ形で出す。
 *
 * ## 1 件でも «1» と書く（6 巡目・オーナー指示）
 *
 * 5 巡目では «1 件なら点だけ» にしていた。月グリッドが «1» で埋まって読みにくいと
 * 判断したためだが、実機で見たオーナーの判断は逆で、**1 件のときも数字を出す**。
 * 点だけだと «1 件なのか、色の印なのか» が読み取れないためである。
 * 数を出す/出さないを件数で切り替えないので、見た目の規則も 1 つで済む。
 *
 * ## 0 件の側は描かない
 *
 * «食べたい 0 / 食べた 3» の店に «0» を出しても読む手間が増えるだけである。
 *
 * ## 縁を必ず付ける
 *
 * バッジは **写真の上**に載る。赤い料理の写真に赤いバッジを重ねると輪郭が溶けて
 * 数が読めなくなる（撮って確かめたとき実際にそうなった）。
 * 縁の色は状態ごとに違う（赤塗りには白縁、白塗りには赤縁）ので `statusColors` から 1 組で取る。
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
						style={[
							metrics,
							{
								backgroundColor: MY_DISH_STATUS_COLORS[status].fill,
								borderColor: MY_DISH_STATUS_COLORS[status].border,
							},
						]}>
						<Text style={[textStyle, { color: MY_DISH_STATUS_COLORS[status].on }]}>{counts[status]}</Text>
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
	// 1 桁なら丸、2 桁以上は数字を包む横長の錠剤になる（minWidth = 高さ）
	badgeSm: {
		minWidth: 14,
		height: 14,
		paddingHorizontal: 3,
		borderRadius: 7,
		borderWidth: 1.5,
		alignItems: "center",
		justifyContent: "center",
	},
	badgeMd: {
		minWidth: 17,
		height: 17,
		paddingHorizontal: 4,
		borderRadius: 8.5,
		borderWidth: 1.5,
		alignItems: "center",
		justifyContent: "center",
	},
	// 色は状態ごとに `statusColors` から重ねる（白塗りには赤文字、赤塗りには白文字）
	textSm: {
		fontSize: 9,
		fontWeight: "700",
	},
	textMd: {
		fontSize: 10,
		fontWeight: "700",
	},
});
