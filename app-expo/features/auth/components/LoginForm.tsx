/*
責務:
- ログイン UI の «実体»。OAuth サインイン、同意文言、匿名→本登録の昇格チェックボックスを提供する。
- ローディング/エラー状態、i18n、アラート通知を扱う。

#1359 【設計】唯一の呼び出し元は app/[locale]/auth/login.tsx。
かつては features/profile 配下のラッパが BlurModal の中身としてこれを描いていたが、
「ログイン UI の表示状態が遷移と無関係な boolean」であることが #498（OAuth 成功後もモーダルが
閉じない）の根だったため、ルートへ移してモーダル側は削除した（履歴は git を参照）。

【リリース差分】電話番号 / SMS ログイン（入力欄・E.164 検証・OTP モーダル）はここから削除した。
コメントアウトされた入力 UI からしか到達できない死にコードで、オーナー判断により削除が確定している
（#1359 の確定事項コメント）。復活させるときは OTP を **別ルート**（`/[locale]/auth/login/otp?phone=...`）
にすること。番号入力と OTP 入力は「やり直したくなる 2 段階」で、戻る手段を Navigator に持たせないと
自前の戻るボタンを抱えることになる。#1205 の二重実行ガードとその回帰テストも一緒に消えているので、
**git から設計コメントごと復元**すること。
*/
import React, { useState, useCallback } from "react";
import { ActivityIndicator, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import i18n from "@/lib/i18n";
import { useLogger } from "@/hooks/useLogger";
import { useAuth } from "@/contexts/AuthProvider";
import { isGuestUser } from "@/lib/authGuest";
import { Image } from "expo-image";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { router } from "expo-router";
import { useLocale } from "@/hooks/useLocale";
import type { LegalDocumentType } from "@/lib/legalRoute";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

interface LoginFormProps {
	/** E2E の可視判定に使う testID。呼び出し側で明示する（ルート: `login-screen`） */
	testID: string;

	/**
	 * #1370 ログイン後の行き先。OAuth の `redirectTo` に載せて callback へ引き継ぐ。
	 *
	 * 🔒 **検証済みの内部パスだけ**を受け取る。生の `?next=` を渡さないこと。
	 * 呼び出し元（app/[locale]/auth/login.tsx）が `lib/authNext.ts` の `resolveNextPath` を通す。
	 * web の OAuth は全画面リダイレクトでページごと作り直されるため、URL に載せる以外に
	 * 「どこから来たか」を callback まで運ぶ手段が無い。
	 */
	next?: string;
}

/*
#1359 【設計】`onClose` / `showTitle` は削除した。
- `onClose`: 「OAuth ブラウザの結末によらず呼び出し側が UI を閉じる」ためのフックで、#498
  （Android で OAuth 成功後もログイン UI が残る）の «根» そのものだった。ルート化で
  「ログイン UI の寿命 = ルートの寿命」になり、閉じる責務は Navigator が持つ。prop を残すと
  「閉じる責務は呼び出し側にある」という壊れた前提を再び配線できてしまうので、no-op でも置かない。
- `showTitle`: 唯一の呼び出し元（app/[locale]/auth/login.tsx）は ScreenHeader が同じタイトルを
  出すため常に false だった。見出しはヘッダーが持つ。
*/
export function LoginForm({ testID, next }: LoginFormProps) {
	const [isLoading, setIsLoading] = useState(false);
	const [hasExistingAccount, setHasExistingAccount] = useState(false);

	const { signInWithOAuth, linkIdentity, user } = useAuth();
	const { logFrontendEvent } = useLogger();
	const { showSnackbar } = useSnackbar();
	const { locale } = useLocale();
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);

	const handleOAuthSignIn = useCallback(
		async (provider: "google" | "facebook" | "twitter" | "apple") => {
			// #1092 【設計】auth が未確定(user === null)のまま進めてはならない分岐。
			// `user?.is_anonymous` は未確定でも undefined = falsy になるため、下の分岐は
			// linkIdentity(匿名ユーザーの昇格)ではなく signInWithOAuth(新規ユーザー作成)を選ぶ。
			// 匿名で貯めたデータから切り離された別アカウントが生まれる = アカウント分裂なので、
			// 「未確定なら何もしない」を明示する。
			// ユーザーの操作起点なので実際には解決済みのはずだが、その前提をコードで保証していなかった。
			if (!user) {
				logFrontendEvent({
					event_name: "oauth_signin_blocked_auth_unresolved",
					error_level: "warn",
					payload: { provider },
				});
				showSnackbar(i18n.t("Common.error"));
				return;
			}

			setIsLoading(true);
			try {
				// #1092 PR4b `user.is_anonymous` の直読みから共通判定（lib/authGuest.ts）へ寄せた。
				// user === null は上でガード済みなので、ここでの意味は「匿名セッションか」で変わらない。
				// is_anonymous が欠落している場合にログイン済み扱いになる（＝ linkIdentity しない）のも同じ
				const isAnonymous = isGuestUser(user);
				const isUpgrade = isAnonymous && !hasExistingAccount;

				// #1370 【設計】どちらの経路にも `next` を載せる。載せないと web の全画面リダイレクトから
				// 戻ったときに callback が行き先を知らず、全員マイページに着地して元の画面へ戻れない
				const launch = isUpgrade
					? // 未チェック（昇格狙い）: 匿名セッションのまま OAuth を追加(linkIdentity)を試みる。
						await linkIdentity(provider, { next })
					: // チェック済み（既存ログイン狙い）または既にログイン済みなら、通常の OAuth サインインを行う。
						await signInWithOAuth(provider, { next });

				// #1062 【設計】ブラウザセッションの結末を記録する。ただし **これで成否を判定してはいけない**。
				// Android の openAuthSessionAsync は「AppState が active に戻ったこと」と
				// 「deep link の url イベント」を race させるため、deep link でログインに成功した場合でも
				// dismiss が勝つことがある（実測: 成功と同一試行で dismiss が記録される）。
				// 成否は callback 画面の oauth_callback_success / oauth_callback_no_result を正とする。
				logFrontendEvent({
					event_name: launch.outcome === "cancelled" ? "oauth_signin_browser_dismissed" : "oauth_signin_success",
					error_level: "log",
					payload: {
						provider,
						isUpgrade,
						hasExistingAccount,
						outcome: launch.outcome,
						...(launch.outcome === "cancelled" ? { browser_result_type: launch.browserResultType } : {}),
						// #1359 かつては "login_modal" 固定だった。ログイン UI がルートになった今、
						// モーダル時代のログと同じ値のままだと #498（Android で OAuth 成功後もモーダルが
						// 閉じない）の再発を BigQuery で見分けられない
						context: "login_screen",
					},
				});
			} catch (error: unknown) {
				logFrontendEvent({
					event_name: "oauth_signin_error",
					error_level: "error",
					payload: { provider, error: (error as Error).message },
				});
				showSnackbar(i18n.t("Common.error"));
			} finally {
				setIsLoading(false);
			}
		},
		[user, linkIdentity, signInWithOAuth, logFrontendEvent, showSnackbar, hasExistingAccount, next],
	);

	/*
	#1368 【設計】法務文書は BlurModal をやめて `/[locale]/legal/[doc]` ルートへ push する。
	規約・プライバシーポリシーは URL で指せるべき対象で、モーダルである必然性が無かった
	（同じモーダルが 3 箇所に複製されていた）。

	⚠️ ここで «閉じてから push» が要らないのは、この時点で開いている BlurModal が
	 1 つも無いからである。LoginForm の唯一の呼び出し元は `app/[locale]/auth/login.tsx`
	（ルートそのもの）で、portal レイヤには何も載っていない。
	 BlurModal の中から push すると遷移先が portal の下に潜って触れなくなる（#1364 で実測）ので、
	 将来この UI を再びオーバーレイの中へ入れるなら、その時点で «閉じてから push» が必須になる。
	*/
	const handleOpenLegalDocument = useCallback(
		(documentType: Extract<LegalDocumentType, "terms" | "privacy">) => {
			logFrontendEvent({
				event_name: "login_legal_document_pressed",
				error_level: "log",
				payload: { documentType },
			});
			router.push({ pathname: "/[locale]/legal/[doc]", params: { locale, doc: documentType } });
		},
		[logFrontendEvent, locale],
	);

	return (
		<View style={styles.container} testID={testID}>
			{/* Existing Account Checkbox - Show only for anonymous users
			    ボタンの «上» に置く（デザインレビューで確定。押す前に読ませたい分岐スイッチのため）*/}
			{/* #1092 PR4b ここは `isGuestUser(user)` へ丸ごと寄せない。isGuestUser は user === null（認証未確定）を
			    ゲストへ倒すため、そのまま置くと未確定の一瞬だけチェックボックスが出て消える。
			    このチェックボックスは上の handleOAuthSignIn の分岐用で、未確定の間はその分岐自体が
			    「何もしない」に倒れている（＝出しても押す意味がない）。
			    そのため null の扱いだけ従来どおり `user &&` で落とし、is_anonymous の解釈だけ共通判定へ揃える。 */}
			{user && isGuestUser(user) && (
				<TouchableOpacity
					style={styles.checkboxContainer}
					onPress={() => setHasExistingAccount(!hasExistingAccount)}
					disabled={isLoading}>
					<View style={[styles.checkbox, hasExistingAccount && styles.checkboxChecked]}>
						{hasExistingAccount && <Text style={styles.checkboxMark}>✓</Text>}
					</View>
					<View style={styles.checkboxTextContainer}>
						<Text style={styles.checkboxText}>{i18n.t("auth.existing_account_checkbox")}</Text>
					</View>
				</TouchableOpacity>
			)}

			{/* OAuth Buttons
			    #1486 【設計】影付きの PrimaryButton から «1px の枠線だけ» のフラットなピルへ変えた
			   （デザインレビューで確定。強い影は付けない）。ラベルは「◯◯で続ける」。
			    アイコンは絶対配置で左端に固定し、ラベルはボタン中央へ揃える */}
			<View style={styles.oauthContainer}>
				<TouchableOpacity
					testID="login-google-button"
					style={styles.oauthButton}
					onPress={() => handleOAuthSignIn("google")}
					disabled={isLoading}
					accessibilityRole="button"
					accessibilityState={{ disabled: isLoading, busy: isLoading }}
					activeOpacity={0.6}>
					<Image
						source={require("@/assets/images/logo_google_g_icon.png")}
						style={styles.oauthIcon}
						cachePolicy="memory-disk"
					/>
					{isLoading ? (
						<ActivityIndicator size="small" color={colors.textPrimary} testID="login-google-button-loading" />
					) : (
						<Text style={styles.oauthLabel}>{i18n.t("auth.continue_with_google")}</Text>
					)}
				</TouchableOpacity>
				{/* Facebook / Twitter ログインは #1359 以前からコメントアウトされたまま提供していない。
				    復活させるときは同じフラットなピルの形で足すこと */}
				<TouchableOpacity
					testID="login-apple-button"
					style={styles.oauthButton}
					onPress={() => handleOAuthSignIn("apple")}
					disabled={isLoading}
					accessibilityRole="button"
					accessibilityState={{ disabled: isLoading, busy: isLoading }}
					activeOpacity={0.6}>
					<Image
						source={require("@/assets/images/logo_apple_icon.png")}
						style={styles.oauthIcon}
						cachePolicy="memory-disk"
					/>
					{isLoading ? (
						<ActivityIndicator size="small" color={colors.textPrimary} testID="login-apple-button-loading" />
					) : (
						<Text style={styles.oauthLabel}>{i18n.t("auth.continue_with_apple")}</Text>
					)}
				</TouchableOpacity>
			</View>

			{/* 同意メッセージ */}
			<View style={styles.consentContainer}>
				<Text style={styles.consentText}>
					{i18n.t("auth.consent_login_prefix")}
					{/* #1368 プライバシーポリシー側（login-privacy-link）だけ testID があり、
					    利用規約側は「押した先」を機械的に検証できなかったので揃えた */}
					<Text testID="login-terms-link" style={styles.consentLink} onPress={() => handleOpenLegalDocument("terms")}>
						{i18n.t("auth.consent_login_terms")}
					</Text>
					{i18n.t("auth.consent_login_and")}
					{/* #1031 【設計】E2E からリーガル導線をタップできるよう testID を追加。
					    #1368 遷移先は BlurModal から `/[locale]/legal/privacy` ルートへ変わった。
					    ⚠️ この testID が効くのは web だけ。入れ子 `<Text>` はネイティブ View を持たないため
					    Detox からは到達できず、mobile 側のリーガル導線検証は設定画面に集約している
					    （e2e-mobile/screens/LoginScreen.ts のコメント参照） */}
					<Text
						testID="login-privacy-link"
						style={styles.consentLink}
						onPress={() => handleOpenLegalDocument("privacy")}>
						{i18n.t("auth.consent_login_privacy")}
					</Text>
					{i18n.t("auth.consent_login_suffix")}
				</Text>
			</View>
		</View>
	);
}

