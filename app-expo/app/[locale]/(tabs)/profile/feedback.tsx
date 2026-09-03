import React, { useCallback } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { ScreenHeader } from "@/components/ScreenHeader";
import { FeedbackForm } from "@/features/profile/components/FeedbackForm";
import i18n from "@/lib/i18n";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useAppTheme } from "@/contexts/ThemeProvider";

/**
 * #951 【設計】ご意見・不具合(フィードバック)画面。
 *
 * 以前は設定画面内の useBlurModal で表示していたが、レビューで
 * 「#949 で統一した ScreenHeader の戻る導線に合わせたい・モーダル自体をやめたい」と
 * 指摘を受け、settings / blocked-dish-categories と同じ「Stack に push される通常画面 +
 * ScreenHeader で戻る」構成へ変更した。フォームの状態管理・送信は
 * FeedbackForm(既存)に委譲し、この画面は導線と完了時の遷移だけを担う。
 */
export default function FeedbackScreen() {
	const { lightImpact } = useHaptics();
	const { showSnackbar } = useSnackbar();
	const { logFrontendEvent } = useLogger();
	// #1629 オーナー実機報告「ご意見・不具合を送る画面もダークモードに対応してない」。
	// 画面の地がライト固定のグラデーション直書きだったので、テーマのトークンへ移した
	const { colors } = useAppTheme();

	const handleBack = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "feedback_screen_back_pressed",
			error_level: "log",
			payload: {},
		});
		router.back();
	}, [lightImpact, logFrontendEvent]);

	// 送信成功時: スナックバーで完了を伝え、設定画面へ戻る
	const handleSubmit = useCallback(() => {
		showSnackbar(i18n.t("Feedback.success.submitted"));
		router.back();
	}, [showSnackbar]);

	return (
		<LinearGradient colors={colors.backgroundGradient} style={styles.container}>
			<SafeAreaView style={styles.safeArea} edges={[]}>
				<ScreenHeader title={i18n.t("Feedback.title")} onPressBack={handleBack} />
				{/* モーダル時代は useBlurModal が担っていたキーボード回避を画面側で行う */}
				{/* #1629 Android にも behavior を渡す（undefined だと Android で 1px も動かない）。
				    理由は add-record.tsx の同じ箇所のコメントを参照 */}
				<KeyboardAvoidingView
					style={styles.keyboardAvoiding}
					behavior={Platform.select({ ios: "padding", android: "height" })}>
					<ScrollView
						style={styles.scrollView}
						contentContainerStyle={styles.scrollContent}
						keyboardShouldPersistTaps="handled">
						<FeedbackForm onSubmit={handleSubmit} onCancel={handleBack} />
					</ScrollView>
				</KeyboardAvoidingView>
			</SafeAreaView>
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	safeArea: {
		flex: 1,
	},
	keyboardAvoiding: {
		flex: 1,
	},
	scrollView: {
		flex: 1,
	},
	scrollContent: {
		paddingVertical: 16,
		paddingBottom: 40,
	},
});
