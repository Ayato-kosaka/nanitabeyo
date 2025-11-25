import React, { useMemo } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import Markdown from "react-native-markdown-display";
import i18n from "@/lib/i18n";
import { legalDocuments } from "@/features/settings/assets/legal/legalDocuments";
import { useLocale } from "@/hooks/useLocale";
import { useSafeAreaFrame } from "react-native-safe-area-context";

type LegalLocale = "ja-JP" | "en-US";
type DocumentType = "guidelines" | "terms" | "privacy" | "copyright";

interface LegalDocumentProps {
	documentType: DocumentType;
}

export function LegalDocument({ documentType }: LegalDocumentProps) {
	const locale = useLocale();

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

	const markdownContent = useMemo(() => {
		const localeData = locale in legalDocuments ? legalDocuments[locale as LegalLocale] : legalDocuments["en-US"];
		return localeData[documentType as DocumentType] || legalDocuments["en-US"][documentType as DocumentType] || "";
	}, [documentType, locale]);

	const frame = useSafeAreaFrame();
	return (
		<View style={{ height: frame.height }}>
			<View style={styles.header}>
				<Text style={styles.title}>{title}</Text>
			</View>

			<ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
				<View style={styles.contentContainer}>
					<Markdown style={markdownStyles}>{markdownContent}</Markdown>
				</View>
			</ScrollView>
		</View>
	);
}

const styles = StyleSheet.create({
	header: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: 16,
		paddingVertical: 12,
		borderBottomWidth: 1,
		borderBottomColor: "#F3F4F6",
	},
	title: {
		fontSize: 20,
		fontWeight: "700",
		color: "#1A1A1A",
		letterSpacing: -0.5,
		textAlign: "center",
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
