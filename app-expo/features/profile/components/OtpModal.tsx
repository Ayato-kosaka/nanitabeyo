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
	/**
	 * #1205 【修正】OTP 検証の多重実行を防ぐ同期ガード。
	 *
	 * `isLoading`（useState）は **ボタンを disabled にする表示用途**であって、多重実行の判定には使えない。
	 * React が再レンダリングをコミットする前に 2 発目（ボタン連打、あるいは下の自動発火 useEffect と
	 * ボタン押下の同フレーム衝突）が処理されると、両方が `isLoading === false` を読んで通過しうる。
	 * 通過すると `verifyOtp` が 2 回走り、2 発目は**消費済みの OTP** で失敗するため
	 * **ログイン成功直後にエラーが表示される**。加えて Supabase 側の認証レート制限を無駄に消費する。
	 *
	 * ref への代入は同期的に確定するため、同一 JS タスク内の連続呼び出しでもレースしない。
	 * ReviewForm.tsx の `isSubmittingRef` と同じ方式。
	 */
	const isVerifyingRef = useRef(false);
	/**
	 * #1205 【修正】OTP 再送の多重実行を防ぐ同期ガード。
	 *
	 * `isResending`（useState）は再送リンクの disabled 表示用で、上と同じ理由で判定には使えない。
	 * 通過すると `signInWithOtp` が 2 回走り、**SMS が 2 通送信されて実費が二重に掛かる**。
	 * さらに Supabase の `only request this after N seconds` に当たり、
	 * **以後の正規の再送まで拒否されて詰む**（ユーザーはログインできなくなる）。
	 */
	const isResendingRef = useRef(false);
	/**
	 * #1205 【設計】自動発火 useEffect が「同じ 6 桁」を再検証しないようにするための記録。
	 *
	 * `isVerifyingRef` だけでは自動再試行のループは止まらない。`handleVerify` の finally が
	 * `isVerifyingRef.current = false` と `setIsLoading(false)` を同時に行うので、
	 * その再レンダリングで effect が再実行されたときには **otp は 6 桁のまま・isLoading は false・
	 * ref も false** に戻っており、発火条件が再び真になるため。
	 *
	 * そこで「自動発火で投げた otp 文字列」を覚えておき、同じ文字列では二度と自動発火しない
	 * ＝**一度失敗した 6 桁は、入力を変えるか再送するまで自動再試行しない**という振る舞いを選ぶ。
	 * ref の書き換えが再レンダリングを起こさないことは問題にならない。この effect は
	 * `otp` / `isLoading` の変化で必ず再実行され、そのときに現在値を読むだけだから。
	 *
	 * 手動の復帰経路は塞がないこと（塞ぐと失敗後に詰む）：
	 * - 「ログイン」ボタンは `handleVerify` を直接呼ぶのでこの記録の影響を受けない（失敗後も押し直せる）
	 * - 「再送」は otp をクリアすると同時にこの記録もクリアする（`handleResend` 参照）
	 */
	const autoVerifiedOtpRef = useRef<string | null>(null);

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

		// #1205 多重実行の判定は ref で行う（useState の isLoading はレースが残る。宣言箇所のコメント参照）。
		// 6 桁チェックの early return より後に置くこと。バリデーションで抜ける経路で立ててしまうと解除されない
		if (isVerifyingRef.current) return;
		isVerifyingRef.current = true;

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
			// #1205 検証失敗後もユーザーが「ログイン」を押し直せるよう、成功・失敗・例外のいずれでも必ず解除する。
			// try 側の各 return 直前に散らすと解除漏れ（＝二度と検証できない）を作るので、解除はこの 1 箇所だけ
			isVerifyingRef.current = false;
			setIsLoading(false);
		}
	}, [otp, phone, verifyOtp, logFrontendEvent, onClose, pendingDisplayName, createUserProfile, showSnackbar]);

	const handleResend = useCallback(async () => {
		// #1205 多重実行の判定は ref で行う（useState の isResending はレースが残る。宣言箇所のコメント参照）。
		// ここより後に再送処理を書くこと
		if (isResendingRef.current) return;
		isResendingRef.current = true;

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
			// #1205 新しいコードが届く以上、自動発火の抑止記録も捨てる。
			// 残しておくと「前と同じ 6 桁を再入力したときだけ自動検証されない」という説明のつかない挙動になる
			autoVerifiedOtpRef.current = null;
			// Focus first input
			inputRefs.current[0]?.focus();
		} catch (error: unknown) {
			showSnackbar(i18n.t("Common.error"));
		} finally {
			// #1205 再送が失敗しても押し直せるよう、成功・失敗・例外のいずれでも必ず解除する
			isResendingRef.current = false;
			setIsResending(false);
		}
	}, [logFrontendEvent, phone, showSnackbar, signInWithOtp]);

	// Auto-verify when all digits are entered
	useEffect(() => {
		const otpString = otp.join("");
		if (otpString.length !== 6) return;
		// #1205 検証中は自動発火しない。`isLoading` だけだと、setIsLoading(true) がコミットされる前に
		// otp の変化でこの effect が走った場合に素通りするため、同期ガードも併せて見る
		if (isLoading || isVerifyingRef.current) return;
		// #1205 同じ 6 桁を自動で投げ直さない（宣言箇所のコメント参照）。
		// これが無いと、finally の setIsLoading(false) による再レンダリングで発火条件が再び真になり、
		// 検証失敗時に自動再試行が止まらない
		if (autoVerifiedOtpRef.current === otpString) return;
		autoVerifiedOtpRef.current = otpString;
		handleVerify();
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
							{isResending ? i18n.t("auth.otp_resending") : i18n.t("auth.otp_send_again")}
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
		borderColor: "#F05537",
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
		color: "#F05537",
	},
	resendTextDisabled: {
		color: "#9CA3AF",
	},
});
