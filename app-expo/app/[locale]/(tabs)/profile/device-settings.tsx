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
import { ScreenHeader } from "@/components/ScreenHeader";
import { SettingsToggleItem } from "@/features/settings/components/SettingsToggleItem";
import { setHapticsEnabled } from "@/features/settings/hapticsSettingsStore";
import { useHapticsEnabled } from "@/features/settings/hooks/useHapticsEnabled";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { useScreenTrace } from "@/hooks/useScreenTrace";
import i18n from "@/lib/i18n";

export default function DeviceSettingsScreen() {
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
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
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

					{/* 端末ローカルの設定。以後 SET-02(通知) / SET-05(ダークモード) / SET-06(言語) もこのカードに並ぶ */}
					<Card style={styles.card}>
						<SettingsToggleItem
							label={i18n.t("Settings.hapticsEnabled")}
							value={hapticsEnabled}
							onValueChange={handleToggleHaptics}
							isLast
							testID="settings-haptics-toggle"
						/>
					</Card>
				</ScrollView>
			</SafeAreaView>
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
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
		color: "#6B7280",
		paddingHorizontal: 16,
		paddingTop: 8,
		paddingBottom: 12,
	},
	card: {
		padding: 0,
	},
});
