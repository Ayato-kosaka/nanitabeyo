/*
このファイルの責務
- 「なに食べよについて」画面。**アプリそのものについての情報と、運営への働きかけ**を集める。

#1583 【設計】なぜマイページから切り出したのか。

オーナー指摘（2026-08-25）:
> 設定画面の構成をゼロベースで見直して欲しい。例えば、
> ・なに食べよについて ・なに食べよ を応援する ・利用規約、、、 ・バージョン番号
> （追記）セクションタイトルをつけて欲しいんじゃなくて、ページ遷移をするように

マイページ本体には «自分のもの»（いいね・保存・ブロック済み・通報履歴）と
«アプリそのものの話»（規約・著作権・版数）が同居していた。前者は増え続けるが、
後者は増えないうえ普段は見ない。同じ縦リストに並べておく理由が無い。

⚠️ ここに «自分に紐づくもの» を置かないこと。この画面の約束は
   「誰が見ても同じ内容が出る」ことである。ユーザー固有の行を混ぜると、
   問い合わせのときに «この画面のスクショをください» が成立しなくなる。

⚠️ «応援する» はストアレビュー導線だけにすること（オーナー確定仕様 2026-08-25
   「ストアレビュー導線だけ」）。寄付・シェア・SNS フォローを足さない。

⚠️ ここに BlurModal を置かないこと（理由は profile/index.tsx 冒頭の Portal.Host の注意書きと同じ）。
*/
import React, { useCallback } from "react";
import { Platform, StyleSheet, ScrollView } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { Card } from "@/components/Card";
import { ScreenHeader } from "@/components/ScreenHeader";
import { VersionInfo } from "@/components/VersionInfo";
import type { Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { SettingsMenuItem } from "@/features/settings/components/SettingsMenuItem";
import { useStoreReview } from "@/features/settings/hooks/useStoreReview";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { useScreenTrace } from "@/hooks/useScreenTrace";
import i18n from "@/lib/i18n";
import type { LegalDocumentType } from "@/lib/legalRoute";

export default function AboutScreen() {
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();
	useScreenTrace("About");

	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();
	const { handleLeaveReview } = useStoreReview();

	// #949 【設計】Stack push 画面のため戻る導線は ScreenHeader が持つ。
	// 履歴が無い着地（web の直リンク / ディープリンクのコールドロード）だけは戻る先が
	// 無いので、この画面の唯一の導線であるマイページへ倒す（device-settings.tsx と同じ判断）。
	const handleBack = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "about_back_pressed",
			error_level: "log",
			payload: { canGoBack: router.canGoBack() },
		});
		if (router.canGoBack()) {
			router.back();
			return;
		}
		router.replace({ pathname: "/[locale]/(tabs)/profile", params: { locale } });
	}, [lightImpact, logFrontendEvent, locale]);

	const handleLegalDocument = useCallback(
		(documentType: LegalDocumentType) => {
			lightImpact();
			logFrontendEvent({
				event_name: "settings_legal_document_pressed",
				error_level: "log",
				payload: { documentType },
			});
			router.push({ pathname: "/[locale]/legal/[doc]", params: { locale, doc: documentType } });
		},
		[lightImpact, logFrontendEvent, locale],
	);

	const handleSendFeedback = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "settings_send_feedback_pressed",
			error_level: "log",
			payload: {},
		});
		router.push({ pathname: "/[locale]/(tabs)/profile/feedback", params: { locale } });
	}, [lightImpact, logFrontendEvent, locale]);

	return (
		<LinearGradient colors={colors.backgroundGradient} style={styles.container}>
			<SafeAreaView style={styles.safeArea} edges={[]}>
				<ScreenHeader title={i18n.t("Settings.about.title")} onPressBack={handleBack} testID="about-screen" />
				<ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} testID="about-scroll">
					{/*
					  #1629 【仕様】1 ブロック目は «なに食べよを応援する» → «ご意見・不具合» の順（オーナー指示）。
					  «ご意見・不具合» はマイページ本体から移設した。どちらも «作り手へ届ける» 行為であり、
					  «この アプリについて» の中に並んでいるのが自然、という判断。

					  #317 / #611 【設計】ストア導線だけは web では出さない（web にストアが無い）。
					  ⚠️ カードごと `Platform.OS !== "web"` で囲まないこと。囲うと web で
					     «ご意見・不具合» まで丸ごと消える。**行単位**で出し分ける。
					*/}
					<Card style={styles.card}>
						{Platform.OS !== "web" && (
							<SettingsMenuItem
								label={i18n.t("Settings.support")}
								onPress={handleLeaveReview}
								testID="settings-leave-review"
								accessibilityRole="button"
							/>
						)}
						{/* #951 【仕様】モーダル起動から画面遷移(router.push)に変わったため link（#950 の規約） */}
						<SettingsMenuItem
							label={i18n.t("Settings.sendFeedback")}
							onPress={handleSendFeedback}
							isLast
							testID="settings-feedback"
							accessibilityRole="link"
						/>
					</Card>

					<Card style={styles.card}>
						{/* #1368 【仕様】モーダル起動から画面遷移(router.push)に変わったため link に変更(#950 の規約) */}
						<SettingsMenuItem
							label={i18n.t("Settings.communityGuidelines")}
							onPress={() => handleLegalDocument("guidelines")}
							testID="settings-guidelines"
							accessibilityRole="link"
						/>
						<SettingsMenuItem
							label={i18n.t("Settings.terms")}
							onPress={() => handleLegalDocument("terms")}
							testID="settings-terms"
							accessibilityRole="link"
						/>
						<SettingsMenuItem
							label={i18n.t("Settings.privacy")}
							onPress={() => handleLegalDocument("privacy")}
							testID="settings-privacy"
							accessibilityRole="link"
						/>
						<SettingsMenuItem
							label={i18n.t("Settings.copyright")}
							onPress={() => handleLegalDocument("copyright")}
							isLast
							testID="settings-copyright"
							accessibilityRole="link"
						/>
					</Card>

					{/* #1495 / #1583 版数はこの画面の最後。問い合わせのとき «なに食べよについて» を
					    開けば規約もガイドラインも版数も 1 画面で揃う */}
					<VersionInfo />
				</ScrollView>
			</SafeAreaView>
		</LinearGradient>
	);
}

const createStyles = (_colors: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
		},
		safeArea: {
			flex: 1,
		},
		scrollView: {
			flex: 1,
		},
		scrollContent: {
			paddingTop: 8,
			paddingBottom: 32,
			gap: 16,
		},
		card: {
			padding: 0,
		},
	});
