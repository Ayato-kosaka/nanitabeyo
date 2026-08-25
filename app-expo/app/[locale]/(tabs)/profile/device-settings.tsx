/*
このファイルの責務
- 「端末設定」画面。**この端末にだけ保存される設定**（サーバへ同期しない設定）を集める。

#1504 【設計】なぜマイページ直置きではなく 1 画面を挟むのか。

#1402 で独立した設定画面は無くなり、設定項目はマイページ本体（profile/index.tsx）の
縦リストへ統合された。そこへ «オン/オフのトグル» を直接並べると、
「押すと次の画面が開く行」と「押すとその場で値が変わる行」が同じリストに混ざる。
端末設定は今後 SET-02(通知) / SET-05(ダークモード) / SET-06(言語切替) と増える予定で、
増えるほどマイページ本体がトグルで埋まっていく。そのため «端末に閉じた設定» だけを
この画面へ切り出し、マイページ側には遷移する行（`settings-device-settings`）を 1 本だけ置く。

⚠️ ここに «サーバへ同期する設定»（アカウント設定・プロフィール等）を置かないこと。
   この画面の約束は「ログインし直しても・別端末でも引き継がれない」ことである。
   引き継がれる設定を混ぜると、ユーザーからは同じ見た目の行なのに挙動が違うことになる。

⚠️ ここに BlurModal を置かないこと（理由は profile/index.tsx 冒頭の Portal.Host の注意書きと同じ）。
*/
import React, { useCallback } from "react";
import { StyleSheet, ScrollView, Text } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { Card } from "@/components/Card";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import type { Palette } from "@/constants/Palette";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SettingsToggleItem } from "@/features/settings/components/SettingsToggleItem";
import { ThemeSelector } from "@/features/settings/components/ThemeSelector";
import { setHapticsEnabled } from "@/features/settings/hapticsSettingsStore";
import { useHapticsEnabled } from "@/features/settings/hooks/useHapticsEnabled";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { useScreenTrace } from "@/hooks/useScreenTrace";
import i18n from "@/lib/i18n";

export default function DeviceSettingsScreen() {
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();
	useScreenTrace("DeviceSettings");

	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();

	const hapticsEnabled = useHapticsEnabled();

	// #949 【設計】Stack push 画面のため、戻る導線は ScreenHeader が持つ。
	// 履歴が無い着地（web の直リンク / ディープリンクのコールドロード）だけは戻る先が
	// 存在しないので、この画面の唯一の導線であるマイページへ倒す（legal/[doc] と同じ判断）。
	const handleBack = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "device_settings_back_pressed",
			error_level: "log",
			payload: { canGoBack: router.canGoBack() },
		});
		if (router.canGoBack()) {
			router.back();
			return;
		}
		router.replace({ pathname: "/[locale]/(tabs)/profile", params: { locale } });
	}, [lightImpact, logFrontendEvent, locale]);

	// #1504 【設計】ハプティクスのオン/オフ切替。オンにした場合のみ確認の振動を返す
	// (オフへ切り替えたのに振動が鳴ると、切ったつもりが切れていないように見えるため)
	const handleToggleHaptics = useCallback(
		(next: boolean) => {
			void setHapticsEnabled(next);
			logFrontendEvent({
				event_name: "settings_haptics_toggled",
				error_level: "log",
				payload: { enabled: next },
			});
			if (next) lightImpact();
		},
		[lightImpact, logFrontendEvent],
	);

	return (
		<LinearGradient colors={colors.backgroundGradient} style={styles.container}>
			<SafeAreaView style={styles.safeArea} edges={[]}>
				<ScreenHeader
					title={i18n.t("Settings.deviceSettings.title")}
					onPressBack={handleBack}
					testID="device-settings-screen"
				/>
				<ScrollView
					style={styles.scrollView}
					contentContainerStyle={styles.scrollContent}
					testID="device-settings-scroll">
					{/* #1504 端末に閉じた設定であることを明示する。SET-02/05/06 が増えても文言は変わらない */}
					<Text style={styles.description}>{i18n.t("Settings.deviceSettings.description")}</Text>

					{/* 端末ローカルの設定。以後 SET-02(通知) / SET-06(言語) もこのカードに並ぶ */}
					<Card style={styles.card}>
						<SettingsToggleItem
							label={i18n.t("Settings.hapticsEnabled")}
							value={hapticsEnabled}
							onValueChange={handleToggleHaptics}
							testID="settings-haptics-toggle"
						/>
					</Card>

					{/* #1583 SET-05 表示テーマ。この画面が最初から想定していた住人
					    （上の «今後 SET-05(ダークモード) が並ぶ» の実現）。
					    `theme_preference_v1` は端末に閉じており、この画面の約束
					    «ログインし直しても・別端末でも引き継がれない» と一致する。

					    見出しを別に立てているのは、上のカードがトグル・こちらが 3 択ラジオで
					    操作の種類が違うため。同じカードに混ぜると «押すと切り替わる行» と
					    «押すと選ばれる行» が並んで読みにくい */}
					<Text style={styles.sectionTitle} accessibilityRole="header">
						{i18n.t("Settings.theme.sectionTitle")}
					</Text>
					<Card style={styles.card}>
						<ThemeSelector />
					</Card>
				</ScrollView>
			</SafeAreaView>
		</LinearGradient>
	);
}

/*
#1504 【修正】画面の地を直書きしていたため、**ダークでもカードの外側が白のまま**だった
（エビデンス撮影で実測: 地 rgb(251,252,252)）。カードとヘッダーだけがテーマに追従し、
その周りが白いという絵になっていた。
*/
const createStyles = (colors: Palette) =>
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
			paddingBottom: 32,
		},
		description: {
			fontSize: 13,
			lineHeight: 20,
			color: colors.textSecondary,
			paddingHorizontal: 16,
			paddingTop: 8,
			paddingBottom: 12,
		},
		card: {
			padding: 0,
		},
		// #1583 テーマセクションの見出し（カードの外に置く。profile/index.tsx から写した値）
		sectionTitle: {
			fontSize: 13,
			fontWeight: "700",
			color: colors.textSecondary,
			marginTop: 16,
			marginHorizontal: 32,
			marginBottom: 8,
		},
	});
