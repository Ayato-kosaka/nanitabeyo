import React from "react";
import { Text, StyleSheet } from "react-native";

interface FormErrorTextProps {
	/** 表示するエラーメッセージ。falsy なら何も描画しない */
	message?: string | null;
	testID?: string;
}

/**
 * #930 【仕様】必須項目が未入力であることを示すインラインエラー。
 * ボタン押下を待たず、状態に応じて表示・非表示を切り替える(disabled ボタンは
 * 押下自体ができないため、押下をトリガーにしたエラー表示は成立しない)。
 * accessibilityLiveRegion="polite" で、表示された瞬間にスクリーンリーダーへ通知する。
 */
export function FormErrorText({ message, testID }: FormErrorTextProps) {
	if (!message) return null;

	return (
		<Text style={styles.text} accessibilityRole="alert" accessibilityLiveRegion="polite" testID={testID}>
			{message}
		</Text>
	);
}

const styles = StyleSheet.create({
	text: {
		marginTop: 6,
		fontSize: 13,
		color: "#DC2626",
		fontWeight: "600",
	},
});
