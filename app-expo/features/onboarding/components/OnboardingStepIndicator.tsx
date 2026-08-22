/*
このファイルの責務
- オンボーディング画面上部の «丸数字バッジ»（#1486 §1）を描く。

当初は 1 / 2 / 3 の 3 つを横に並べていたが、デザインレビューで
**現在のステップ番号 1 つだけ** を出す形に確定した（参考にしたテンプレートカードの見せ方。
3 つ並べると次の課題文と幅がぶつかり、視線も分散する）。
「3 ステップ中の何番目か」はスクリーンリーダー向けの accessibilityLabel が引き続き伝える。
*/
import React from "react";
import { StyleSheet, Text, View } from "react-native";

export type OnboardingStepIndicatorProps = {
	/** 0 始まりの現在ステップ */
	currentIndex: number;
	total: number;
	/** スクリーンリーダー向けの説明（例: 「3 ステップ中 1 ステップ目」） */
	accessibilityLabel: string;
	testID?: string;
};

export function OnboardingStepIndicator({ currentIndex, accessibilityLabel, testID }: OnboardingStepIndicatorProps) {
	return (
		<View style={styles.badge} accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel} testID={testID}>
			<Text style={styles.number}>{currentIndex + 1}</Text>
		</View>
	);
}

const styles = StyleSheet.create({
	badge: {
		alignSelf: "center",
		// 最終検収で «もう少し小さく» の指摘。44 → 34
		width: 34,
		height: 34,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#F05537",
		// 正円ではなく squircle 気味の角丸にして «バッジ» らしさを出す（参考デザインの形）
		borderRadius: 12,
		// 45° 回転させたひし形シルエット。中の数字は逆回転で水平に戻す
		transform: [{ rotate: "45deg" }],
	},
	number: {
		fontSize: 16,
		fontWeight: "700",
		color: "#FFFFFF",
		transform: [{ rotate: "-45deg" }],
	},
});
