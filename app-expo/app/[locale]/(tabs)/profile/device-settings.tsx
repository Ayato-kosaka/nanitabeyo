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
import { SettingsMenuItem } from "@/features/settings/components/SettingsMenuItem";
import { SettingsToggleItem } from "@/features/settings/components/SettingsToggleItem";
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

	// #1629 【仕様】言語はマイページ本体から移設。端末設定の 1 ブロック目に集める（オーナー指示）
	const handleNavigateToLanguage = useCallback(() => {
		lightImpact();
		logFrontendEvent({ event_name: "settings_language_pressed", error_level: "log", payload: {} });
		router.push({ pathname: "/[locale]/(tabs)/profile/language", params: { locale } });
	}, [lightImpact, logFrontendEvent, locale]);

	// #1629 【仕様】表示テーマを 1 階層深いページへ（オーナー指示）
	const handleNavigateToTheme = useCallback(() => {
		lightImpact();
		logFrontendEvent({ event_name: "settings_theme_pressed", error_level: "log", payload: {} });
		router.push({ pathname: "/[locale]/(tabs)/profile/theme", params: { locale } });
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

					{/*
					  #1629 【仕様】1 ブロック目は «言語» → «触覚フィードバック» → «表示テーマ» の順（オーナー指示）。

					  ⚠️ #1504 は「押すと画面が開く行」と「押すとその場で値が変わる行」を同じカードに
					     混ぜない方針だったが、**オーナーの指示でこの 3 つを 1 ブロックにまとめている**。
					     方針を忘れて戻したのではない。並べ替えるときはオーナーへ確認すること。

					  表示テーマは 3 択ラジオを直置きせず `profile/theme` へ送る（同じくオーナー指示）。
					  これで «この画面に並ぶのは 1 行 1 設定» という形が揃う。
					*/}
					<Card style={styles.card}>
						<SettingsMenuItem
							label={i18n.t("Settings.language.navigationLabel")}
							onPress={handleNavigateToLanguage}
							testID="settings-language"
							accessibilityRole="link"
						/>
						<SettingsToggleItem
							label={i18n.t("Settings.hapticsEnabled")}
							value={hapticsEnabled}
							onValueChange={handleToggleHaptics}
							testID="settings-haptics-toggle"
						/>
						<SettingsMenuItem
							label={i18n.t("Settings.theme.sectionTitle")}
							onPress={handleNavigateToTheme}
							isLast
							testID="settings-theme"
							accessibilityRole="link"
						/>
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
	});
