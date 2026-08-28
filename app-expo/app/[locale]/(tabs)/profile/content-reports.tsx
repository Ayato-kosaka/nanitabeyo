/**
 * 🚩 #1584 あなたの報告履歴。
 *
 * ## 出すのは «いつ・どの理由で出したか» だけ
 * 審査状況は出さない（オーナー確定仕様）。API もそもそも返さない
 * （`api/src/v1/content-reports/content-reports.service.ts` の `findMine`）。
 *
 * 通報者は「誰の投稿を通報したか」を知っているので、審査結果まで見えると
 * **相手の投稿が消えたかどうかを推測できてしまう**。それは通報を相手への攻撃手段に変える。
 * #1514 が「相手に通知されることはありません」で守っているのと同じ配慮を、逆向きにも効かせる。
 *
 * したがってこの画面の価値は «二重に通報しなくて済む» と «出したこと自体を確認できる» の 2 点。
 * 「審査中」「対応済み」のようなラベルを後から足さないこと。足すなら上の判断からやり直す。
 *
 * ## 対象そのものへは飛ばさない
 * 行から投稿へ遷移させない。通報した相手の投稿を履歴から辿れるようにすると、
 * 「通報 → 様子を見に行く」の導線を作ることになる。対象は種別（投稿 / レビュー）だけ示す。
 */
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { LoadingIndicator } from "@/components/LoadingIndicator";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState } from "@/components/EmptyState";
import type { Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import i18n from "@/lib/i18n";
import { asApiList } from "@/lib/apiList";
import { toErrorLogMessage } from "@/lib/errorMessage";
import { useAPICall } from "@/hooks/useAPICall";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";

import type { MeContentReportListItem, QueryMeContentReportsResponse } from "@shared/api/v1/res";

export default function ContentReportsScreen() {
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();
	const { locale } = useLocale();
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();

	const [items, setItems] = useState<MeContentReportListItem[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [hasError, setHasError] = useState(false);

	const load = useCallback(async () => {
		setIsLoading(true);
		setHasError(false);
		try {
			const res = await callBackend<Record<string, never>, QueryMeContentReportsResponse>(
				"v1/users/me/content-reports",
				{ method: "GET", requestPayload: {} },
			);
			// #1561 と同じ防御。`data` が配列でない応答で画面ごと落とさない
			setItems(asApiList(res?.data));
		} catch (error) {
			setHasError(true);
			logFrontendEvent({
				event_name: "content_reports_history_fetch_failed",
				error_level: "error",
				payload: { error_message: toErrorLogMessage(error) },
			});
		} finally {
			setIsLoading(false);
		}
	}, [callBackend, logFrontendEvent]);

	useEffect(() => {
		void load();
	}, [load]);

	const handleBack = useCallback(() => {
		if (router.canGoBack()) router.back();
		else router.replace({ pathname: "/[locale]/(tabs)/profile", params: { locale } });
	}, [locale]);

	const renderItem = useCallback(
		({ item }: { item: MeContentReportListItem }) => (
			<View style={styles.item} testID="content-report-item">
				<Text style={styles.itemReason}>{i18n.t(`Report.reasons.${item.reasonCode}`)}</Text>
				<View style={styles.itemMetaRow}>
					<Text style={styles.itemMeta}>{i18n.t(`Report.history.target.${item.targetType}`)}</Text>
					<Text style={styles.itemMeta}>{new Date(item.createdAt).toLocaleDateString(locale)}</Text>
				</View>
			</View>
		),
		[styles, locale],
	);

	return (
		<LinearGradient colors={colors.backgroundGradient} style={styles.container}>
			<SafeAreaView style={styles.safeArea} edges={[]}>
				<ScreenHeader
					testID="content-reports-header"
					title={i18n.t("Report.history.pageTitle")}
					onPressBack={handleBack}
				/>
				{isLoading ? (
					<LoadingIndicator />
				) : (
					<FlatList
						data={items}
						keyExtractor={(item) => item.id}
						renderItem={renderItem}
						contentContainerStyle={styles.listContent}
						ListHeaderComponent={
							items.length > 0 ? <Text style={styles.note}>{i18n.t("Report.history.note")}</Text> : null
						}
						ListEmptyComponent={
							// EmptyState の description / variant は #1505 で入る。
							// このブランチにはまだ無いので、説明文は下に自前で置く
							<View>
								<EmptyState
									message={i18n.t("Report.history.empty")}
									error={hasError ? i18n.t("Report.history.error") : null}
									onRetry={hasError ? load : undefined}
									testID="content-reports-empty"
								/>
								{!hasError && <Text style={styles.emptyDescription}>{i18n.t("Report.history.emptyDescription")}</Text>}
							</View>
						}
					/>
				)}
			</SafeAreaView>
		</LinearGradient>
	);
}

const createStyles = (colors: Palette) =>
	StyleSheet.create({
		container: { flex: 1 },
		safeArea: { flex: 1 },
		listContent: { padding: 16, gap: 8, flexGrow: 1 },
		emptyDescription: {
			marginTop: 12,
			fontSize: 13,
			color: colors.textTertiary,
			textAlign: "center",
			lineHeight: 18,
		},
		note: {
			fontSize: 13,
			color: colors.textTertiary,
			marginBottom: 8,
			lineHeight: 18,
		},
		item: {
			backgroundColor: colors.surface,
			borderRadius: 12,
			paddingHorizontal: 16,
			paddingVertical: 14,
		},
		itemReason: {
			fontSize: 15,
			fontWeight: "500",
			color: colors.textPrimary,
		},
		itemMetaRow: {
			flexDirection: "row",
			justifyContent: "space-between",
			marginTop: 6,
		},
		itemMeta: {
			fontSize: 13,
			color: colors.textSecondary,
		},
	});
