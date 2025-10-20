/*
このファイルの責務
- Supabase の OAuth 認証コールバックを処理する画面。
- Deep Link / Web リダイレクトで遷移してきた URL を解析し、セッション確立後に必要であればユーザープロフィールを作成し、プロフィールタブへ遷移する。
- linkIdentity の衝突時に警告ダイアログを表示し、ユーザーの確認後に切替/キャンセルを選択可能にする。
- 処理中はスピナーのみを表示し、ユーザー操作は不要（ダイアログ表示時を除く）。

Web 専用フォールバックについて
- Web 向けのフォールバック（リダイレクト受け口）として機能します。
- ネイティブ（iOS/Android）では Linking のリスナーによって処理されますが、Web ではこのルートが認証プロバイダからの戻り先になります。

補足
- 初期 URL は Linking.getInitialURL()（expo-router からの遷移でも保持）で取得します。
- 成功/失敗をフロントエンドログに記録し、いずれの場合も /(tabs)/profile に遷移します。
*/
import { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet, Linking, Modal, TouchableOpacity, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthProvider";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import { Provider } from "@supabase/supabase-js";
import * as AuthSession from "expo-auth-session";

/**
 * OAuth認証のコールバック画面
 * Deep Linkで呼び出され、認証完了後にホーム画面にリダイレクトする
 */
export default function AuthCallbackScreen() {
	const router = useRouter();
	const { createUserProfile, handleOAuthResultUrl, signInWithOAuth } = useAuth();
	const { logFrontendEvent } = useLogger();
	const { locale, ...rest } = useLocalSearchParams<{ locale: string; [k: string]: string }>();
	const [showConflictDialog, setShowConflictDialog] = useState(false);
	const [conflictProvider, setConflictProvider] = useState<Provider | null>(null);

	useEffect(() => {
		const handleAuthCallback = async () => {
			try {
				// 初回URL（フラグメント含む）を取得
				const initialUrl = await Linking.getInitialURL();
				const qs = new URLSearchParams(Object.entries(rest).map(([k, v]) => [k, String(v)])).toString();
				const redirectBase =
					Platform.OS === "web"
						? `${window.location.origin}/${locale}/auth/callback`
						: AuthSession.makeRedirectUri({ scheme: "nanitabeyo", path: `${locale}/auth/callback` });
				const url = initialUrl || `${redirectBase}?${qs}`; // expo-routerで遷移してきた場合も getInitialURL が持っています

				// URLから認証結果を処理
				await handleOAuthResultUrl(url);

				const {
					data: { user },
				} = await supabase.auth.getUser();

				logFrontendEvent({
					event_name: "oauth_callback_success",
					error_level: "log",
					payload: { user_id: user?.id, from: "setSession" },
				});

				// 必要ならプロフィール作成
				if (user) {
					await createUserProfile({
						displayName: user.user_metadata?.name ?? user.identities?.[0]?.identity_data?.name,
						avatar: user.user_metadata?.avatar_url ?? user.identities?.[0]?.identity_data?.avatar_url,
					});
				}

				router.replace({ pathname: "/[locale]/profile", params: { locale } });
				return;
			} catch (error: unknown) {
				// linkIdentity による identity_already_exists エラーの場合は警告ダイアログを表示
				const err = error as any;
				if (err?.error_code === "identity_already_exists" && err?.intent === "link" && err?.provider) {
					logFrontendEvent({
						event_name: "oauth_link_conflict",
						error_level: "warn",
						payload: { provider: err.provider, error_code: err.error_code },
					});
					setConflictProvider(err.provider);
					setShowConflictDialog(true);
					return;
				}

				logFrontendEvent({
					event_name: "oauth_callback_error",
					error_level: "error",
					payload: { error: error instanceof Error ? error.message : String(error) },
				});

				// エラーの場合もプロフィール画面に戻る
				router.replace("/(tabs)/profile");
			}
		};

		handleAuthCallback();
	}, [router, logFrontendEvent]);

	const handleSwitchToExisting = async () => {
		if (!conflictProvider) return;

		setShowConflictDialog(false);

		try {
			logFrontendEvent({
				event_name: "oauth_conflict_switch_existing",
				error_level: "log",
				payload: { provider: conflictProvider },
			});

			// 既存アカウントに切り替え（prompt=none でサイレント認証）
			await signInWithOAuth(conflictProvider);
		} catch (error) {
			logFrontendEvent({
				event_name: "oauth_conflict_switch_error",
				error_level: "error",
				payload: { provider: conflictProvider, error: (error as Error).message },
			});
			router.replace("/(tabs)/profile");
		}
	};

	const handleCancelSwitch = () => {
		logFrontendEvent({
			event_name: "oauth_conflict_cancel",
			error_level: "log",
			payload: { provider: conflictProvider },
		});

		setShowConflictDialog(false);
		router.replace("/(tabs)/profile");
	};

	return (
		<View style={styles.container}>
			<ActivityIndicator size="large" color="#5EA2FF" />
			<Text style={styles.text}>{i18n.t("Common.processing")}</Text>

			{/* Conflict Warning Dialog */}
			<Modal visible={showConflictDialog} transparent animationType="fade">
				<View style={styles.modalOverlay}>
					<View style={styles.dialogContainer}>
						<Text style={styles.dialogTitle}>{i18n.t("auth.conflict_dialog_title")}</Text>
						<Text style={styles.dialogMessage}>{i18n.t("auth.conflict_dialog_message")}</Text>
						<View style={styles.dialogButtons}>
							<TouchableOpacity style={styles.secondaryButton} onPress={handleCancelSwitch}>
								<Text style={styles.secondaryButtonText}>{i18n.t("auth.conflict_dialog_cancel")}</Text>
							</TouchableOpacity>
							<TouchableOpacity style={styles.primaryButton} onPress={handleSwitchToExisting}>
								<Text style={styles.primaryButtonText}>{i18n.t("auth.conflict_dialog_switch")}</Text>
							</TouchableOpacity>
						</View>
					</View>
				</View>
			</Modal>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		backgroundColor: "#FFFFFF",
		paddingHorizontal: 24,
	},
	text: {
		marginTop: 16,
		fontSize: 16,
		color: "#6B7280",
		textAlign: "center",
	},
	modalOverlay: {
		flex: 1,
		backgroundColor: "rgba(0, 0, 0, 0.5)",
		justifyContent: "center",
		alignItems: "center",
		paddingHorizontal: 24,
	},
	dialogContainer: {
		backgroundColor: "#FFFFFF",
		borderRadius: 16,
		padding: 24,
		width: "100%",
		maxWidth: 400,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.1,
		shadowRadius: 8,
		elevation: 5,
	},
	dialogTitle: {
		fontSize: 20,
		fontWeight: "700",
		color: "#1A1A1A",
		marginBottom: 12,
		textAlign: "center",
	},
	dialogMessage: {
		fontSize: 16,
		color: "#6B7280",
		lineHeight: 24,
		marginBottom: 24,
		textAlign: "center",
	},
	dialogButtons: {
		flexDirection: "row",
		gap: 12,
	},
	primaryButton: {
		flex: 1,
		backgroundColor: "#5EA2FF",
		paddingVertical: 14,
		borderRadius: 12,
		alignItems: "center",
	},
	primaryButtonText: {
		fontSize: 16,
		fontWeight: "600",
		color: "#FFFFFF",
	},
	secondaryButton: {
		flex: 1,
		backgroundColor: "#F3F4F6",
		paddingVertical: 14,
		borderRadius: 12,
		alignItems: "center",
	},
	secondaryButtonText: {
		fontSize: 16,
		fontWeight: "600",
		color: "#6B7280",
	},
});
