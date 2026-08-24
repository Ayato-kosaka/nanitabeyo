import React, { useCallback, useRef, useState } from "react";
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
import { useAPICall } from "@/hooks/useAPICall";
import type { DeleteMeResponse } from "@shared/api/v1/res";
import { useRouter } from "expo-router";
import { useLocale } from "@/hooks/useLocale";
import { ScreenHeader } from "@/components/ScreenHeader";
import { openExternalUrl } from "@/lib/openExternalUrl";

interface SettingsMenuItemProps {
	label: string;
	onPress: () => void;
	isLast?: boolean;
	textStyle?: StyleProp<TextStyle>;
	/** E2E テスト用: Web では data-testid として出力される */
	testID?: string;
	/**
	 * #950 【仕様】画面遷移(router.push)は "link"、モーダル起動・破壊的操作等は "button" として
	 * 支援技術に役割を伝える。Web では role="link"/"button" に対応する。
	 */
	accessibilityRole?: "link" | "button";
}

function SettingsMenuItem({
	label,
	onPress,
	isLast,
	textStyle,
	testID,
	accessibilityRole = "button",
}: SettingsMenuItemProps) {
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	return (
		<>
			<TouchableOpacity
				style={styles.menuItem}
				onPress={onPress}
				testID={testID}
				accessibilityRole={accessibilityRole}
				accessibilityLabel={label}>
				<Text style={[styles.menuItemText, textStyle]}>{label}</Text>
				{/* #950 【仕様】装飾アイコンのため読み上げ対象から除外し、行のラベルと二重に読み上げさせない */}
				<ChevronRight
					size={20}
					color={colors.textTertiary}
					accessibilityElementsHidden
					importantForAccessibility="no"
				/>
			</TouchableOpacity>
			{!isLast && <View style={styles.separator} />}
		</>
	);
}

/**
 * #1509 SET-05 テーマ（表示モード）の 3 択セレクタ。
 *
 * ## なぜラジオ相当の «行» にしたか
 * iOS / Android の設定アプリと同型にするため。切替は即時反映で、確定ボタンを持たない
 * （その場でアプリ全体の色が変わるので、結果がそのまま確認になる）。
 *
 * ## アクセシビリティ
 * `accessibilityRole="radio"` + `accessibilityState.selected` で選択状態を支援技術へ伝える。
 * チェックアイコンは視覚的な冗長表現なので読み上げからは外す。
 */
const THEME_OPTION_ICONS: Record<ThemePreference, typeof Smartphone> = {
	system: Smartphone,
	light: Sun,
	dark: Moon,
};

