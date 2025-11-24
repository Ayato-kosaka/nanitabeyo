import React, { useMemo } from "react";
import { View, Text, ScrollView, StyleSheet, SafeAreaView } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams } from "expo-router";
import Markdown from "react-native-markdown-display";
import i18n from "@/lib/i18n";
import { legalDocuments } from "@/features/settings/assets/legal/legalDocuments";
import { useLocale } from "@/hooks/useLocale";

type LegalLocale = "ja-JP" | "en-US";
type DocumentType = "guidelines" | "terms" | "privacy" | "copyright";

export default function LegalDocumentScreen() {
	const { documentType } = useLocalSearchParams<{ documentType: DocumentType }>();
	const locale = useLocale();

	// 【設計】タイトルを i18n から取得
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

	// 【設計】Markdown コンテンツを取得
	const markdownContent = useMemo(() => {
		return locale in legalDocuments && documentType in legalDocuments[locale as LegalLocale]
			? legalDocuments[locale as LegalLocale][documentType as DocumentType]
			: legalDocuments["en-US"][documentType as DocumentType];
	}, [documentType, locale]);

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			<SafeAreaView style={styles.safeArea}>
				<View style={styles.header}>
					<Text style={styles.title}>{title}</Text>
				</View>

				<ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
					<View style={styles.contentContainer}>
						<Markdown style={markdownStyles}>{markdownContent}</Markdown>
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
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingHorizontal: 16,
		paddingVertical: 12,
	},
	backButton: {
		padding: 4,
	},
	title: {
		fontSize: 20,
		fontWeight: "700",
		color: "#1A1A1A",
		letterSpacing: -0.5,
		flex: 1,
		textAlign: "center",
	},
	placeholder: {
		width: 32,
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
});

// #設定画面 【設計】Markdown のスタイル設定
const markdownStyles = {
	body: {
		fontSize: 16,
		lineHeight: 26,
		color: "#111827",
	},
	heading1: {
		fontSize: 24,
		fontWeight: "700",
		color: "#111827",
		marginTop: 24,
		marginBottom: 12,
	},
	heading2: {
		fontSize: 18,
		fontWeight: "600",
		color: "#111827",
		marginTop: 32,
		marginBottom: 12,
	},
	heading3: {
		fontSize: 18,
		fontWeight: "600",
		color: "#111827",
		marginTop: 16,
		marginBottom: 8,
	},
	paragraph: {
		marginBottom: 16,
	},
	link: {
		color: "#2563EB",
	},
	bullet_list: {
		marginTop: 4,
		marginBottom: 16,
		paddingLeft: 20,
	},
	ordered_list: {
		marginTop: 4,
		marginBottom: 16,
		paddingLeft: 20,
	},
	list_item: {
		marginBottom: 6,
	},
	code_block: {
		backgroundColor: "#F3F4F6",
		padding: 12,
		borderRadius: 8,
		marginBottom: 12,
	},
	blockquote: {
		backgroundColor: "#F9FAFB",
		borderLeftWidth: 3,
		borderLeftColor: "#D1D5DB",
		paddingLeft: 12,
		paddingVertical: 8,
		marginVertical: 12,
	},
};
