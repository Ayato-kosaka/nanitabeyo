import React, { useState, useEffect, useMemo } from "react";
import { View, Text, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams } from "expo-router";
import Markdown from "react-native-markdown-display";
import i18n from "@/lib/i18n";
import { legalDocuments } from "@/features/settings/data/legalDocuments";

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

	// #設定画面 【設計】Markdown コンテンツを取得
	const markdownContent = useMemo(() => {
		return legalDocuments[legalLocale]?.[documentType] || "";
	}, [documentType, legalLocale]);

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
	loadingContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
	},
	errorContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		paddingHorizontal: 20,
	},
	errorText: {
		fontSize: 16,
		color: "#DC2626",
		textAlign: "center",
	},
});

// #設定画面 【設計】Markdown のスタイル設定
const markdownStyles = {
	body: {
		fontSize: 15,
		lineHeight: 24,
		color: "#374151",
	},
	heading1: {
		fontSize: 24,
		fontWeight: "700",
		color: "#1A1A1A",
		marginTop: 24,
		marginBottom: 12,
	},
	heading2: {
		fontSize: 20,
		fontWeight: "700",
		color: "#1A1A1A",
		marginTop: 20,
		marginBottom: 10,
	},
	heading3: {
		fontSize: 18,
		fontWeight: "600",
		color: "#1A1A1A",
		marginTop: 16,
		marginBottom: 8,
	},
	paragraph: {
		marginBottom: 12,
	},
	link: {
		color: "#5EA2FF",
	},
	bullet_list: {
		marginBottom: 12,
	},
	ordered_list: {
		marginBottom: 12,
	},
	list_item: {
		marginBottom: 4,
	},
	code_inline: {
		backgroundColor: "#F3F4F6",
		paddingHorizontal: 4,
		paddingVertical: 2,
		borderRadius: 4,
		fontFamily: "monospace",
	},
	code_block: {
		backgroundColor: "#F3F4F6",
		padding: 12,
		borderRadius: 8,
		marginBottom: 12,
	},
	blockquote: {
		backgroundColor: "#F8F9FA",
		borderLeftWidth: 4,
		borderLeftColor: "#5EA2FF",
		paddingLeft: 12,
		paddingVertical: 8,
		marginBottom: 12,
	},
};
