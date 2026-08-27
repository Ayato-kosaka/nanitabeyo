import React, { useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { BellOff, ChevronRight } from "lucide-react-native";

import { Card } from "@/components/Card";
import i18n from "@/lib/i18n";
import type { Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from "@shared/api/v1/constants/notificationCategories";

import { SettingsToggleItem } from "./SettingsToggleItem";
import { useNotificationPreferences } from "../hooks/useNotificationPreferences";
import { useOsNotificationPermission } from "../hooks/useOsNotificationPermission";

/**
 * 🔔 #1510 SET-02 通知カテゴリ別のオン/オフカード。
 *
 * ## 「オフ」の意味（リーダー判断 §2）
 * オフ＝**プッシュ送信のみ抑止**。通知一覧には残る。抑止の判定はサーバー側の
 * 配信直前（api: `notification-job.service.ts`）にあり、この画面はその設定を編集するだけ。
 *
 * ## OS が拒否中でもトグルを無効化しない（リーダー判断 §4）
 * 設定はアカウント単位で、許可済みの他端末には効く。この端末の OS 状態でトグルを
 * 無効化すると、後から OS 側を許可したときに自分の設定が何だったか分からなくなる。
 * 無効化ではなく、カード先頭の案内行で状況を説明する。
 *
 * ## ゲストには出さない
 * 呼び出し側（settings.tsx）が `isGuest` で出し分ける。プッシュの受け手が居ないため。
 */
export function NotificationSettingsCard() {
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();
	const { lightImpact } = useHaptics();
	const { showSnackbar } = useSnackbar();
	const { isOsNotificationDenied, openOsSettings, refresh } = useOsNotificationPermission();
	const { preferences, isLoading, hasLoadError, pendingCategory, reload, setPreference } = useNotificationPreferences({
		enabled: true,
	});

	const handleOpenOsSettings = useCallback(() => {
		lightImpact();
		openOsSettings();
		// 設定アプリから戻ってきたときのために読み直す（フォアグラウンド復帰の
		// 検知までは持ち込まない。次に画面を開いた時点でも読み直される）
		refresh();
	}, [lightImpact, openOsSettings, refresh]);

	const handleToggle = useCallback(
		async (category: NotificationCategory, next: boolean) => {
			lightImpact();
			const ok = await setPreference(category, next);
			if (!ok) showSnackbar(i18n.t("Settings.notifications.updateFailed"));
		},
		[lightImpact, setPreference, showSnackbar],
	);

	return (
		<Card style={styles.card} testID="settings-notifications-card">
			<Text style={styles.sectionTitle}>{i18n.t("Settings.notifications.sectionTitle")}</Text>

			{/* OS 側が拒否のときだけ出る案内。トグルの上に置き、状況を先に伝える */}
			{isOsNotificationDenied && (
				<TouchableOpacity
					style={styles.osNotice}
					onPress={handleOpenOsSettings}
					testID="settings-notifications-os-denied"
					accessibilityRole="button"
					accessibilityLabel={i18n.t("Settings.notifications.osDisabledTitle")}
					accessibilityHint={i18n.t("Settings.notifications.openOsSettings")}>
					<BellOff size={20} color={colors.warningAction} accessibilityElementsHidden importantForAccessibility="no" />
					<View style={styles.osNoticeTextColumn}>
						<Text style={styles.osNoticeTitle}>{i18n.t("Settings.notifications.osDisabledTitle")}</Text>
						<Text style={styles.osNoticeDescription}>{i18n.t("Settings.notifications.osDisabledDescription")}</Text>
						<Text style={styles.osNoticeAction}>{i18n.t("Settings.notifications.openOsSettings")}</Text>
					</View>
					<ChevronRight
						size={20}
						color={colors.warningAction}
						accessibilityElementsHidden
						importantForAccessibility="no"
					/>
				</TouchableOpacity>
			)}

			{isLoading && !preferences && (
				<View style={styles.stateRow} testID="settings-notifications-loading">
					<ActivityIndicator size="small" color={colors.textTertiary} />
				</View>
			)}

			{/* 取得に失敗したらトグルを描かない。既定値を描くと、実際にはオフにしている
			    ユーザーへ「オンになっている」と嘘をつくことになる（hooks 側のコメント参照） */}
			{hasLoadError && !preferences && (
				<TouchableOpacity
					style={styles.stateRow}
					onPress={reload}
					testID="settings-notifications-error"
					accessibilityRole="button"
					accessibilityLabel={i18n.t("Common.error")}>
					{/*
					  #1629 【修正】エビデンス撮影で **本文と «再試行» が重なって読めない**のを見つけた。
					  `justifyContent: "space-between"` だけでは、本文が長い言語で «再試行» を押し潰す。
					  本文へ `flex: 1`、ボタンへ «縮まない + 折り返さない» を与えて住み分ける。
					*/}
					<Text style={styles.errorText}>{i18n.t("Common.error")}</Text>
					<Text style={styles.retryText} numberOfLines={1}>
						{i18n.t("Common.retry")}
					</Text>
				</TouchableOpacity>
			)}

			{preferences &&
				NOTIFICATION_CATEGORIES.map((category, index) => (
					<SettingsToggleItem
						key={category}
						label={i18n.t(`Settings.notifications.${category}.title`)}
						description={i18n.t(`Settings.notifications.${category}.description`)}
						value={preferences[category] ?? true}
						onValueChange={(next) => handleToggle(category, next)}
						// 保存中の行だけ止める。他の行まで止めると、通信が遅いときに
						// 「画面全体が固まった」ように見える
						disabled={pendingCategory === category}
						isLast={index === NOTIFICATION_CATEGORIES.length - 1}
						testID={`settings-notifications-${category}`}
					/>
				))}
		</Card>
	);
}

const createStyles = (colors: Palette) =>
	StyleSheet.create({
		card: {
			padding: 0,
		},
		sectionTitle: {
			fontSize: 13,
			fontWeight: "600",
			color: colors.textSecondary,
			paddingHorizontal: 16,
			paddingTop: 16,
			paddingBottom: 4,
		},
		osNotice: {
			flexDirection: "row",
			alignItems: "center",
			gap: 12,
			marginHorizontal: 12,
			marginVertical: 8,
			paddingHorizontal: 12,
			paddingVertical: 12,
			borderRadius: 12,
			backgroundColor: colors.warningTint,
		},
		osNoticeTextColumn: {
			flex: 1,
		},
		osNoticeTitle: {
			fontSize: 14,
			fontWeight: "600",
			color: colors.warningText,
		},
		osNoticeDescription: {
			marginTop: 2,
			fontSize: 13,
			color: colors.warningText,
		},
		osNoticeAction: {
			marginTop: 6,
			fontSize: 13,
			fontWeight: "600",
			color: colors.warningAction,
			textDecorationLine: "underline",
		},
		stateRow: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			paddingHorizontal: 16,
			paddingVertical: 20,
		},
		errorText: {
			fontSize: 14,
			color: colors.textSecondary,
			// #1629 «再試行» を押し潰さないよう、余った幅は本文が持つ
			flex: 1,
		},
		retryText: {
			fontSize: 14,
			fontWeight: "600",
			color: colors.destructive,
			// #1629 本文に押されて折り返さない・縮まない
			flexShrink: 0,
			marginLeft: 12,
		},
	});
