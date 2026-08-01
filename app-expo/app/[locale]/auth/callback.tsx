/*
このファイルの責務
- Supabase の OAuth 認証コールバックを処理する画面。
- Deep Link / Web リダイレクトで遷移してきた URL を解析し、セッション確立後に必要であればユーザープロフィールを作成し、プロフィールタブへ遷移する。
- linkIdentity の衝突時に警告ダイアログを表示し、ユーザーの確認後に切替/キャンセルを選択可能にする。
- 処理中はスピナーのみを表示し、ユーザー操作は不要（ダイアログ表示時を除く）。

認証結果 URL の選び方について（#1062）
- ネイティブでは expo-router のパラメータ（signInWithOAuth の router.replace / OS のディープリンク）で、
  Web では現在の URL として、認証結果が届きます。
- どちらを使うかは「出所の優先順位」ではなく「認証結果を実際に含んでいるか」で決めます（lib/oauthResultUrl.ts）。
  Android の development build を QR 起動すると Linking.getInitialURL() が dev launcher の起動 URL を
  返し続けるため、出所で優先すると code を取り落とします（実機で QR 起動＝失敗 / アイコン起動＝成功 を確認）。

補足
- セッションを確立できなかった場合は oauth_callback_no_result を error レベルで記録し、
  成功ログもプロフィール作成も行いません。いずれの場合も /[locale]/profile に遷移します。
*/
import { useEffect, useRef, useState } from "react";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { View, Text, StyleSheet, Linking, TouchableOpacity } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthProvider";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import { Provider } from "@supabase/supabase-js";
import { useProfile } from "@/features/profile/hooks/useProfile";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { Card } from "@/components/Card";
import { describeOAuthUrl, pickOAuthResultUrl, type OAuthUrlCandidate } from "@/lib/oauthResultUrl";

/**
 * router のパラメータを URL の形に載せるための器。
 * #1062 【設計】クエリしか読まないため、ホスト部分に意味は無い。
 * 以前はここで Platform 分岐と AuthSession.makeRedirectUri による再構築を行っていたが、
 * 認証結果の判定に redirect URI の正確な復元は不要なので廃止した。
 */
const ROUTER_PARAM_URL_BASE = "nanitabeyo://oauth-result";

/**
 * OAuth認証のコールバック画面
 * Deep Linkで呼び出され、認証完了後にホーム画面にリダイレクトする
 */
