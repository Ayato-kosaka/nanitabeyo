/*
このファイルの責務
- 法務ドキュメント（ガイドライン / 利用規約 / プライバシーポリシー / 著作権）を «画面» として提供する。
- `[doc]` セグメントを検証し、公開中の文書でなければ not-found 表示へ倒す。
- 戻る導線（ScreenHeader / ハードウェアバック）で呼び出し元へ帰す。

#1368 【設計】規約・プライバシーポリシーは **URL で指せるべき対象**である。
共有・ブックマーク・外部（App Store / Play Console / 問い合わせメール）からのリンクが成立し、
検索結果にも出せる。モーダルである必然性が無く、実際に 3 箇所で同じ BlurModal が複製されていた。

`app/[locale]/(tabs)/profile/feedback.tsx`（#951）/ `app/[locale]/auth/login.tsx`（#1359）と
同じ構成にしてある。presentation を指定していない（＝既定の card）のも同じ理由で、
Android の戻る・ブラウザバック・URL 共有をすべて Navigator の既定挙動で賄うため。
`app/[locale]/_layout.tsx` への Stack.Screen 追加も不要（presentation を変えないため）。

⚠️ 呼び出し元が «portal の中» にいないことを必ず確認すること。
`Portal.Host` は `<Stack>` を包んでいる（app/[locale]/_layout.tsx）ので、BlurModal を
開いたままここへ push すると、この画面は portal の下に潜って見えず触れない（#1364 で実測）。
移行済みの 2 箇所（`features/auth/components/LoginForm.tsx` = /auth/login ルートの中身、
`app/[locale]/(tabs)/profile/index.tsx` = ルートそのもの。#1402 で独立した設定画面が
マイページ本体へ統合された）は、押した時点で開いている BlurModal を持たないため
«閉じてから push» は不要である。
#1386 で引き渡し先（地図・投稿群）も完了し、**呼び出し元は 3 箇所とも portal を持たない**。
`features/map/components/ReviewForm.tsx` は `ReviewBlurModal` / `ReviewFormModal` の中身ではなく
`/restaurant/[restaurantId]/review`（と `review-from-media`）ルートの中身になったので、
«閉じてから push» も要らず、法務文書を読んで戻っても入力中のレビューと mediaState が残る。

⚠️ E2E の注意: `ScreenHeader` は `legal-screen` コンテナの **外側**にある。
戻る導線を検証するときは `legal-screen-back`（#1404 で ScreenHeader は `${testID}-back` を付ける）か
URL（`toHaveURL(/\/legal\/terms/)`）を使うこと（login.tsx と同じ）。
*/
import React, { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";

import { ScreenHeader } from "@/components/ScreenHeader";
import { type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { getLegalDocumentTitle, LegalDocument } from "@/features/settings/components/LegalDocument";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import { LEGAL_DOCUMENT_TYPES, resolveLegalDocument } from "@/lib/legalRoute";

export default function LegalDocumentScreen() {
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();
	// `doc` は外部（URL / 共有リンク / ディープリンク）から来る値。表示してよい文書かは
	// lib/legalRoute.ts で検証する。ここでは生のまま受け取るだけにする
	const { doc } = useLocalSearchParams<{ doc?: string }>();
	const documentType = resolveLegalDocument(doc);

	const handleBack = useCallback(() => {
		lightImpact();

		logFrontendEvent({
			event_name: "legal_screen_back_pressed",
			error_level: "log",
			payload: { doc: documentType ?? "unknown", canGoBack: router.canGoBack() },
		});

		// #1368 【設計】履歴があれば back。法務ページは «読みに来て戻る» だけの画面で、
		// ログイン（#1359）のように「行き先」を持たないため `?next=` 相当の仕組みは要らない。
		// 履歴が無い着地（検索結果 / 共有リンク / ディープリンクからのコールドロード）だけが
		// 例外で、そこは戻る先が存在しないのでマイページへ倒す（この画面への主な導線）。
		// #1402 独立した設定画面は無くなり、リーガル 4 行はマイページ本体の縦リストにある。
		if (router.canGoBack()) {
			router.back();
			return;
		}
		router.replace({ pathname: "/[locale]/(tabs)/profile", params: { locale } });
	}, [lightImpact, logFrontendEvent, documentType, locale]);

	return (
		<LinearGradient colors={colors.backgroundGradient} style={styles.container}>
			<SafeAreaView style={styles.safeArea} edges={[]}>
				{/* #1368 / #1386 タイトルはこのヘッダーだけが持つ（LegalDocument 側は見出しを描かない）。
				    ⚠️ LegalDocument に高さを持たせないこと。ここがヘッダーを敷くので、本文が画面高を
				    自分で敷くと «ヘッダーの分だけ» はみ出して末尾が永久に見えなくなる。
				    #1386 でこれを prop（`layout="screen"`）から «唯一の実装» へ格上げした
				    ——「落としても全緑になる prop」を残さないため（PR #1372 のレビュー指摘 4）。
				    検証は `__tests__/legalEntryPoints.test.tsx` の «ルートに載る形» の describe */}
				<ScreenHeader
					title={documentType ? getLegalDocumentTitle(documentType) : i18n.t("NotFound.title")}
					onPressBack={handleBack}
					testID="legal-screen"
				/>
				{/* #1368 【設計】公開していない `doc` は «既定の文書へ倒さず» not-found を出す。
				    倒すと `/legal/<任意の文字列>` が全部 200 の複製ページになる（lib/legalRoute.ts のコメント）。
				    ⚠️ 戻る導線はこの分岐の外に置くこと。ここで詰まると Web は戻る手段を失う */}
				{documentType ? (
					<View style={styles.body} testID="legal-screen-document">
						<LegalDocument documentType={documentType} />
					</View>
				) : (
					<View style={styles.notFound} testID="legal-screen-not-found">
						<Text style={styles.notFoundText}>{i18n.t("NotFound.message")}</Text>
					</View>
				)}
			</SafeAreaView>
		</LinearGradient>
	);
}

/**
 * 🌍 #1368 文書ごとに実体の HTML を事前生成させる。
 *
 * これが無いと `expo export` は `[doc]` をリテラルのまま 1 枚だけ出力し、
 * `/ja-JP/legal/terms` は Firebase Hosting の catch-all `**` → `/index.html` に落ちて
 * **title も description も canonical も無い空の SPA シェル**になる（#721 で `[locale]` について
 * 実測済みの症状。`lib/seo/localeStaticParams.ts` 参照）。
 * sitemap に載せる URL でそれをやると、4 文書 × 8 ロケールすべてが空シェルとして
 * クローラへ提出されることになる。
 *
 * 親（`app/[locale]/_layout.tsx` の generateStaticParams）が locale を展開し、
 * ここが doc を展開する。掛け算は expo-router が行う。
 */
export function generateStaticParams(): { doc: string }[] {
	return LEGAL_DOCUMENT_TYPES.map((doc) => ({ doc }));
}

// #1509 【設計】テーマ依存のスタイルはファクトリで組む（contexts/ThemeProvider.tsx の useThemedStyles）
const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
		},
		safeArea: {
			flex: 1,
		},
		body: {
			flex: 1,
		},
		notFound: {
			flex: 1,
			alignItems: "center",
			justifyContent: "center",
			padding: 20,
		},
		notFoundText: {
			fontSize: 16,
			color: c.textSecondary,
			textAlign: "center",
		},
	});
