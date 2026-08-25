import React, { useCallback } from "react";
import {
	View,
	Text,
	TouchableOpacity,
	StyleSheet,
	ScrollView,
	Platform,
	StyleProp,
	TextStyle,
	Linking,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Check, ChevronRight, Moon, Smartphone, Sun } from "lucide-react-native";
import { Card } from "@/components/Card";
import { SettingsMenuItem } from "@/features/settings/components/SettingsMenuItem";
import type { Palette } from "@/constants/Palette";
import { THEME_PREFERENCES, useAppTheme, useThemedStyles, type ThemePreference } from "@/contexts/ThemeProvider";
import i18n from "@/lib/i18n";
import { useAuth } from "@/contexts/AuthProvider";
import { isGuestUser } from "@/lib/authGuest";
import type { LegalDocumentType } from "@/lib/legalRoute";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useDialog } from "@/contexts/DialogProvider";
import { Env } from "@/constants/Env";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useRouter } from "expo-router";
import { useLocale } from "@/hooks/useLocale";
import { ScreenHeader } from "@/components/ScreenHeader";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { NotificationSettingsCard } from "@/features/settings/components/NotificationSettingsCard";

export default function SettingsScreen() {
	const { logout, user, isAuthResolved } = useAuth();
	// #1509 テーマ切替はこの画面から行う。切替の結果がその場のこの画面に出るよう、画面自体もテーマ対応する
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const router = useRouter();
	const { lightImpact, mediumImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();
	const { showDialog, confirm } = useDialog();
	const { showSnackbar } = useSnackbar();
	// #951 【設計】フィードバックは useBlurModal をやめ、専用画面(profile/feedback)へ遷移する
	// (レビュー指摘: #949 の ScreenHeader による戻る導線と統一するため)
	// #1368 【設計】リーガル 4 件も同じ理由で useBlurModal をやめ、/[locale]/legal/[doc] へ遷移する。
	// この画面から useBlurModal は無くなった

	// #949 【設計】設定画面は Stack で push されるため戻る導線が存在せず、
	// ハードウェア/スワイプバックが使えない Web ではロックアウトになっていた。ScreenHeader で解消する。
	const handleBack = useCallback(() => {
		lightImpact();
		router.back();
	}, [lightImpact, router]);

	// #747 【設計】ブロック済みトピック管理画面への遷移
	const handleNavigateToBlockedTopics = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "settings_blocked_topics_pressed",
			error_level: "log",
			payload: {},
		});
		router.push({
			pathname: "/[locale]/(tabs)/profile/blocked-topics",
			params: { locale },
		});
	}, [lightImpact, logFrontendEvent, router, locale]);


	/*
	#1368 【設計】Legal ドキュメントは BlurModal をやめて `/[locale]/legal/[doc]` へ遷移する。

	⚠️ ここで «閉じてから push» が要らないのは、この時点で開いている BlurModal が 1 つも無いからである
	（この画面は BlurModal の中身ではなくルートそのもので、リーガル行を押せる状態＝どのモーダルも
	 開いていない状態）。BlurModal の中から push すると、遷移先が portal の下に潜って見えず触れなくなる
	 （`Portal.Host` が `<Stack>` を包んでいるため。#1364 で実測。
	 features/map/components/SelectedRestaurantDetails.tsx のコメント参照）。
	*/
	// ログアウト処理を実行
	// #950 【仕様】破壊的操作(セッション破棄)のため、押下直後に実行せず確認ダイアログを挟む
	const handleLogout = useCallback(async () => {
		mediumImpact();
		logFrontendEvent({
			event_name: "settings_logout_pressed",
			error_level: "log",
			payload: {},
		});

		const ok = await confirm({
			title: i18n.t("Settings.logoutConfirmTitle"),
			message: i18n.t("Settings.logoutConfirmMessage"),
			confirmLabel: i18n.t("Settings.logout"),
			cancelLabel: i18n.t("Common.cancel"),
		});
		if (!ok) return;

		try {
			await logout({ scope: "local" });
			logFrontendEvent({
				event_name: "logout_success",
				error_level: "log",
				payload: {},
			});
		} catch (error) {
			logFrontendEvent({
				event_name: "logout_error",
				error_level: "error",
				payload: { error: (error as Error).message },
			});
		}
	}, [logout, mediumImpact, logFrontendEvent]);

	// #951 【設計】フィードバック画面へ遷移(モーダル起動から変更)
	const handleSendFeedback = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "settings_send_feedback_pressed",
			error_level: "log",
			payload: { userId: user?.id },
		});
		router.push({
			pathname: "/[locale]/(tabs)/profile/feedback",
			params: { locale },
		});
	}, [lightImpact, logFrontendEvent, user?.id, router, locale]);

	// #1092 【設計】auth 未確定(user === null)を「ログイン済み」と誤解させない。
	// `!user?.is_anonymous` は未確定でも true になるため、下のログアウト行が
	// 一瞬出てから消える（押せてしまう瞬間もある）。確定するまではゲスト側に寄せる。
	// 判定は features/profile の isGuest と同じ共通関数（lib/authGuest.ts）へ揃えている。
	const isGuest = !isAuthResolved || isGuestUser(user);

	// #1583 端末設定ページ（表示テーマ）
	const handleNavigateToDeviceSettings = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "settings_device_settings_pressed",
			error_level: "log",
			payload: {},
		});
		router.push({ pathname: "/[locale]/(tabs)/profile/device-settings", params: { locale } });
	}, [lightImpact, logFrontendEvent, router, locale]);

	// #1583 なに食べよについてページ（応援する / 規約 / 版数）
	const handleNavigateToAbout = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "settings_about_pressed",
			error_level: "log",
			payload: {},
		});
		router.push({ pathname: "/[locale]/(tabs)/profile/about", params: { locale } });
	}, [lightImpact, logFrontendEvent, router, locale]);

	return (
		<LinearGradient colors={colors.backgroundGradient} style={styles.container}>
			<SafeAreaView style={styles.safeArea} edges={[]}>
				<ScreenHeader title={i18n.t("Settings.title")} onPressBack={handleBack} />
				{/* #1131 E2E から「ログアウト行まで送る」ためのスクロール対象。見た目には影響しない。
				    ログアウト行は最下段のカードにあり、端末によっては初期表示で画面外にいる */}
				<ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} testID="settings-scroll">
					{/* #1583 【設計】設定は 3 画面に割れている。
					    ここ（設定）… アカウントに紐づく設定と、運営への連絡
					    端末設定 …… 端末に閉じて保存される設定（表示テーマ）
					    なに食べよについて … アプリそのものの情報（規約・著作権・版数）と応援導線

					    «見出しを付けて 1 画面に並べる» のではなく画面を割ったのはオーナー指示
					    （2026-08-25「ページ遷移をするように」）。設定画面が縦に伸び続けるのを
					    止めるのが目的なので、行が増えるときはまずどの画面に属するかを決めること。 */}
					<Card style={styles.card}>
						<SettingsMenuItem
							label={i18n.t("Settings.sendFeedback")}
							onPress={handleSendFeedback}
							testID="settings-feedback"
							// #951 【仕様】モーダル起動から画面遷移(router.push)に変わったため link に変更(#950 の規約)
							accessibilityRole="link"
						/>
						{/* #747 【設計】ブロック済みの料理トピック管理画面へ遷移 */}
						<SettingsMenuItem
							label={i18n.t("Settings.blockedTopics.navigationLabel")}
							onPress={handleNavigateToBlockedTopics}
							isLast
							testID="settings-blocked-topics"
							accessibilityRole="link"
						/>
					</Card>

					{/* #1510 【設計】通知カテゴリ別のオン/オフ。
					    ゲスト（匿名）にはプッシュの受け手が存在しない（PushTokenRegistration が
					    匿名ユーザーのトークンを登録しない）ため、カードごと出さない。
					    auth 未確定のあいだも isGuest 側に倒れるので、一瞬だけ出て消えることはない。

					    #1583 これは «端末設定» へ移していない。通知の設定はアカウントに紐づき
					    サーバーへ同期されるので、端末に閉じた設定の集まりに混ぜると
					    «別端末でも効くのか» が読めなくなる */}
					{!isGuest && <NotificationSettingsCard />}

					{/* #1583 ここから先はページへ送るだけの行 */}
					<Card style={styles.card}>
						<SettingsMenuItem
							label={i18n.t("Settings.deviceSettings")}
							onPress={handleNavigateToDeviceSettings}
							testID="settings-device-settings"
							accessibilityRole="link"
						/>
						<SettingsMenuItem
							label={i18n.t("Settings.about")}
							onPress={handleNavigateToAbout}
							isLast
							testID="settings-about"
							accessibilityRole="link"
						/>
					</Card>

					{/* #1583 ログアウトは «戻れない操作» なので、他のどの分類にも混ぜず単独で最下段に置く */}
					{!isGuest && (
						<Card style={styles.card}>
							<SettingsMenuItem
								label={i18n.t("Settings.logout")}
								onPress={handleLogout}
								testID="settings-logout"
								textStyle={{
									color: colors.destructive,
									fontWeight: "700",
								}}
								isLast
								accessibilityRole="button"
							/>
						</Card>
					)}
				</ScrollView>
			</SafeAreaView>
		</LinearGradient>
	);
}