export default function AuthCallbackScreen() {
	const router = useRouter();
	const { handleOAuthResultUrl, signInWithOAuth } = useAuth();
	const { createUserProfile } = useProfile();
	const { logFrontendEvent } = useLogger();
	const { locale, ...rest } = useLocalSearchParams<{ locale: string; [k: string]: string }>();
	const { BlurModal: ConflictModal, open: openConflictModal, close: closeConflictModal } = useBlurModal();
	const [conflictProvider, setConflictProvider] = useState<Provider | null>(null);

	// 同じ code を二度交換しないためのラッチ（effect が再実行されても処理は一度きり）
	const hasHandledRef = useRef(false);

	useEffect(() => {
		if (hasHandledRef.current) return;
		hasHandledRef.current = true;

		const handleAuthCallback = async () => {
			const qs = new URLSearchParams(Object.entries(rest).map(([k, v]) => [k, String(v)])).toString();
			// 初回URL（フラグメント含む）。Web では現在の URL、ネイティブでは起動時の URL。
			const initialUrl = await Linking.getInitialURL();

			// #1062 【設計】出所の順序ではなく「認証結果を実際に含むか」で選ぶ。
			// router_params を先に置くのは、これが最も新しい結果だから（順序は保険で、正しさは順序に依存しない）。
			const candidates: OAuthUrlCandidate[] = [
				{ source: "router_params", url: qs ? `${ROUTER_PARAM_URL_BASE}?${qs}` : null },
				{ source: "initial_url", url: initialUrl },
			];
			const picked = pickOAuthResultUrl(candidates);

			const goToProfile = () => router.replace({ pathname: "/[locale]/profile", params: { locale } });

			if (!picked) {
				// ここが従来の「無言の失敗」の出口。成功ログもプロフィール作成も行わない。
				logFrontendEvent({
					event_name: "oauth_callback_no_result",
					error_level: "error",
					payload: {
						intent: rest.intent ?? null,
						provider: rest.provider ?? null,
						candidates: candidates.map((candidate) => ({
							source: candidate.source,
							...(describeOAuthUrl(candidate.url) ?? {}),
						})),
					},
				});
				goToProfile();
				return;
			}

			try {
				const result = await handleOAuthResultUrl(picked.url);

				if (result.status !== "authenticated") {
					logFrontendEvent({
						event_name: "oauth_callback_no_result",
						error_level: "error",
						payload: {
							intent: rest.intent ?? null,
							provider: rest.provider ?? null,
							source: picked.source,
							url_shape: describeOAuthUrl(picked.url),
						},
					});
					goToProfile();
					return;
				}

				const { user, via } = result;

				logFrontendEvent({
					event_name: "oauth_callback_success",
					error_level: "log",
					payload: {
						user_id: user.id,
						is_anonymous: user.is_anonymous ?? null,
						via,
						source: picked.source,
						intent: rest.intent ?? null,
					},
				});

				// 必要ならプロフィール作成（セッションを確立できた場合のみ）
				await createUserProfile({
					displayName: user.user_metadata?.name ?? user.identities?.[0]?.identity_data?.name,
					avatar: user.user_metadata?.avatar_url ?? user.identities?.[0]?.identity_data?.avatar_url,
				});
				goToProfile();
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
					openConflictModal();
					return;
				} else {
					goToProfile();
				}

				logFrontendEvent({
					event_name: "oauth_callback_error",
					error_level: "error",
					payload: {
						error: error instanceof Error ? error.message : String(error),
						// #1062 【設計】生の URL は code / access_token を含むため記録しない
						source: picked.source,
						url_shape: describeOAuthUrl(picked.url),
					},
				});
			}
		};

		handleAuthCallback();
	}, [router, logFrontendEvent]);

	const handleSwitchToExisting = async () => {
		if (!conflictProvider) return;

		closeConflictModal();

		try {
			logFrontendEvent({
				event_name: "oauth_conflict_switch_existing",
				error_level: "log",
				payload: { provider: conflictProvider },
			});

			// 既存アカウントに切り替え（prompt=none でサイレント認証）
			const launch = await signInWithOAuth(conflictProvider);

			// #1062 【設計】ブラウザを閉じた場合はスピナー画面に貼り付いたままになるため、プロフィールへ戻す
			if (launch.outcome === "cancelled") {
				logFrontendEvent({
					event_name: "oauth_signin_cancelled",
					error_level: "log",
					payload: {
						provider: conflictProvider,
						browser_result_type: launch.browserResultType,
						context: "conflict_switch",
					},
				});
				router.replace({ pathname: "/[locale]/profile", params: { locale } });
			}
		} catch (error) {
			logFrontendEvent({
				event_name: "oauth_conflict_switch_error",
				error_level: "error",
				payload: { provider: conflictProvider, error: (error as Error).message },
			});
			router.replace({ pathname: "/[locale]/profile", params: { locale } });
		}
	};

	const handleCancelSwitch = () => {
		logFrontendEvent({
			event_name: "oauth_conflict_cancel",
			error_level: "log",
			payload: { provider: conflictProvider },
		});

		closeConflictModal();
		router.replace({ pathname: "/[locale]/profile", params: { locale } });
	};

	return (
		<View style={styles.container}>
			<LoadingIndicator size="large" />
			<Text style={styles.text}>{i18n.t("auth.callback_processing")}</Text>

			{/* Conflict Warning Dialog */}
			<ConflictModal>
				<Card>
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
				</Card>
			</ConflictModal>
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
		backgroundColor: "#F05537",
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
