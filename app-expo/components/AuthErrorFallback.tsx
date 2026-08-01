import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";

// #1089 【設計】匿名サインインが失敗すると user が null のまま固定され、SplashHandler が
// 何も描画しない（web は薄グレーの空画面、native はスプラッシュ固着）状態になっていた。
// 「失敗したこと」と「再試行できること」をユーザーへ伝える最小の画面をここで用意する。
// 見た目・文言の作りは components/ErrorBoundary.tsx（#940）に合わせてある。

export interface AuthErrorFallbackProps {
	/** Supabase のレート制限(429)由来か。文言を「時間をおいて」に切り替える */
	isRateLimited: boolean;
	/** 再試行の実行中（429 のクールダウン待ちを含む）。ボタンをローディング表示にする */
	isRetrying: boolean;
	/** 再試行ボタン押下時のコールバック */
	onRetry: () => void;
}

export const AuthErrorFallback = ({ isRateLimited, isRetrying, onRetry }: AuthErrorFallbackProps) => {
	return (
		<View style={styles.container} testID="auth-error-fallback">
			<View style={styles.card}>
				<Text style={styles.text}>
					{i18n.t(isRateLimited ? "Common.errors.authRateLimited" : "Common.errors.authUnavailable")}
				</Text>
				<PrimaryButton
					style={styles.button}
					label={i18n.t("Common.retry")}
					loading={isRetrying}
					onPress={onRetry}
					testID="auth-error-retry"
				/>
			</View>
		</View>
	);
};

const styles = StyleSheet.create({
	container: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		padding: 16,
		backgroundColor: "#FFFFFF",
	},
	card: {
		backgroundColor: "#FFFFFF",
		borderRadius: 20,
		padding: 32,
		alignItems: "center",
		justifyContent: "center",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.08,
		shadowRadius: 16,
		elevation: 4,
	},
	text: {
		fontSize: 16,
		color: "#6B7280",
		textAlign: "center",
	},
	button: {
		marginTop: 16,
	},
});