function ThemeSelector() {
	const { preference, setPreference, colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();

	const handleSelect = useCallback(
		(next: ThemePreference) => {
			lightImpact();
			logFrontendEvent({
				event_name: "settings_theme_preference_changed",
				error_level: "log",
				payload: { from: preference, to: next },
			});
			setPreference(next);
		},
		[lightImpact, logFrontendEvent, preference, setPreference],
	);

	return (
		<View testID="settings-theme-selector" accessibilityRole="radiogroup">
			{THEME_PREFERENCES.map((option, index) => {
				const Icon = THEME_OPTION_ICONS[option];
				const isSelected = preference === option;
				const isLast = index === THEME_PREFERENCES.length - 1;
				const label = i18n.t(`Settings.theme.options.${option}`);
				return (
					<React.Fragment key={option}>
						<TouchableOpacity
							style={styles.themeOption}
							onPress={() => handleSelect(option)}
							testID={`settings-theme-${option}`}
							accessibilityRole="radio"
							accessibilityState={{ selected: isSelected, checked: isSelected }}
							// #934 と同じ理由: react-native-web は accessibilityState.checked を DOM の
							// aria-checked へ変換しないため、native/web 両対応の aria-checked を直接指定する
							aria-checked={isSelected}
							accessibilityLabel={label}>
							<Icon
								size={20}
								color={isSelected ? colors.brand : colors.textSecondary}
								accessibilityElementsHidden
								importantForAccessibility="no"
							/>
							<Text style={[styles.themeOptionText, isSelected && styles.themeOptionTextSelected]}>{label}</Text>
							{isSelected && (
								// #1509 【E2E】チェックは lucide の SVG なので testID を直接載せると
								// Detox / react-native-web のどちらで拾えるかが実装依存になる。
								// 素の View で包んで testID を持たせ、両方から確実に見えるようにする
								<View testID={`settings-theme-${option}-check`}>
									<Check size={20} color={colors.brand} accessibilityElementsHidden importantForAccessibility="no" />
								</View>
							)}
						</TouchableOpacity>
						{!isLast && <View style={styles.separator} />}
					</React.Fragment>
				);
			})}
		</View>
	);
}

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
	const { callBackend } = useAPICall();
	/**
	 * #1511 アカウント削除の実行中フラグ。
	 * `ref` と `state` を両方持つのは、**押下の抑止**（同期的に読める ref）と
	 * **行の表示**（再描画が要る state）で要求が違うため。state だけだと
	 * 連打の 2 回目が再描画前に通る（DialogProvider の `confirming` と同じ考え方）。
	 */
	const isDeletingAccountRef = useRef(false);
	const [isDeletingAccount, setIsDeletingAccount] = useState(false);
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

	// #611 【設計】ストア直接遷移（market:// / itms-apps:// → https:// フォールバック）
	const openStoreReviewPage = useCallback(async () => {
		try {
			let primaryUrl: string;
			let fallbackUrl: string;

			if (Platform.OS === "ios") {
				// iOS: itms-apps:// を優先、不可なら https:// にフォールバック
				const appStoreUrl = Env.APP_STORE_URL;
				if (!appStoreUrl) {
					logFrontendEvent({
						event_name: "settings_leave_review_open_store_failed",
						error_level: "warn",
						payload: { platform: Platform.OS, reason: "missing_app_store_url" },
					});
					return;
				}
				// URL から App ID を抽出（例: https://apps.apple.com/app/id<APP_ID>）
				const appIdMatch = appStoreUrl.match(/id(\d+)/);
				if (appIdMatch) {
					primaryUrl = `itms-apps://apps.apple.com/app/id${appIdMatch[1]}?action=write-review`;
					fallbackUrl = `${appStoreUrl}?action=write-review`;
				} else {
					// App ID が見つからない場合は不正な URL と判断し、スキップ
					logFrontendEvent({
						event_name: "settings_leave_review_open_store_failed",
						error_level: "warn",
						payload: {
							platform: Platform.OS,
							reason: "invalid_app_store_url_format",
							appStoreUrl,
						},
					});
					return;
				}
			} else if (Platform.OS === "android") {
				// Android: market:// を優先、不可なら https:// にフォールバック
				const playStoreUrl = Env.PLAY_STORE_URL;
				if (!playStoreUrl) {
					logFrontendEvent({
						event_name: "settings_leave_review_open_store_failed",
						error_level: "warn",
						payload: { platform: Platform.OS, reason: "missing_play_store_url" },
					});
					return;
				}
				// URL からパッケージ名を抽出（例: https://play.google.com/store/apps/details?id=<package>）
				const packageMatch = playStoreUrl.match(/id=([^&]+)/);

				const packageName = packageMatch?.[1];
				// パッケージ名は Play Store の一般的なフォーマット（英数字・ドット・アンダースコア）のみ許可
				const isValidPackageName = typeof packageName === "string" && /^[A-Za-z0-9._]+$/.test(packageName);
				if (isValidPackageName) {
					primaryUrl = `market://details?id=${packageName}&showAllReviews=true`;
					fallbackUrl = `https://play.google.com/store/apps/details?id=${packageName}&showAllReviews=true`;
				} else {
					// パッケージ名が抽出・検証できない場合は不正な URL で遷移しないようにスキップ
					logFrontendEvent({
						event_name: "settings_leave_review_open_store_failed",
						error_level: "warn",
						payload: {
							platform: Platform.OS,
							reason: "invalid_play_store_url_format",
							playStoreUrl,
						},
					});
					return;
				}
			} else {
				// web など他のプラットフォームでは何もしない
				logFrontendEvent({
					event_name: "settings_leave_review_open_store_skipped",
					error_level: "log",
					payload: { platform: Platform.OS, reason: "unsupported_platform" },
				});
				return;
			}

			// 優先 URL を試し、開けなければフォールバック
			const canOpenPrimary = await Linking.canOpenURL(primaryUrl);
			const urlToOpen = canOpenPrimary ? primaryUrl : fallbackUrl;

			// #1121 外部遷移は openExternalUrl へ統一する。
			// ここは上で web を早期 return しているので実行されるのはネイティブのみ
			await openExternalUrl(urlToOpen);

			logFrontendEvent({
				event_name: "settings_leave_review_open_store_success",
				error_level: "log",
				payload: { url: urlToOpen },
			});
		} catch (error) {
			logFrontendEvent({
				event_name: "settings_leave_review_open_store_error",
				error_level: "error",
				payload: { error: (error as Error).message },
			});
			showSnackbar(i18n.t("Common.error"));
		}
	}, [logFrontendEvent]);

	// #611 【設計】満足度確認ダイアログ → OK で openStoreReviewPage()
	const handleLeaveReview = useCallback(async () => {
		lightImpact();
		logFrontendEvent({
			event_name: "settings_leave_review_pressed",
			error_level: "log",
			payload: {},
		});

		showDialog(i18n.t("Settings.rateDialogMessage"), {
			title: i18n.t("Settings.rateDialogTitle"),
			okLabel: i18n.t("Settings.rateDialogOk"),
			cancelLabel: i18n.t("Common.cancel"),
			onConfirm: async () => {
				logFrontendEvent({
					event_name: "settings_leave_review_confirmed",
					error_level: "log",
					payload: {},
				});
				await openStoreReviewPage();
			},
		});
	}, [lightImpact, logFrontendEvent, showDialog, openStoreReviewPage]);

	/*
	#1368 【設計】Legal ドキュメントは BlurModal をやめて `/[locale]/legal/[doc]` へ遷移する。

	⚠️ ここで «閉じてから push» が要らないのは、この時点で開いている BlurModal が 1 つも無いからである
	（この画面は BlurModal の中身ではなくルートそのもので、リーガル行を押せる状態＝どのモーダルも
	 開いていない状態）。BlurModal の中から push すると、遷移先が portal の下に潜って見えず触れなくなる
	 （`Portal.Host` が `<Stack>` を包んでいるため。#1364 で実測。
	 features/map/components/SelectedRestaurantDetails.tsx のコメント参照）。
	*/
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

	/**
	 * #1511 ACC-01 アカウント削除。
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
			await callBackend<Record<string, never>, DeleteMeResponse>("/v1/users/me", {
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

	return (
		<LinearGradient colors={colors.backgroundGradient} style={styles.container}>
			<SafeAreaView style={styles.safeArea} edges={[]}>
				<ScreenHeader title={i18n.t("Settings.title")} onPressBack={handleBack} />
				{/* #1131 E2E から「ログアウト行まで送る」ためのスクロール対象。見た目には影響しない。
				    ログアウト行は最下段のカードにあり、端末によっては初期表示で画面外にいる */}
				<ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} testID="settings-scroll">
					{/* #1509 Card 0: 表示テーマ（システム追従 / ライト / ダーク）。
					    切替の効果がその場で見えるよう最上段に置く */}
					<Text style={styles.sectionTitle} accessibilityRole="header">
						{i18n.t("Settings.theme.sectionTitle")}
					</Text>
					<Card style={styles.card}>
						<ThemeSelector />
					</Card>

					{/* Card 1: フィードバック・レビュー・ブロック済みトピック */}
					<Card style={styles.card}>
						<SettingsMenuItem
							label={i18n.t("Settings.sendFeedback")}
							onPress={handleSendFeedback}
							testID="settings-feedback"
							// #951 【仕様】モーダル起動から画面遷移(router.push)に変わったため link に変更(#950 の規約)
							accessibilityRole="link"
						/>
						{/* #317 【設計】Leave Review は web では非表示 */}
						{Platform.OS !== "web" && (
							<SettingsMenuItem
								label={i18n.t("Settings.leaveReview")}
								onPress={handleLeaveReview}
								testID="settings-leave-review"
								accessibilityRole="button"
							/>
						)}
						{/* #747 【設計】ブロック済みの料理トピック管理画面へ遷移 */}
						<SettingsMenuItem
							label={i18n.t("Settings.blockedTopics.navigationLabel")}
							onPress={handleNavigateToBlockedTopics}
							isLast
							testID="settings-blocked-topics"
							accessibilityRole="link"
						/>
					</Card>

					{/* Card 2: Legal ＋ Logout */}
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
							isLast={isGuest}
							testID="settings-copyright"
							accessibilityRole="link"
						/>
						{!isGuest && (
							<SettingsMenuItem
								label={i18n.t("Settings.logout")}
								onPress={handleLogout}
								testID="settings-logout"
								textStyle={{
									color: colors.destructive,
									fontWeight: "700",
								}}
								accessibilityRole="button"
							/>
						)}
						{/*
						  #1511 【仕様】アカウント削除はログイン済み（非匿名）ユーザーにのみ出す。
						  ゲストには users 行が無く、削除対象となる実体を持たない（API も AuthUserGuard）。

						  ログアウトの «下» に置くのは、破壊力の弱い導線を先に見せるため。
						  文言も色も「取り返しがつかない」ことが分かる強さにしている。
						*/}
						{!isGuest && (
							<SettingsMenuItem
								label={
									isDeletingAccount
										? i18n.t("Settings.deleteAccountInProgress")
										: i18n.t("Settings.deleteAccount")
								}
								onPress={handleDeleteAccount}
								testID="settings-delete-account"
								textStyle={{
									color: "#B3261E",
									fontWeight: "700",
								}}
								isLast
								accessibilityRole="button"
							/>
						)}
					</Card>
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
