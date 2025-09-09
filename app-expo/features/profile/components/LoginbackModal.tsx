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

interface LoginbackModalProps {
	onClose: () => void;
	onSubmit: (data: { phone: string }) => Promise<void>;
	onOAuthSignIn: (provider: "google" | "facebook" | "twitter" | "apple") => Promise<void>;
}

export function LoginbackModal({ onClose, onSubmit, onOAuthSignIn }: LoginbackModalProps) {
	const [phone, setPhone] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [errors, setErrors] = useState<{ phone?: string }>({});

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
			await onSubmit({ phone: phone.trim() });
		} catch (error: any) {
			Alert.alert(i18n.t("Common.error"), error.message);
		} finally {
			setIsLoading(false);
		}
	}, [phone, validatePhone, onSubmit]);

	const handleOAuthSignIn = useCallback(
		async (provider: "google" | "facebook" | "twitter" | "apple") => {
			setIsLoading(true);
			try {
				await onOAuthSignIn(provider);
			} catch (error: any) {
				Alert.alert(i18n.t("Common.error"), error.message);
			} finally {
				setIsLoading(false);
			}
		},
		[onOAuthSignIn],
	);

	return (
		<KeyboardAvoidingView
			behavior={Platform.OS === "ios" ? "padding" : "height"}
			style={styles.container}
			keyboardVerticalOffset={Platform.OS === "ios" ? 100 : 0}>
			<ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
				<View style={styles.header}>
					<Text style={styles.title}>{i18n.t("auth.login_title")}</Text>
				</View>

				<View style={styles.form}>
					{/* Phone Input */}
					<View style={styles.inputContainer}>
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
					</View>

					{/* SMS Hint */}
					<Text style={styles.hint}>{i18n.t("auth.hint_sms")}</Text>

					{/* Login Button */}
					<PrimaryButton
						onPress={handleSubmit}
						label={i18n.t("auth.btn_login")}
						disabled={isLoading}
						loading={isLoading}
						style={styles.loginButton}
					/>

					{/* Divider */}
					<View style={styles.divider}>
						<View style={styles.dividerLine} />
						<Text style={styles.dividerText}>{i18n.t("auth.divider_or")}</Text>
						<View style={styles.dividerLine} />
					</View>

					{/* OAuth Buttons */}
					<View style={styles.oauthContainer}>
						<TouchableOpacity
							style={styles.oauthButton}
							onPress={() => handleOAuthSignIn("google")}
							disabled={isLoading}>
							<Text style={styles.oauthButtonText}>{i18n.t("auth.provider_google")}</Text>
						</TouchableOpacity>
						<TouchableOpacity
							style={styles.oauthButton}
							onPress={() => handleOAuthSignIn("facebook")}
							disabled={isLoading}>
							<Text style={styles.oauthButtonText}>{i18n.t("auth.provider_facebook")}</Text>
						</TouchableOpacity>
						<TouchableOpacity
							style={styles.oauthButton}
							onPress={() => handleOAuthSignIn("twitter")}
							disabled={isLoading}>
							<Text style={styles.oauthButtonText}>{i18n.t("auth.provider_twitter")}</Text>
						</TouchableOpacity>
						<TouchableOpacity
							style={styles.oauthButton}
							onPress={() => handleOAuthSignIn("apple")}
							disabled={isLoading}>
							<Text style={styles.oauthButtonText}>{i18n.t("auth.provider_apple")}</Text>
						</TouchableOpacity>
					</View>
				</View>
			</ScrollView>
		</KeyboardAvoidingView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	scrollContent: {
		flexGrow: 1,
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
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 12,
		justifyContent: "center",
	},
	oauthButton: {
		minWidth: 120,
		paddingVertical: 12,
		paddingHorizontal: 20,
		borderRadius: 12,
		borderWidth: 1,
		borderColor: "#D1D5DB",
		backgroundColor: "#FFFFFF",
		alignItems: "center",
	},
	oauthButtonText: {
		fontSize: 14,
		fontWeight: "600",
		color: "#1A1A1A",
	},
});