// #1509 【設計】`StyleSheet.create` はモジュール評価時に 1 度だけ走るためテーマを追従できない。
// パレットを受け取るファクトリにし、画面側で `useThemedStyles` から呼ぶ（`contexts/ThemeProvider.tsx`）。
const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			paddingHorizontal: 24,
			paddingTop: 20,
			paddingBottom: 32,
		},
		oauthContainer: {
			gap: 16,
			width: "100%",
		},
		// フラットなアウトラインのピル。影は付けない（デザインレビューで確定）
		oauthButton: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			height: 60,
			borderRadius: 30,
			borderWidth: 1,
			borderColor: c.borderNeutral,
			backgroundColor: c.surface,
			paddingHorizontal: 60,
		},
		oauthIcon: {
			position: "absolute",
			left: 24,
			width: 28,
			height: 28,
		},
		oauthLabel: {
			fontSize: 17,
			fontWeight: "700",
			color: c.textPrimary,
		},
		checkboxContainer: {
			flexDirection: "row",
			alignItems: "center",
			marginBottom: 20,
			paddingHorizontal: 4,
		},
		checkbox: {
			width: 24,
			height: 24,
			borderRadius: 6,
			alignItems: "center",
			justifyContent: "center",
			marginRight: 12,
			backgroundColor: c.surface,
			// #1486 影は使わない（デザインレビューで確定）。枠線で輪郭を出す
			borderWidth: 1.5,
			borderColor: c.borderNeutral,
		},
		checkboxChecked: {
			backgroundColor: c.brand,
			borderColor: c.brand,
		},
		checkboxMark: {
			// ブランド色で塗り潰したチェックボックスの上のチェック。地の色がライト / ダークで
			// 変わらない（brand は据え置き）ため、文字も振らない
			color: FixedColors.onFilled,
			fontSize: 14,
			fontWeight: "700",
		},
		checkboxTextContainer: {
			flex: 1,
		},
		checkboxText: {
			fontSize: 16,
			color: c.textPrimary,
			lineHeight: 22,
		},
		consentContainer: {
			marginTop: 16,
			paddingHorizontal: 4,
		},
		consentText: {
			fontSize: 12,
			color: c.textSecondary,
			textAlign: "center",
			lineHeight: 18,
		},
		consentLink: {
			color: c.linkAlt,
			textDecorationLine: "underline",
		},
	});