// #1509 【設計】テーマ依存のスタイルはファクトリで組む（`contexts/ThemeProvider.tsx` の useThemedStyles）。
// 値はすべて main のリテラルをそのまま `constants/Palette.ts` の light へ写したもので、ライトの見た目は変わらない。
const createStyles = (c: Palette) =>
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
		card: {
			padding: 0,
		},
		// #1509 テーマセクションの見出し（カードの外に置く）
		sectionTitle: {
			fontSize: 13,
			fontWeight: "700",
			color: c.textSecondary,
			marginTop: 16,
			marginHorizontal: 32,
		},
		menuItem: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			paddingHorizontal: 16,
			paddingVertical: 16,
		},
		menuItemText: {
			fontSize: 16,
			color: c.textPrimary,
			fontWeight: "500",
		},
		separator: {
			height: 1,
			backgroundColor: c.divider,
			marginHorizontal: 16,
		},
		// #1509 テーマ 3 択の行。アイコン + ラベル + 選択チェックの 3 カラム
		themeOption: {
			flexDirection: "row",
			alignItems: "center",
			gap: 12,
			paddingHorizontal: 16,
			paddingVertical: 16,
		},
		themeOptionText: {
			flex: 1,
			fontSize: 16,
			color: c.textPrimary,
			fontWeight: "500",
		},
		themeOptionTextSelected: {
			color: c.brand,
			fontWeight: "700",
		},
	});
