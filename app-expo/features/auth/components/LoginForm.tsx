/*
責務:
- ログイン UI の «実体»。OAuth サインイン、同意文言、匿名→本登録の昇格チェックボックスを提供する。
- 電話番号によるログイン入力と E.164 形式のバリデーションを行う（現在 UI からは到達しない。下記参照）。
- OTP送信を開始し、onOAuthSignIn で各種OAuthサインインをトリガーする。
- ローディング/エラー状態、i18n、キーボード回避、アラート通知を扱う。

#1359 【設計】features/profile/components/LoginbackModal.tsx から «そのまま» 移設したもの。
ログイン UI が BlurModal（`useBlurModal`）に埋まっていて画面として扱えなかったため、
描画の実体をここへ切り出し、モーダル（LoginbackModal）とルート（app/[locale]/auth/login.tsx）の
両方から同じものを描けるようにする。この PR では **ロジックを一切変えていない**。
表示位置の違い（モーダルか画面か）は testID と showTitle の 2 つの prop だけで吸収する。
*/
import React, { useState, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";
import { useLogger } from "@/hooks/useLogger";
import { useAuth } from "@/contexts/AuthProvider";
import { isGuestUser } from "@/lib/authGuest";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { OtpModal } from "@/features/profile/components/OtpModal";
import { LegalDocument } from "@/features/settings/components/LegalDocument";
import { Image } from "expo-image";
import { useSnackbar } from "@/contexts/SnackbarProvider";

interface LoginFormProps {
	/**
	 * OAuth ブラウザの起動後に呼ばれる。モーダルから使うときは «自分を閉じる» ために必須。
	 *
	 * #1359 【設計】ルートから使うときは閉じる相手が居ないので optional にしてある。
	 * ルート化後は「ログイン UI の寿命 = ルートの寿命」になり、閉じる責務は Navigator が持つ。
	 */
	onClose?: () => void;
	/**
	 * ルート側の testID。E2E の可視判定に使うため、呼び出し側で明示する。
	 * モーダル: `login-modal` / ルート: `login-screen`
	 */
	testID: string;
	/**
	 * 見出し（`auth.login_title`）をこのコンポーネント自身が描くか。
	 *
	 * #1359 【設計】ルートでは ScreenHeader が同じタイトルを出すため false にして重複を避ける。
	 * 既定を true にしてあるのは、モーダル側の見た目を変えないため。
	 */
	showTitle?: boolean;
}

export function LoginForm({ onClose, testID, showTitle = true }: LoginFormProps) {
	const [phone, setPhone] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [errors, setErrors] = useState<{ phone?: string }>({});
	const [hasExistingAccount, setHasExistingAccount] = useState(false);
	const [selectedLegalDocument, setSelectedLegalDocument] = useState<"terms" | "privacy" | null>(null);

	const { signInWithOAuth, signInWithOtp, linkIdentity, user } = useAuth();
	const { BlurModal: OtpModalComponent, open: openOtpModal, close: closeOtpModal } = useBlurModal({ intensity: 100 });
	const {
		BlurModal: LegalDocumentModal,
		open: openLegalDocumentModal,
		close: closeLegalDocumentModal,
	} = useBlurModal({ intensity: 100 });
	const { logFrontendEvent } = useLogger();
	const { showSnackbar } = useSnackbar();

	const validatePhone = useCallback((phoneNumber: string): boolean => {
		// E.164 format validation (simplified)
		const e164Pattern = /^\+[1-9]\d{1,14}$/;
		return e164Pattern.test(phoneNumber);
	}, []);

	const handleSubmit = useCallback(async () => {
		const newErrors: { phone?: string } = {};

		if (!phone.trim()) {
			newErrors.phone = i18n.t("auth.error_required");
		} else if (!validatePhone(phone.trim())) {
			newErrors.phone = i18n.t("auth.error_invalid_phone");
		}

		setErrors(newErrors);

		if (Object.keys(newErrors).length > 0) {
			return;
		}

		setIsLoading(true);
		try {
			try {
				await signInWithOtp(phone);
				onClose?.();
				openOtpModal();

				logFrontendEvent({
					event_name: "otp_sent",
					error_level: "log",
					payload: { phone, flow: "login" },
				});
			} catch (error) {
				logFrontendEvent({
					event_name: "otp_send_error",
					error_level: "error",
					payload: { phone, error: (error as Error).message },
				});
				throw error;
			}
		} catch (error: unknown) {
			showSnackbar(i18n.t("Common.error"));
		} finally {
			setIsLoading(false);
		}
	}, [phone, validatePhone, logFrontendEvent, onClose, openOtpModal, showSnackbar, signInWithOtp]);

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
					event_name:
						launch.outcome === "cancelled" ? "oauth_signin_browser_dismissed" : "oauth_signin_success",
					error_level: "log",
					payload: {
						provider,
						isUpgrade,
						hasExistingAccount,
						outcome: launch.outcome,
						...(launch.outcome === "cancelled" ? { browser_result_type: launch.browserResultType } : {}),
						context: "login_modal",
					},
				});

				// ⚠️ 結末によらず必ず閉じる。dismiss でモーダルを開いたままにすると、
				// Android では「ログインできたのにモーダルが残る」状態になる（上記 race のため）。
				// #1359 ルートから使う場合は閉じる相手が居ない（Navigator が replace する）ので no-op。
				onClose?.();
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
		[user, linkIdentity, signInWithOAuth, logFrontendEvent, showSnackbar, hasExistingAccount, onClose],
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
			{showTitle && (
				<View style={styles.header}>
					<Text style={styles.title}>{i18n.t("auth.login_title")}</Text>
				</View>
			)}

			{/* <View style={styles.form}> */}
			{/* Phone Input */}
			{/* <View style={styles.inputContainer}>
						<Text style={styles.label}>{i18n.t("auth.field_phone")}</Text>
						<View style={[styles.inputWrapper, errors.phone && styles.inputError]}>
							<Phone size={20} color="#6B7280" style={styles.inputIcon} />
							<TextInput
								style={styles.input}
								value={phone}
								onChangeText={setPhone}
								placeholder="+81..."
								placeholderTextColor="#9CA3AF"
								keyboardType="phone-pad"
								autoCorrect={false}
								autoComplete="tel"
								editable={!isLoading}
							/>
						</View>
						{errors.phone && <Text style={styles.errorText}>{errors.phone}</Text>}
					</View> */}

			{/* SMS Hint */}
			{/* <Text style={styles.hint}>{i18n.t("auth.hint_sms")}</Text> */}

			{/* Login Button */}
			{/* <PrimaryButton
						onPress={handleSubmit}
						label={i18n.t("auth.btn_login")}
						disabled={isLoading}
						loading={isLoading}
						style={styles.loginButton}
					/> */}

			{/* Divider */}
			{/* <View style={styles.divider}>
						<View style={styles.dividerLine} />
						<Text style={styles.dividerText}>{i18n.t("auth.divider_or")}</Text>
						<View style={styles.dividerLine} />
					</View> */}

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
			{/* </View> */}

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

			<OtpModalComponent>
				{({ close }) => (
					<OtpModal
						onClose={() => {
							close();
							setPhone("");
						}}
						phone={phone}
					/>
				)}
			</OtpModalComponent>

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
	header: {
		alignItems: "center",
		marginBottom: 32,
	},
	title: {
		fontSize: 28,
		fontWeight: "700",
		color: "#1A1A1A",
		textAlign: "center",
	},
	form: {
		flex: 1,
	},
	inputContainer: {
		marginBottom: 20,
	},
	label: {
		fontSize: 16,
		fontWeight: "600",
		color: "#1A1A1A",
		marginBottom: 8,
	},
	inputWrapper: {
		flexDirection: "row",
		alignItems: "center",
		borderWidth: 1,
		borderColor: "#D1D5DB",
		borderRadius: 12,
		paddingHorizontal: 16,
		backgroundColor: "#F9FAFB",
	},
	inputError: {
		borderColor: "#EF4444",
	},
	inputIcon: {
		marginRight: 12,
	},
	input: {
		flex: 1,
		fontSize: 16,
		color: "#1A1A1A",
		paddingVertical: 16,
	},
	errorText: {
		fontSize: 14,
		color: "#EF4444",
		marginTop: 4,
	},
	hint: {
		fontSize: 14,
		color: "#6B7280",
		textAlign: "center",
		marginBottom: 24,
		lineHeight: 20,
	},
	loginButton: {
		marginBottom: 32,
	},
	divider: {
		flexDirection: "row",
		alignItems: "center",
		marginBottom: 24,
	},
	dividerLine: {
		flex: 1,
		height: 1,
		backgroundColor: "#C9C9C9",
	},
	dividerText: {
		fontSize: 14,
		color: "#6B7280",
		marginHorizontal: 16,
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
