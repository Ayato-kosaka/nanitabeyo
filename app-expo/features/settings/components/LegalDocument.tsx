import React, { useMemo } from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import Markdown from "react-native-markdown-display";
import i18n from "@/lib/i18n";
import { legalDocuments } from "@/features/settings/assets/legal/legalDocuments";
import { useLocale } from "@/hooks/useLocale";
import type { LegalDocumentType } from "@/lib/legalRoute";
import { type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";

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
}

/**
 * 法務文書の本文。
 *
 * #1386 【設計】`layout`（`"modal"` | `"screen"`）prop を廃止し、**ルートに載る形だけ**にした。
 *
 * #1368 でこの prop を入れたのは、当時 `features/map/components/ReviewForm.tsx` が
 * まだ BlurModal でこれを描いていたからである。BlurModal は中身に高さを与えないので、
 * モーダル用の分岐は `frame.height` を自分で敷き、見出しも自分で描いていた。
 * #1386 で ReviewForm の法務導線が `/[locale]/legal/[doc]` への push へ変わり、
 * **このコンポーネントの呼び出し元はそのルート 1 箇所だけ**になったため、分岐そのものを畳んだ。
 *
 * ⚠️ ここに `height: frame.height` を戻さないこと。ルートは上に `ScreenHeader` を敷くため、
 * 画面高をそのまま敷くと **ヘッダーの分だけ下へはみ出し、本文の末尾が永久に見えなくなる**。
 * 高さは親の flex に従わせる。見出しも描かないこと（タイトルは `ScreenHeader` が持つ。
 * 両方が描くと同じ文字列が 2 行並ぶ）。この 2 つは
 * `__tests__/legalEntryPoints.test.tsx` の «ルートに載る形» の describe が固定している。
 */
export function LegalDocument({ documentType }: LegalDocumentProps) {
	const { locale } = useLocale();
	const markdownStyles = useThemedStyles(createMarkdownStyles);

	const markdownContent = useMemo(() => {
		const localeData = locale in legalDocuments ? legalDocuments[locale as LegalLocale] : legalDocuments["en-US"];
		return localeData[documentType as DocumentType] || legalDocuments["en-US"][documentType as DocumentType] || "";
	}, [documentType, locale]);

	return (
		<View style={styles.screenContainer} testID="legal-document-body">
			<ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
				<View style={styles.contentContainer}>
					<Markdown style={markdownStyles}>{markdownContent}</Markdown>
				</View>
			</ScrollView>
		</View>
	);
}

const styles = StyleSheet.create({
	// #1368 / #1386 高さは «必ず» 親に委ねる（コンポーネントの JSDoc 参照）
	screenContainer: {
		flex: 1,
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

/**
 * #1509 【設計】本文（Markdown）の配色。
 *
 * この画面は **WebView を持たない**（`react-native-markdown-display` が React Native の
 * `<Text>` / `<View>` へ組み上げる）ので、注入する CSS は存在しない。色はここだけが持つ。
 *
 * `StyleSheet.create` を使っていないのは元からで、`Markdown` の `style` prop が
 * 素のオブジェクトを取るため。テーマ追従のために、パレットを受け取るファクトリにして
 * `useThemedStyles` から呼ぶ（`contexts/ThemeProvider.tsx`）。
 */
const createMarkdownStyles = (c: Palette) => ({
	body: {
		fontSize: 16,
		lineHeight: 26,
		color: c.textPrimaryAlt,
	},
	heading1: {
		fontSize: 24,
		fontWeight: "700",
		color: c.textPrimaryAlt,
		marginTop: 24,
		marginBottom: 12,
	},
	heading2: {
		fontSize: 18,
		fontWeight: "600",
		color: c.textPrimaryAlt,
		marginTop: 32,
		marginBottom: 12,
	},
	heading3: {
		fontSize: 18,
		fontWeight: "600",
		color: c.textPrimaryAlt,
		marginTop: 16,
		marginBottom: 8,
	},
	paragraph: {
		marginBottom: 16,
	},
	link: {
		color: c.linkAlt,
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
		backgroundColor: c.surfaceSubtle,
		padding: 12,
		borderRadius: 8,
		marginBottom: 12,
	},
	blockquote: {
		backgroundColor: c.surfaceFaint,
		borderLeftWidth: 3,
		borderLeftColor: c.borderNeutral,
		paddingLeft: 12,
		paddingVertical: 8,
		marginVertical: 12,
	},
});
