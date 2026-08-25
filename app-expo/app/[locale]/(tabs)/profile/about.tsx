/**
 * 🚩 #1583 なに食べよについて。
 *
 * ## なぜ設定画面から切り出したか
 * オーナー指摘（2026-08-25）:「・なに食べよについて ・なに食べよ を応援する
 * ・利用規約、、、 ・バージョン番号」。設定画面に «アプリそのものの話»（規約・著作権）と
 * «自分の設定»（ブロック済み・通知）が同居していた。
 *
 * ## ここに置くものの基準
 * **アプリそのものについての情報と、運営への働きかけ**を置く。
 * 問い合わせのときにこの 1 画面を開けば、規約もガイドラインも版数も揃う形にしてある。
 *
 * ## «応援する» はストアレビュー導線だけ
 * オーナー確定仕様（2026-08-25「ストアレビュー導線だけ」）。寄付・シェア・SNS フォローは
 * 足していない。中身は #611 の «レビューを書く» そのままで、ラベルだけを変えた。
 * web には «ストア» が無いので行ごと出さない（`Platform.OS !== "web"`）。
 */
import React, { useCallback } from "react";
import { Platform, StyleSheet, ScrollView, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { Card } from "@/components/Card";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Env } from "@/constants/Env";
import type { Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { SettingsMenuItem } from "@/features/settings/components/SettingsMenuItem";
import { useStoreReview } from "@/features/settings/hooks/useStoreReview";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import type { LegalDocumentType } from "@/lib/legalRoute";

export default function AboutScreen() {
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();
	const router = useRouter();
	const { handleLeaveReview } = useStoreReview();

	const handleBack = useCallback(() => {
		lightImpact();
		router.back();
	}, [lightImpact, router]);

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
		[lightImpact, logFrontendEvent, router, locale],
	);

	/**
	 * #1583 表示するバージョン。
	 *
	 * `COMMIT_ID` は注入されない環境（ローカル / E2E CI）で undefined になりうるので、
	 * そのときは括弧ごと出さない。「1.14.0(undefined)」と出すくらいなら版だけ出す。
	 * `APP_VERSION` は #1078 の理由でフォールバックを持たないため、そのまま出す。
	 */
	const versionLabel = Env.COMMIT_ID ? `${Env.APP_VERSION}(${Env.COMMIT_ID})` : `${Env.APP_VERSION}`;

	return (
		<LinearGradient colors={colors.backgroundGradient} style={styles.container}>
			<SafeAreaView style={styles.safeArea} edges={[]}>
				<ScreenHeader title={i18n.t("Settings.about")} onPressBack={handleBack} testID="about-header" />
				<ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} testID="about-scroll">
					{/* #317 / #611 ストア導線は web では非表示（ストアが存在しない） */}
					{Platform.OS !== "web" && (
						<Card style={styles.card}>
							<SettingsMenuItem
								label={i18n.t("Settings.support")}
								onPress={handleLeaveReview}
								isLast
								testID="settings-leave-review"
								accessibilityRole="button"
							/>
						</Card>
					)}

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

					{/* #1583 バージョン。押せる行ではないので SettingsMenuItem を使わない
					    （ChevronRight が付くと «開ける» と読める）。
					    問い合わせのときに読み上げてもらえるよう selectable にしてある */}
					<Card style={styles.card}>
						<View style={styles.versionRow} testID="settings-version">
							<Text style={styles.versionLabel}>{i18n.t("Settings.version")}</Text>
							<Text style={styles.versionValue} selectable>
								{versionLabel}
							</Text>
						</View>
					</Card>
				</ScrollView>
			</SafeAreaView>
		</LinearGradient>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: { flex: 1 },
		safeArea: { flex: 1 },
		scrollView: { flex: 1 },
		scrollContent: { paddingTop: 16, paddingBottom: 32, gap: 16 },
		card: { padding: 0 },
		versionRow: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			paddingHorizontal: 16,
			paddingVertical: 16,
		},
		versionLabel: {
			fontSize: 16,
			color: c.textPrimary,
			fontWeight: "500",
		},
		versionValue: {
			fontSize: 14,
			color: c.textSecondary,
		},
	});
