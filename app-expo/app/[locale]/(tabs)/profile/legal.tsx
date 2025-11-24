import React, { useMemo } from "react";
import { View, Text, ScrollView, StyleSheet, SafeAreaView } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams } from "expo-router";
import i18n from "@/lib/i18n";

// #設定画面 【設計】Legal ドキュメントを locale に応じて読み込む
const legalDocuments = {
	"ja-JP": {
		guidelines: require("@/features/settings/assets/legal/ja-JP/guidelines.md"),
		terms: require("@/features/settings/assets/legal/ja-JP/terms.md"),
		privacy: require("@/features/settings/assets/legal/ja-JP/privacy.md"),
		copyright: require("@/features/settings/assets/legal/ja-JP/copyright.md"),
	},
	"en-US": {
		guidelines: require("@/features/settings/assets/legal/en-US/guidelines.md"),
		terms: require("@/features/settings/assets/legal/en-US/terms.md"),
		privacy: require("@/features/settings/assets/legal/en-US/privacy.md"),
		copyright: require("@/features/settings/assets/legal/en-US/copyright.md"),
	},
};

type LegalLocale = "ja-JP" | "en-US";
type DocumentType = "guidelines" | "terms" | "privacy" | "copyright";

export default function LegalDocumentScreen() {
	const params = useLocalSearchParams<{ type: DocumentType; locale: LegalLocale }>();
	const documentType = params.type || "terms";
	const legalLocale = (params.locale || "en-US") as LegalLocale;

	// #設定画面 【設計】タイトルを i18n から取得
	const title = useMemo(() => {
		switch (documentType) {
			case "guidelines":
				return i18n.t("Settings.communityGuidelines");
			case "terms":
				return i18n.t("Settings.terms");
			case "privacy":
				return i18n.t("Settings.privacy");
			case "copyright":
				return i18n.t("Settings.copyright");
			default:
				return "Legal Document";
		}
	}, [documentType]);

	// #設定画面 【設計】Markdown コンテンツを取得（実際の内容は fetch で読み込む必要があるが、暫定的に require を使用）
	// TODO: 本来は fetch または react-native-fs で .md ファイルを読み込む必要があるが、
	//       Metro bundler の require は asset として扱われるため、uri が返される可能性がある
	//       暫定的には、markdown を静的に表示するためのシンプルな実装とする
	const documentContent = useMemo(() => {
		// Markdown レンダリングライブラリがない場合は、暫定的にプレーンテキストとして表示
		// 実際には react-native-markdown-display などを使用する
		return `Legal document content for ${documentType} in ${legalLocale} locale.\n\nThis is a placeholder. Please implement proper Markdown rendering.`;
	}, [documentType, legalLocale]);

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			<SafeAreaView style={styles.safeArea}>
				<View style={styles.header}>
					<Text style={styles.title}>{title}</Text>
				</View>
				<ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
					<View style={styles.contentContainer}>
						<Text style={styles.content}>{documentContent}</Text>
					</View>
				</ScrollView>
			</SafeAreaView>
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	safeArea: {
		flex: 1,
	},
	header: {
		paddingHorizontal: 16,
		paddingVertical: 16,
		borderBottomWidth: 1,
		borderBottomColor: "#F3F4F6",
	},
	title: {
		fontSize: 24,
		fontWeight: "700",
		color: "#1A1A1A",
		letterSpacing: -0.5,
	},
	scrollView: {
		flex: 1,
	},
	scrollContent: {
		paddingTop: 16,
		paddingBottom: 32,
	},
	contentContainer: {
		paddingHorizontal: 20,
	},
	content: {
		fontSize: 15,
		lineHeight: 24,
		color: "#374151",
	},
});
