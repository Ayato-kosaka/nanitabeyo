import { useEffect } from "react";
import { View, Text, ActivityIndicator, StyleSheet, Linking } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthProvider";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";

/**
 * OAuth認証のコールバック画面
 * Deep Linkで呼び出され、認証完了後にホーム画面にリダイレクトする
 */
export default function AuthCallbackScreen() {
	const router = useRouter();
	const { createUserProfile } = useAuth();
	const { logFrontendEvent } = useLogger();

	useEffect(() => {
		const handleAuthCallback = async () => {
			try {
				// 1) 初回URL（フラグメント含む）を取得
				const initialUrl = await Linking.getInitialURL();
				const url = initialUrl ?? ""; // expo-routerで遷移してきた場合も getInitialURL が持っています

				// 2) フラグメント(#...)をパースしてアクセストークン類を取得
				const hash = url.split("#")[1] ?? "";
				const params = new URLSearchParams(hash);
				const access_token = params.get("access_token");
				const refresh_token = params.get("refresh_token");
				const expires_at = params.get("expires_at");

				if (access_token && refresh_token) {
					// 3) セッションを Supabase にセット（ここで匿名→本ユーザーへ切替）
					await supabase.auth.setSession({
						access_token,
						refresh_token,
					});

					// 4) 念のためユーザーを取得してログを出す
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
						await createUserProfile(user.user_metadata?.name);
					}

					router.replace("/(tabs)/profile");
					return;
				}

				// 5) もし # に access_token が無い場合（コードフローなど）は fallback:
				//    ここでは getSession() を確認（既に別所で exchange 済みのケース）
				const {
					data: { session },
					error,
				} = await supabase.auth.getSession();
				if (error) throw error;

				if (session?.user) {
					await createUserProfile(session.user.user_metadata?.name);
					router.replace("/(tabs)/profile");
				} else {
					router.replace("/(tabs)/profile");
				}
			} catch (error) {
				logFrontendEvent({
					event_name: "oauth_callback_error",
					error_level: "error",
					payload: { error: (error as Error).message },
				});

				// エラーの場合もプロフィール画面に戻る
				router.replace("/(tabs)/profile");
			}
		};

		handleAuthCallback();
	}, [router, createUserProfile, logFrontendEvent]);

	return (
		<View style={styles.container}>
			<ActivityIndicator size="large" color="#5EA2FF" />
			<Text style={styles.text}>{i18n.t("Common.processing")}</Text>
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
});
