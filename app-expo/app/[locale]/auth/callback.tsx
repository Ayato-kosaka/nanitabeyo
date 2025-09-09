import { useEffect } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
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
				// セッション状態を確認
				const { data: { session }, error } = await supabase.auth.getSession();
				
				if (error) {
					logFrontendEvent({
						event_name: "oauth_callback_error",
						error_level: "error",
						payload: { error: error.message }
					});
					throw error;
				}

				if (session?.user) {
					// ユーザープロフィールを作成（存在しなければ）
					await createUserProfile();
					
					logFrontendEvent({
						event_name: "oauth_callback_success",
						error_level: "log",
						payload: { user_id: session.user.id }
					});

					// プロフィール画面にリダイレクト
					router.replace("/(tabs)/profile");
				} else {
					// セッションがない場合もプロフィール画面に戻る
					router.replace("/(tabs)/profile");
				}
			} catch (error) {
				logFrontendEvent({
					event_name: "oauth_callback_error",
					error_level: "error",
					payload: { error: (error as Error).message }
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