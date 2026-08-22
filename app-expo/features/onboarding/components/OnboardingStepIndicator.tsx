/*
このファイルの責務
- オンボーディング画面上部の «丸数字 1 / 2 / 3»（#1486 §1）を描く。

旧チュートリアルのインジケータは「点」だったが、新オンボーディングは
「3 ステップのうち今どこか」を数字で明示する。全体像が見えるほうが、
途中でスキップされにくくなる（チケットで確定した仕様）。
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

export function OnboardingStepIndicator({
	currentIndex,
	total,
	accessibilityLabel,
	testID,
}: OnboardingStepIndicatorProps) {
	return (
		<View
			style={styles.container}
			accessibilityRole="progressbar"
			accessibilityLabel={accessibilityLabel}
			testID={testID}>
			{Array.from({ length: total }, (_, index) => {
				const isActive = index === currentIndex;
				return (
					<View
						key={index}
						style={[styles.circle, isActive && styles.activeCircle]}
						// 個々の丸は読み上げない（上の progressbar が 1 文で説明している）
						accessibilityElementsHidden
						importantForAccessibility="no-hide-descendants">
						<Text style={[styles.number, isActive && styles.activeNumber]}>{index + 1}</Text>
					</View>
				);
			})}
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flexDirection: "row",
		justifyContent: "center",
		alignItems: "center",
		gap: 12,
	},
	circle: {
		width: 28,
		height: 28,
		borderRadius: 14,
		alignItems: "center",
		justifyContent: "center",
		// 写真の上に載るため、非アクティブでも輪郭が消えないよう半透明の下地を敷く
		backgroundColor: "rgba(0, 0, 0, 0.35)",
		borderWidth: 1,
		borderColor: "rgba(255, 255, 255, 0.7)",
	},
	activeCircle: {
		backgroundColor: "#F05537",
		borderColor: "#F05537",
	},
	number: {
		fontSize: 13,
		fontWeight: "700",
		color: "#FFFFFF",
	},
	activeNumber: {
		color: "#FFFFFF",
	},
});
