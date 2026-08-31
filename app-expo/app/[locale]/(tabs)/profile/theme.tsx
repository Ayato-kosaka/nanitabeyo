/*
このファイルの責務
- 「表示テーマ」画面。ライト / ダーク / システム設定に合わせる の 3 択だけを持つ。

#1629 【仕様】オーナー指示で端末設定から 1 階層深いページへ切り出した。

端末設定（device-settings.tsx）の 1 ブロック目は «言語 / 触覚フィードバック / 表示テーマ» の
3 行で、うち触覚だけがその場で切り替わるトグルである。3 択ラジオをその中へ直置きすると
1 行が縦に伸びて «1 行 1 設定» の見え方が崩れるため、テーマだけ独立した画面へ送る。

⚠️ `theme_preference_v1` は **端末に閉じた設定**である（ログインし直しても・別端末でも
   引き継がれない）。この画面をサーバ同期の設定置き場に育てないこと。
   同期する設定は端末設定ではなくアカウント側へ置く（device-settings.tsx 冒頭の注意書きと同じ）。
*/
import React, { useCallback } from "react";
import { StyleSheet, ScrollView } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { Card } from "@/components/Card";
import { ScreenHeader } from "@/components/ScreenHeader";
import type { Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { ThemeSelector } from "@/features/settings/components/ThemeSelector";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { useScreenTrace } from "@/hooks/useScreenTrace";
import i18n from "@/lib/i18n";

export default function ThemeSettingsScreen() {
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();
	useScreenTrace("ThemeSettings");

	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();

	// #949 【設計】Stack push 画面なので戻るは ScreenHeader が持つ。履歴が無い着地
	// （web の直リンク）だけ、この画面の唯一の入口である端末設定へ倒す
	const handleBack = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "theme_settings_back_pressed",
			error_level: "log",
			payload: { canGoBack: router.canGoBack() },
		});
		if (router.canGoBack()) {
			router.back();
			return;
		}
		router.replace({ pathname: "/[locale]/(tabs)/profile/device-settings", params: { locale } });
	}, [lightImpact, logFrontendEvent, locale]);

	return (
		<LinearGradient colors={colors.backgroundGradient} style={styles.container}>
			<SafeAreaView style={styles.safeArea} edges={[]}>
				<ScreenHeader
					title={i18n.t("Settings.theme.sectionTitle")}
					onPressBack={handleBack}
					testID="theme-settings-screen"
				/>
				<ScrollView
					style={styles.scrollView}
					contentContainerStyle={styles.scrollContent}
					testID="theme-settings-scroll">
					<Card style={styles.card}>
						<ThemeSelector />
					</Card>
				</ScrollView>
			</SafeAreaView>
		</LinearGradient>
	);
}

/*
#1504 と同じ理由で地の色を直書きしない。カードとヘッダーだけがテーマに追従して
その周りが白い、という絵になるのを防ぐ。
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
			paddingHorizontal: 16,
			paddingTop: 16,
			paddingBottom: 32,
		},
		card: {
			padding: 0,
			borderColor: colors.border,
		},
	});
