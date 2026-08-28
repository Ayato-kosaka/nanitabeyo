/*
このファイルの責務
- 「アカウント管理」画面。**アカウントそのものを手放す操作**（ログアウト / アカウント削除）だけを置く。

#1629 【仕様】オーナー指示でマイページ本体から切り出した。

マイページ本体の 2 ブロック目は «なに食べよについて / 端末設定 / あなたの報告履歴 /
アカウント管理» の 4 行で、閲覧系の行が並ぶ。そこへ «押すと戻れない» 2 行が同居していると、
指が滑ったときの被害が大きい。1 階層挟むことで、その 2 つへ届くまでに必ず 1 回の意思が要る。

⚠️ ここに «設定» を足さないこと。この画面の約束は「並んでいるのは全部、
   アカウントを手放す方向の操作である」ことである。読むだけの行を混ぜると
   その約束が崩れ、切り出した意味が無くなる。

⚠️ ゲスト（匿名ユーザー）には 2 行とも出さない。ゲストには users 行が無く、
   削除対象の実体を持たない（API 側も AuthUserGuard）。ログアウトも、
   匿名セッションを捨てるだけで «ログインし直す» 先が無い。
   その場合はこの画面自体に入口を出さない（profile/index.tsx 側で出し分ける）。
*/
import React, { useCallback, useRef, useState } from "react";
import { StyleSheet, ScrollView } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { Card } from "@/components/Card";
import { ScreenHeader } from "@/components/ScreenHeader";
import type { Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { useAuth } from "@/contexts/AuthProvider";
import { useDialog } from "@/contexts/DialogProvider";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { SettingsMenuItem } from "@/features/settings/components/SettingsMenuItem";
import { useAPICall } from "@/hooks/useAPICall";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { useScreenTrace } from "@/hooks/useScreenTrace";
import i18n from "@/lib/i18n";
import type { DeleteMeResponse } from "@shared/api/v1/res";

export default function AccountSettingsScreen() {
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();
	useScreenTrace("AccountSettings");

	const { logout } = useAuth();
	const { lightImpact, mediumImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();
	const { confirm } = useDialog();
	const { showSnackbar } = useSnackbar();
	const { callBackend } = useAPICall();

	/**
	 * #1511 アカウント削除の実行中フラグ。
	 * `ref` と `state` を両方持つのは、**押下の抑止**（同期的に読める ref）と
	 * **行の表示**（再描画が要る state）で要求が違うため。state だけだと
	 * 連打の 2 回目が再描画前に通る（DialogProvider の `confirming` と同じ考え方）。
	 */
	const isDeletingAccountRef = useRef(false);
	const [isDeletingAccount, setIsDeletingAccount] = useState(false);

	// #949 【設計】Stack push 画面なので戻るは ScreenHeader が持つ。履歴が無い着地
	// （web の直リンク）だけ、この画面の唯一の入口であるマイページへ倒す
	const handleBack = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "account_settings_back_pressed",
			error_level: "log",
			payload: { canGoBack: router.canGoBack() },
		});
		if (router.canGoBack()) {
			router.back();
			return;
		}
		router.replace({ pathname: "/[locale]/(tabs)/profile", params: { locale } });
	}, [lightImpact, logFrontendEvent, locale]);

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
	}, [logout, mediumImpact, logFrontendEvent, confirm]);

	/**
	 * #1511 ACC-01 アカウント削除。
	 *
	 * ## この行が «消えていた» 経緯
	 * #1533 はこの導線を旧設定画面 `profile/settings.tsx` に足した。その後 #1375 の
	 * 最終同期（e4ee0369）が旧設定画面ごとファイルを消したため、一時期 **main では
	 * `settings-delete-account` が app-expo のどこにも存在しない**状態になっていた。
	 * i18n・API・E2E・撮影シナリオは揃っているのにボタンだけ無い、という
	 * «作った側だけあって使う側が無い»（#1375 と同じ形）。
	 *
	 * ⚠️ これは #1596 / PR #1597 が main 側で、この PR（#1583）が同時刻に別途、
	 *    **互いを知らずに直した**。main 側は 2fb27f3a でマージ済み。取り込みの衝突は
	 *    «#1583 の 3 画面構成 + このファイルの実装» の向きで解いてある。両者の差は
	 *    実行中表示（`deleteAccountInProgress` を行のラベルに出す）と、キャンセルの
	 *    ログ、そして下の «logout を別の try で包む» 3 点だけで、導線・色・置き場所は同じ。
	 *
	 * ## logout を try の «外側» に置かない理由（main 側との差）
	 * main 側の実装は `logout()` を削除と同じ try に入れている。削除が成功した後に
	 * `signOut()` が失敗すると catch へ落ちるため、**削除は済んでいるのにエラーの
	 * スナックバーが出てログイン状態のままに見える**。下ではその 1 行だけを内側の
	 * try/catch で包み、失敗してもローカルの後始末として扱って先へ進めている。
	 *
	 * ## 二段確認にしている理由
	 * この操作は **取り消せない**。アプリ DB 側は匿名化（論理削除）だが、Supabase Auth の
	 * アカウントは物理削除するので、同じ資格情報での再ログイン経路が残らない。
	 * 猶予期間も置いていない（#1511 のリーダー判断）ので、誤操作を戻す手段が UI にしかない。
	 * そこで「何が起きるかの説明」と「取り消せないことへの明示的な同意」を分けて 2 枚出す。
	 *
	 * ## ログアウトを try/catch で包む理由
	 * 削除が成功した時点で **Auth 側のアカウントは既に存在しない**。その状態で
	 * `signOut()` を呼ぶとサーバ往復（`POST /auth/v1/logout`）が 401/403 になり得る。
	 * ここで throw させると「削除は成功したのにエラー表示のままログイン状態で留まる」
	 * という最悪の見え方になるため、失敗してもローカルの後始末として扱って先へ進む
	 *（画面遷移は AuthProvider の SIGNED_OUT ハンドラが担う）。
	 */
	const handleDeleteAccount = useCallback(async () => {
		mediumImpact();
		logFrontendEvent({
			event_name: "settings_delete_account_pressed",
			error_level: "log",
			payload: {},
		});

		// 1 枚目: 何が起きるかの説明
		const acknowledged = await confirm({
			title: i18n.t("Settings.deleteAccountConfirmTitle"),
			message: i18n.t("Settings.deleteAccountConfirmMessage"),
			confirmLabel: i18n.t("Settings.deleteAccountConfirmButton"),
			cancelLabel: i18n.t("Common.cancel"),
		});
		if (!acknowledged) {
			logFrontendEvent({
				event_name: "settings_delete_account_cancelled",
				error_level: "log",
				payload: { step: "explain" },
			});
			return;
		}

		// 2 枚目: 取り消せないことへの明示的な同意
		const confirmed = await confirm({
			title: i18n.t("Settings.deleteAccountFinalTitle"),
			message: i18n.t("Settings.deleteAccountFinalMessage"),
			confirmLabel: i18n.t("Settings.deleteAccountFinalButton"),
			cancelLabel: i18n.t("Common.cancel"),
		});
		if (!confirmed) {
			logFrontendEvent({
				event_name: "settings_delete_account_cancelled",
				error_level: "log",
				payload: { step: "final" },
			});
			return;
		}

		// 二度押しで DELETE が 2 回飛ぶのを防ぐ（2 回目は 404 になるだけだが、
		// ユーザーにはエラーとして見えてしまう）
		if (isDeletingAccountRef.current) return;
		isDeletingAccountRef.current = true;
		setIsDeletingAccount(true);

		try {
			await callBackend<Record<string, never>, DeleteMeResponse>("v1/users/me", {
				method: "DELETE",
				requestPayload: {},
			});

			logFrontendEvent({
				event_name: "settings_delete_account_success",
				error_level: "log",
				payload: {},
			});
			showSnackbar(i18n.t("Settings.deleteAccountSuccess"));

			try {
				await logout({ scope: "local" });
			} catch (error) {
				// 削除済みアカウントの signOut は失敗しうる。削除自体は成功しているので握る
				logFrontendEvent({
					event_name: "settings_delete_account_logout_error",
					error_level: "warn",
					payload: { error: (error as Error).message },
				});
			}
		} catch (error) {
			logFrontendEvent({
				event_name: "settings_delete_account_error",
				error_level: "error",
				payload: { error: (error as Error)?.message ?? String(error) },
			});
			showSnackbar(i18n.t("Settings.deleteAccountError"));
		} finally {
			isDeletingAccountRef.current = false;
			setIsDeletingAccount(false);
		}
	}, [mediumImpact, logFrontendEvent, confirm, callBackend, showSnackbar, logout]);

	return (
		<LinearGradient colors={colors.backgroundGradient} style={styles.container}>
			<SafeAreaView style={styles.safeArea} edges={[]}>
				<ScreenHeader
					title={i18n.t("Settings.account.title")}
					onPressBack={handleBack}
					testID="account-settings-screen"
				/>
				<ScrollView
					style={styles.scrollView}
					contentContainerStyle={styles.scrollContent}
					testID="account-settings-scroll">
					{/*
					  #1511 【仕様】アカウント削除はログアウトの «下» に置く。破壊力の弱い導線を先に見せるため。
					  testID は移設前（マイページ本体）から据え置く。E2E から名指しできる識別子を、
					  置き場所が変わっただけで変える理由が無い。
					*/}
					<Card style={styles.card}>
						<SettingsMenuItem
							label={i18n.t("Settings.logout")}
							onPress={handleLogout}
							testID="settings-logout"
							textStyle={{ color: colors.destructive, fontWeight: "700" }}
							accessibilityRole="button"
						/>
						<SettingsMenuItem
							label={
								isDeletingAccount
									? i18n.t("Settings.deleteAccountInProgress")
									: i18n.t("Settings.deleteAccount")
							}
							onPress={handleDeleteAccount}
							testID="settings-delete-account"
							textStyle={{ color: colors.destructive, fontWeight: "700" }}
							isLast
							accessibilityRole="button"
						/>
					</Card>
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
