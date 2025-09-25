/*
責務:
- 電話番号によるログイン用モーダルUIを提供する。
- E.164形式での電話番号入力とバリデーションを行う。
- OTP送信を開始し、onOAuthSignIn で各種OAuthサインインをトリガーする。
- ローディング/エラー状態、i18n、キーボード回避、アラート通知を扱う。
*/
import React, { useState, useCallback } from "react";
import {
	View,
	Text,
	TextInput,
	TouchableOpacity,
	StyleSheet,
	KeyboardAvoidingView,
	Platform,
	ScrollView,
	Alert,
} from "react-native";
import { User, Mail, Phone } from "lucide-react-native";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";
import { useLogger } from "@/hooks/useLogger";
import { useAuth } from "@/contexts/AuthProvider";
import { useBlurModal } from "@/hooks/useBlurModal";
import { OtpModal } from "./OtpModal";

interface LoginbackModalProps {
	onClose: () => void;
}

export function LoginbackModal({ onClose }: LoginbackModalProps) {
	const [phone, setPhone] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [errors, setErrors] = useState<{ phone?: string }>({});

	const { signInWithOAuth, signInWithOtp, linkIdentity, user } = useAuth();
	const { BlurModal: OtpModalComponent, open: openOtpModal, close: closeOtpModal } = useBlurModal({ intensity: 100 });
	const { logFrontendEvent } = useLogger();

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
				onClose();
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
		} catch (error: any) {
			Alert.alert(i18n.t("Common.error"), error.message);
		} finally {
			setIsLoading(false);
		}
	}, [phone, validatePhone, logFrontendEvent]);

	const handleOAuthSignIn = useCallback(
		async (provider: "google" | "facebook" | "twitter" | "apple") => {
			setIsLoading(true);
			try {
				try {
					// Check if user is anonymous and try to link identity first
					const isAnonymous = user?.is_anonymous;

					if (isAnonymous) {
						await linkIdentity(provider);
					} else {
						await signInWithOAuth(provider);
					}

					logFrontendEvent({
						event_name: "oauth_signin_success",
						error_level: "log",
						payload: { provider, isUpgrade: isAnonymous },
					});
				} catch (error) {
					// If linking fails, try regular OAuth sign in
					if (user?.is_anonymous) {
						try {
							await signInWithOAuth(provider);
							logFrontendEvent({
								event_name: "oauth_signin_fallback_success",
								error_level: "log",
								payload: { provider },
							});
						} catch (fallbackError) {
							logFrontendEvent({
								event_name: "oauth_signin_error",
								error_level: "error",
								payload: { provider, error: (fallbackError as Error).message },
							});
							throw fallbackError;
						}
					} else {
						logFrontendEvent({
							event_name: "oauth_signin_error",
							error_level: "error",
							payload: { provider, error: (error as Error).message },
						});
						throw error;
					}
				}
			} catch (error: any) {
				Alert.alert(i18n.t("Common.error"), error.message);
			} finally {
				setIsLoading(false);
			}
		},
		[user, linkIdentity, signInWithOAuth, logFrontendEvent],
	);

	return (
		<View style={styles.container}>
			<View style={styles.header}>
				<Text style={styles.title}>{i18n.t("auth.login_title")}</Text>
			</View>

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

			{/* OAuth Buttons */}
			<View style={styles.oauthContainer}>
				<PrimaryButton
					label={i18n.t("auth.provider_google")}
					onPress={() => handleOAuthSignIn("google")}
					style={{ width: "100%" }}
					colors={["#ffffff", "#ffffff"]}
					shadowColor={"#000000"}
					labelStyle={{ color: "#1A1A1A" }}
					loading={isLoading}
				/>
				<PrimaryButton
					label={i18n.t("auth.provider_facebook")}
					onPress={() => handleOAuthSignIn("facebook")}
					style={{ width: "100%" }}
					colors={["#ffffff", "#ffffff"]}
					shadowColor={"#000000"}
					labelStyle={{ color: "#1A1A1A" }}
					loading={isLoading}
				/>
				<PrimaryButton
					label={i18n.t("auth.provider_twitter")}
					onPress={() => handleOAuthSignIn("twitter")}
					style={{ width: "100%" }}
					colors={["#ffffff", "#ffffff"]}
					shadowColor={"#000000"}
					labelStyle={{ color: "#1A1A1A" }}
					loading={isLoading}
				/>
				<PrimaryButton
					label={i18n.t("auth.provider_apple")}
					onPress={() => handleOAuthSignIn("apple")}
					style={{ width: "100%" }}
					colors={["#ffffff", "#ffffff"]}
					shadowColor={"#000000"}
					labelStyle={{ color: "#1A1A1A" }}
					loading={isLoading}
				/>
			</View>
			{/* </View> */}

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
		backgroundColor: "#E5E7EB",
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
});
