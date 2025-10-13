/*
このファイルの責務
- Supabase の OAuth 認証コールバックを処理する画面。
- Deep Link / Web リダイレクトで遷移してきた URL を解析し、セッション確立後に必要であればユーザープロフィールを作成し、プロフィールタブへ遷移する。
- 処理中はスピナーのみを表示し、ユーザー操作は不要。

Web 専用フォールバックについて
- Web 向けのフォールバック（リダイレクト受け口）として機能します。
- ネイティブ（iOS/Android）では Linking のリスナーによって処理されますが、Web ではこのルートが認証プロバイダからの戻り先になります。

補足
- 初期 URL は Linking.getInitialURL()（expo-router からの遷移でも保持）で取得します。
- 成功/失敗をフロントエンドログに記録し、いずれの場合も /(tabs)/profile に遷移します。
*/
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
	const { createUserProfile, handleOAuthResultUrl } = useAuth();
	const { logFrontendEvent } = useLogger();

	useEffect(() => {
		const handleAuthCallback = async () => {
			try {
				// 初回URL（フラグメント含む）を取得
				const initialUrl = await Linking.getInitialURL();
				const url = initialUrl ?? ""; // expo-routerで遷移してきた場合も getInitialURL が持っています

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

				router.replace("/(tabs)/profile");
				return;
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
	}, [router, logFrontendEvent]);

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
