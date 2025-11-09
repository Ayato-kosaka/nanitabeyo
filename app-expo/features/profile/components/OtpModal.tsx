/*
責務:
- 6桁OTPの入力・検証を行うモーダルUIを提供する。
- 入力欄の自動フォーカス移動/貼り付け分配/削除時の戻りフォーカスを制御する。
- 検証、onResend で再送要求をトリガーする。
- ローディング/再送中状態、i18n、アラート通知、キーボード回避を扱う。
*/

import React, { useState, useCallback, useRef, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";
import { useLogger } from "@/hooks/useLogger";
import { useAuth } from "@/contexts/AuthProvider";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useProfile } from "../hooks/useProfile";

interface OtpModalProps {
	onClose: () => void;
	phone: string;
}

export function OtpModal({ onClose, phone }: OtpModalProps) {
	const [otp, setOtp] = useState(["", "", "", "", "", ""]);
	const [isLoading, setIsLoading] = useState(false);
	const [isResending, setIsResending] = useState(false);
	const inputRefs = useRef<(TextInput | null)[]>([]);
	const [pendingDisplayName, setPendingDisplayName] = useState("");

	const { signInWithOtp, verifyOtp } = useAuth();
	const { createUserProfile } = useProfile();
	const { logFrontendEvent } = useLogger();
	const { showSnackbar } = useSnackbar();

	const handleOtpChange = useCallback(
		(value: string, index: number) => {
			// Only allow numbers
			const numericValue = value.replace(/[^0-9]/g, "");

			if (numericValue.length > 1) {
				// If multiple characters are pasted, split them across inputs
				const digits = numericValue.slice(0, 6).split("");
				const newOtp = [...otp];

				digits.forEach((digit, i) => {
					if (index + i < 6) {
						newOtp[index + i] = digit;
					}
				});

				setOtp(newOtp);

				// Focus on the next available input or the last one
				const nextIndex = Math.min(index + digits.length, 5);
				inputRefs.current[nextIndex]?.focus();
			} else {
				// Single character input
				const newOtp = [...otp];
				newOtp[index] = numericValue;
				setOtp(newOtp);

				// Auto-focus next input if digit was entered
				if (numericValue && index < 5) {
					inputRefs.current[index + 1]?.focus();
				}
			}
		},
		[otp],
	);

	const handleKeyPress = useCallback(
		(key: string, index: number) => {
			if (key === "Backspace" && !otp[index] && index > 0) {
				// Focus previous input on backspace if current is empty
				inputRefs.current[index - 1]?.focus();
			}
		},
		[otp],
	);

	const handleVerify = useCallback(async () => {
		const otpString = otp.join("");

		if (otpString.length !== 6) {
			showSnackbar(i18n.t("auth.otp_enter_all_digits"));
			return;
		}

		setIsLoading(true);
		try {
			try {
				await verifyOtp(phone, otpString);

				// Create user profile if display name was provided
				if (pendingDisplayName) {
					await createUserProfile({ displayName: pendingDisplayName });
				}

				onClose();
				setPendingDisplayName("");

				logFrontendEvent({
					event_name: "authentication_success",
					error_level: "log",
					payload: { phone, method: "sms" },
				});

				showSnackbar(i18n.t("auth.login_success"));
			} catch (error) {
				logFrontendEvent({
					event_name: "otp_verify_error",
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
	}, [otp, phone, verifyOtp, logFrontendEvent, onClose, pendingDisplayName, createUserProfile, showSnackbar]);

	const handleResend = useCallback(async () => {
		setIsResending(true);
		try {
			try {
				await signInWithOtp(phone);

				logFrontendEvent({
					event_name: "otp_resent",
					error_level: "log",
					payload: { phone },
				});
			} catch (error) {
				logFrontendEvent({
					event_name: "otp_resend_error",
					error_level: "error",
					payload: { phone, error: (error as Error).message },
				});
				throw error;
			}
			// Clear current OTP inputs
			setOtp(["", "", "", "", "", ""]);
			// Focus first input
			inputRefs.current[0]?.focus();
		} catch (error: unknown) {
			showSnackbar(i18n.t("Common.error"));
		} finally {
			setIsResending(false);
		}
	}, [logFrontendEvent, phone, showSnackbar, signInWithOtp]);

	// Auto-verify when all digits are entered
	useEffect(() => {
		const otpString = otp.join("");
		if (otpString.length === 6 && !isLoading) {
			handleVerify();
		}
	}, [otp, isLoading, handleVerify]);

	return (
		<KeyboardAvoidingView
			behavior={Platform.OS === "ios" ? "padding" : "height"}
			style={styles.container}
			keyboardVerticalOffset={Platform.OS === "ios" ? 100 : 0}>
			<View style={styles.content}>
				<View style={styles.header}>
					<Text style={styles.title}>{i18n.t("auth.otp_title")}</Text>
					<Text style={styles.subtitle}>
						{i18n.t("auth.hint_sms")} {"\n"}
						<Text style={styles.phoneNumber}>{phone}</Text>
					</Text>
				</View>

				<View style={styles.form}>
					{/* OTP Input */}
					<View style={styles.otpContainer}>
						{otp.map((digit, index) => (
							<TextInput
								key={index}
								ref={(ref) => {
									inputRefs.current[index] = ref;
								}}
								style={[styles.otpInput, digit && styles.otpInputFilled]}
								value={digit}
								onChangeText={(value) => handleOtpChange(value, index)}
								onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, index)}
								maxLength={1}
								keyboardType="number-pad"
								textContentType="oneTimeCode"
								selectTextOnFocus
								editable={!isLoading}
							/>
						))}
					</View>

					{/* Verify Button */}
					<PrimaryButton
						onPress={handleVerify}
						label={i18n.t("auth.btn_login")}
						disabled={isLoading || otp.join("").length !== 6}
						loading={isLoading}
						style={styles.verifyButton}
					/>

					{/* Resend Button */}
					<TouchableOpacity onPress={handleResend} disabled={isResending || isLoading} style={styles.resendButton}>
						<Text style={[styles.resendText, (isResending || isLoading) && styles.resendTextDisabled]}>
							{isResending ? i18n.t("Common.processing") : i18n.t("auth.otp_send_again")}
						</Text>
					</TouchableOpacity>
				</View>
			</View>
		</KeyboardAvoidingView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	content: {
		flex: 1,
		paddingHorizontal: 24,
		paddingVertical: 32,
	},
	header: {
		alignItems: "center",
		marginBottom: 48,
	},
	title: {
		fontSize: 28,
		fontWeight: "700",
		color: "#1A1A1A",
		textAlign: "center",
		marginBottom: 16,
	},
	subtitle: {
		fontSize: 16,
		color: "#6B7280",
		textAlign: "center",
		lineHeight: 24,
	},
	phoneNumber: {
		fontWeight: "600",
		color: "#1A1A1A",
	},
	form: {
		flex: 1,
		justifyContent: "center",
	},
	otpContainer: {
		flexDirection: "row",
		justifyContent: "space-between",
		marginBottom: 32,
		paddingHorizontal: 16,
	},
	otpInput: {
		width: 48,
		height: 56,
		borderWidth: 2,
		borderColor: "#D1D5DB",
		borderRadius: 12,
		textAlign: "center",
		fontSize: 24,
		fontWeight: "600",
		color: "#1A1A1A",
		backgroundColor: "#F9FAFB",
	},
	otpInputFilled: {
		borderColor: "#5EA2FF",
		backgroundColor: "#EFF6FF",
	},
	verifyButton: {
		marginBottom: 24,
	},
	resendButton: {
		alignItems: "center",
		paddingVertical: 12,
	},
	resendText: {
		fontSize: 16,
		fontWeight: "600",
		color: "#5EA2FF",
	},
	resendTextDisabled: {
		color: "#9CA3AF",
	},
});
