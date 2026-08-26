/*
このファイルの責務
- 「通知設定」画面。どのカテゴリのプッシュを受け取るかをアカウント単位で切り替える。

#1629 【修正】この画面は «消えた» のではなく **一度も作られていなかった**。

#1510(SET-02) は `NotificationSettingsCard` / `useNotificationPreferences` /
`useOsNotificationPermission` と、API・DB（`user_notification_preferences`）・i18n
（`Settings.notifications.*`）まで全部作った。ただし置き場所は当時の
`profile/settings.tsx` を前提にしており（カード冒頭の «呼び出し側（settings.tsx）が
isGuest で出し分ける» がその名残）、#1583 の設定画面再編でその画面ごと無くなった時点で
**カードがどこからも描画されない状態**になっていた。

つまり «作った側だけあって使う側が無い»（#1375 と同じ形）である。オーナーから
「通知設定ってどこ行きました？」と聞かれて初めて発覚した。**画面を足すのがこのファイル。**

⚠️ この設定は **サーバへ同期される**（アカウント単位）。端末設定（device-settings.tsx）へ
   移さないこと。あちらの約束は «ログインし直しても・別端末でも引き継がれない» で、
   この画面はその真逆である。

⚠️ ゲスト（匿名ユーザー）には入口を出さない。プッシュの受け手が居ないため
   （出し分けは profile/index.tsx 側）。
*/
import React, { useCallback } from "react";
import { StyleSheet, ScrollView } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { ScreenHeader } from "@/components/ScreenHeader";
import type { Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { NotificationSettingsCard } from "@/features/settings/components/NotificationSettingsCard";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { useScreenTrace } from "@/hooks/useScreenTrace";
import i18n from "@/lib/i18n";

export default function NotificationSettingsScreen() {
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();
	useScreenTrace("NotificationSettings");

	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();

	// #949 【設計】Stack push 画面なので戻るは ScreenHeader が持つ。履歴が無い着地
	// （web の直リンク）だけ、この画面の唯一の入口であるマイページへ倒す
	const handleBack = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "notification_settings_back_pressed",
			error_level: "log",
			payload: { canGoBack: router.canGoBack() },
		});
		if (router.canGoBack()) {
			router.back();
			return;
		}
		router.replace({ pathname: "/[locale]/(tabs)/profile", params: { locale } });
	}, [lightImpact, logFrontendEvent, locale]);

	return (
		<LinearGradient colors={colors.backgroundGradient} style={styles.container}>
			<SafeAreaView style={styles.safeArea} edges={[]}>
				<ScreenHeader
					title={i18n.t("Settings.notifications.sectionTitle")}
					onPressBack={handleBack}
					testID="notification-settings-screen"
				/>
				<ScrollView
					style={styles.scrollView}
					contentContainerStyle={styles.scrollContent}
					testID="notification-settings-scroll">
					{/* カードが «OS が拒否中» の案内行・読み込み・失敗時の再試行まで自前で持つ。
					    この画面はそれを置くだけで、状態を二重に持たない */}
					<NotificationSettingsCard />
				</ScrollView>
			</SafeAreaView>
		</LinearGradient>
	);
}

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
		// 画面の地はグラデーションが担う。ここで色を持つのはヘッダー下の境界だけ
		divider: {
			backgroundColor: colors.border,
		},
		scrollContent: {
			paddingHorizontal: 16,
			paddingTop: 16,
			paddingBottom: 32,
		},
	});
