import React, { useMemo } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import Markdown from "react-native-markdown-display";
import i18n from "@/lib/i18n";
import { legalDocuments } from "@/features/settings/assets/legal/legalDocuments";
import { useLocale } from "@/hooks/useLocale";
import { useSafeAreaFrame } from "react-native-safe-area-context";
import type { LegalDocumentType } from "@/lib/legalRoute";

type LegalLocale = "ja-JP" | "en-US";
// #1368 許可値は `lib/legalRoute.ts` の 1 箇所が持つ（URL・sitemap・prerender と同じ情報源）。
// ここで独自に列挙し直すと、`/legal/[doc]` で開ける文書とこのコンポーネントが描ける文書がずれる
type DocumentType = LegalDocumentType;

/**
 * #1368 【設計】法務文書のタイトル。
 *
 * ルート（`app/[locale]/legal/[doc].tsx`）は `ScreenHeader` に同じ文字列を出すため、
 * switch をルート側へ複製せずここから引く。i18n はロケール切り替え時に
 * `i18n.locale` が差し替わるだけなので、呼び出しごとに評価してよい。
 */
export function getLegalDocumentTitle(documentType: DocumentType): string {
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
			return i18n.t("Settings.legalDocument");
	}
}

interface LegalDocumentProps {
	documentType: DocumentType;
	/**
	 * #1368 どの «器» に載っているか。既定は従来どおり BlurModal。
	 *
	 * - `"modal"`: 画面いっぱいの高さを自分で確保し、見出しも自分で描く（BlurModal は
	 *   高さを与えないので、`frame.height` を自分で敷かないと中身が潰れる）
	 * - `"screen"`: 高さは親（ルート）の flex に従い、見出しは `ScreenHeader` が持つ。
	 *   ここで `frame.height` を敷くと **ヘッダーの分だけ画面外へはみ出し、
	 *   本文の末尾がスクロールしても永久に見えなくなる**
	 *
	 * ⚠️ 既定値を `"screen"` に変えないこと。ReviewForm（`features/map/components/ReviewForm.tsx`）は
	 * まだ BlurModal でこれを描いている（#1368 では移行を見送った。理由は `[doc].tsx` のコメント）。
	 */
	layout?: "modal" | "screen";
}

export function LegalDocument({ documentType, layout = "modal" }: LegalDocumentProps) {
	const { locale } = useLocale();

	const title = useMemo(() => getLegalDocumentTitle(documentType), [documentType]);

	const markdownContent = useMemo(() => {
		const localeData = locale in legalDocuments ? legalDocuments[locale as LegalLocale] : legalDocuments["en-US"];
		return localeData[documentType as DocumentType] || legalDocuments["en-US"][documentType as DocumentType] || "";
	}, [documentType, locale]);

	const frame = useSafeAreaFrame();
	return (
		<View style={layout === "screen" ? styles.screenContainer : { height: frame.height }}>
			{layout === "modal" && (
				<View style={styles.header}>
					<Text style={styles.title}>{title}</Text>
				</View>
			)}

			<ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
				<View style={styles.contentContainer}>
					<Markdown style={markdownStyles}>{markdownContent}</Markdown>
				</View>
			</ScrollView>
		</View>
	);
}

const styles = StyleSheet.create({
	// #1368 ルートに載せるときは高さを親に委ねる（`layout` prop のコメント参照）
	screenContainer: {
		flex: 1,
	},
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
