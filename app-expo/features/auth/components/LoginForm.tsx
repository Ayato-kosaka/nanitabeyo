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
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";
import { useLogger } from "@/hooks/useLogger";
import { useAuth } from "@/contexts/AuthProvider";
import { isGuestUser } from "@/lib/authGuest";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { LegalDocument } from "@/features/settings/components/LegalDocument";
import { Image } from "expo-image";
import { useSnackbar } from "@/contexts/SnackbarProvider";

interface LoginFormProps {
	/** E2E の可視判定に使う testID。呼び出し側で明示する（ルート: `login-screen`） */
	testID: string;
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
export function LoginForm({ testID }: LoginFormProps) {
	const [isLoading, setIsLoading] = useState(false);
	const [hasExistingAccount, setHasExistingAccount] = useState(false);
	const [selectedLegalDocument, setSelectedLegalDocument] = useState<"terms" | "privacy" | null>(null);

	const { signInWithOAuth, linkIdentity, user } = useAuth();
	const {
		BlurModal: LegalDocumentModal,
		open: openLegalDocumentModal,
		close: closeLegalDocumentModal,
	} = useBlurModal({ intensity: 100 });
	const { logFrontendEvent } = useLogger();
	const { showSnackbar } = useSnackbar();

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

				const launch = isUpgrade
					? // 未チェック（昇格狙い）: 匿名セッションのまま OAuth を追加(linkIdentity)を試みる。
						await linkIdentity(provider)
					: // チェック済み（既存ログイン狙い）または既にログイン済みなら、通常の OAuth サインインを行う。
						await signInWithOAuth(provider);

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
		[user, linkIdentity, signInWithOAuth, logFrontendEvent, showSnackbar, hasExistingAccount],
	);

	// Legal ドキュメント表示用のハンドラ
	const handleOpenLegalDocument = useCallback(
		(documentType: "terms" | "privacy") => {
			setSelectedLegalDocument(documentType);
			openLegalDocumentModal();
		},
		[openLegalDocumentModal],
	);

	return (
		<View style={styles.container} testID={testID}>
			{/* Existing Account Checkbox - Show only for anonymous users */}
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

			{/* OAuth Buttons */}
			<View style={styles.oauthContainer}>
				<PrimaryButton
					testID="login-google-button"
					label={i18n.t("auth.provider_google")}
					icon={
						<Image
							source={require("@/assets/images/logo_google_g_icon.png")}
							style={{ width: 30, height: 30 }}
							cachePolicy="memory-disk"
						/>
					}
					onPress={() => handleOAuthSignIn("google")}
					style={{ width: "100%" }}
					colors={["#ffffff", "#ffffff"]}
					shadowColor={"#000000"}
					labelStyle={{ color: "#1A1A1A", fontSize: 20 }}
					loading={isLoading}
					loadingIndicatorType="native"
					nativeLoadingColor={"#1A1A1A"}
				/>
				{/* <PrimaryButton
					label={i18n.t("auth.provider_facebook")}
					onPress={() => handleOAuthSignIn("facebook")}
					style={{ width: "100%" }}
					colors={["#ffffff", "#ffffff"]}
					shadowColor={"#000000"}
					labelStyle={{ color: "#1A1A1A", fontSize: 20 }}
					loading={isLoading}
					loadingIndicatorType="native"
					nativeLoadingColor={"#1A1A1A"}
				/>
				<PrimaryButton
					label={i18n.t("auth.provider_twitter")}
					onPress={() => handleOAuthSignIn("twitter")}
					style={{ width: "100%" }}
					colors={["#ffffff", "#ffffff"]}
					shadowColor={"#000000"}
					labelStyle={{ color: "#1A1A1A", fontSize: 20 }}
					loading={isLoading}
					loadingIndicatorType="native"
					nativeLoadingColor={"#1A1A1A"}
				/> */}
				<PrimaryButton
					testID="login-apple-button"
					label={i18n.t("auth.provider_apple")}
					icon={
						<Image
							source={require("@/assets/images/logo_apple_icon.png")}
							style={{ width: 30, height: 30 }}
							cachePolicy="memory-disk"
						/>
					}
					onPress={() => handleOAuthSignIn("apple")}
					style={{ width: "100%" }}
					colors={["#ffffff", "#ffffff"]}
					shadowColor={"#000000"}
					labelStyle={{ color: "#1A1A1A", fontSize: 20 }}
					loading={isLoading}
					loadingIndicatorType="native"
					nativeLoadingColor={"#1A1A1A"}
				/>
			</View>

			{/* 同意メッセージ */}
			<View style={styles.consentContainer}>
				<Text style={styles.consentText}>
					{i18n.t("auth.consent_login_prefix")}
					<Text style={styles.consentLink} onPress={() => handleOpenLegalDocument("terms")}>
						{i18n.t("auth.consent_login_terms")}
					</Text>
					{i18n.t("auth.consent_login_and")}
					{/* #1031 【設計】Detox からリーガルモーダルへの導線をタップできるよう testID を追加 */}
					<Text
						testID="login-privacy-link"
						style={styles.consentLink}
						onPress={() => handleOpenLegalDocument("privacy")}>
						{i18n.t("auth.consent_login_privacy")}
					</Text>
					{i18n.t("auth.consent_login_suffix")}
				</Text>
			</View>

			{/* Legal ドキュメントモーダル */}
			{/* #1031 【設計】Detox からモーダル表示を検証できるよう testID を追加 */}
			<LegalDocumentModal>
				{selectedLegalDocument && (
					<View testID="legal-document-modal">
						<LegalDocument documentType={selectedLegalDocument} />
					</View>
				)}
			</LegalDocumentModal>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		paddingHorizontal: 24,
		paddingVertical: 32,
	},
	oauthContainer: {
		flexWrap: "wrap",
		gap: 30,
		justifyContent: "center",
		width: "100%",
	},
	oauthButtonText: {
		fontSize: 14,
		fontWeight: "600",
		color: "#1A1A1A",
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
		backgroundColor: "#FFFFFF",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.5,
		shadowRadius: 16,
		elevation: 4,
	},
	checkboxChecked: {
		backgroundColor: "#F05537",
		borderColor: "#F05537",
	},
	checkboxMark: {
		color: "#FFFFFF",
		fontSize: 14,
		fontWeight: "700",
	},
	checkboxTextContainer: {
		flex: 1,
	},
	checkboxText: {
		fontSize: 16,
		color: "#1A1A1A",
		lineHeight: 22,
	},
	consentContainer: {
		marginTop: 16,
		paddingHorizontal: 4,
	},
	consentText: {
		fontSize: 12,
		color: "#6B7280",
		textAlign: "center",
		lineHeight: 18,
	},
	consentLink: {
		color: "#2563EB",
		textDecorationLine: "underline",
	},
});
