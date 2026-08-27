import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";

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
	const styles = useThemedStyles(createStyles);

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

// #1509 【設計】`StyleSheet.create` はモジュール評価時に 1 度だけ走るためテーマを追従できない。
// パレットを受け取るファクトリにし、画面側で `useThemedStyles` から呼ぶ（`contexts/ThemeProvider.tsx`）。
const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			justifyContent: "center",
			alignItems: "center",
			padding: 16,
			backgroundColor: c.surface,
		},
		card: {
			backgroundColor: c.surface,
			borderRadius: 20,
			padding: 32,
			alignItems: "center",
			justifyContent: "center",
			// 影はテーマに依らず黒。暗面では実質見えないだけで、値としては黒のままでよい
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 0 },
			shadowOpacity: 0.08,
			shadowRadius: 16,
			elevation: 4,
		},
		text: {
			fontSize: 16,
			color: c.textSecondary,
			textAlign: "center",
		},
		button: {
			marginTop: 16,
		},
	});
