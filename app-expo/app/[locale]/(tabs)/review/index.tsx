import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import i18n from "@/lib/i18n";

// #644 【設計】レビュー投稿のスタート画面（現状はプレースホルダー）
export default function ReviewIndexScreen() {
	return (
		<SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
			<View style={styles.content}>
				<Text style={styles.title}>{i18n.t("Review.startReview")}</Text>
			</View>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#FFFFFF",
	},
	content: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		paddingHorizontal: 24,
	},
	title: {
		fontSize: 24,
		fontWeight: "700",
		color: "#1A1A1A",
		textAlign: "center",
	},
});
