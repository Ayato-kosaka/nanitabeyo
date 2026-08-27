/*
料理提案（dish-categories）の取得失敗時に出す全画面エラー。

#1629 【修正】オーナー実機報告「料理提案画面自体がダークモードに対応してない」。
兄弟の DishCategoriesLoading.tsx と同じく、地・カード・文字がライト固定の直書きだったため、
ダークにしても白いカードが白い地の上に出ていた。テーマのトークンへ差し替えている。

⚠️ この注記に色の 16 進値を書かないこと。`assert:no-hardcoded-colors` はコメントも走査する。
⚠️ ここに色を直書きしないこと。凍結リストから外れたので、次からは検査が止める。
*/
import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

// #1499 【仕様】取得失敗時に、画面を離れず同じ条件でその場で再試行できるボタンを出す。
// 再試行中は onRetry 側（呼び出し元の dishCategories.tsx）が isRetrying を true にし、二重発火を防ぐ。
export const DishCategoriesError = ({
	error,
	onBack,
	onRetry,
	isRetrying = false,
}: {
	error: string;
	onBack: () => void;
	onRetry: () => void;
	isRetrying?: boolean;
}) => {
	const { lightImpact } = useHaptics();
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();

	const handleBack = () => {
		lightImpact();
		onBack();
	};

	const handleRetry = () => {
		if (isRetrying) return;
		lightImpact();
		onRetry();
	};

	return (
		<LinearGradient colors={colors.backgroundGradient} style={styles.errorContainer} testID="dish-categories-error">
			<View style={styles.errorCard}>
				<Text style={styles.errorText} testID="dish-categories-error-message">
					{error}
				</Text>
				<TouchableOpacity
					style={[styles.retryButton, isRetrying && styles.retryButtonDisabled]}
					onPress={handleRetry}
					disabled={isRetrying}
					accessibilityRole="button"
					accessibilityState={{ disabled: isRetrying, busy: isRetrying }}
					testID="dish-categories-error-retry">
					{isRetrying ? (
						<LoadingIndicator size="small" />
					) : (
						<Text style={styles.retryButtonText}>{i18n.t("Common.retry")}</Text>
					)}
				</TouchableOpacity>
				<TouchableOpacity style={styles.backButton} onPress={handleBack} testID="dish-categories-error-back">
					<Text style={styles.backButtonText}>{i18n.t("Common.back")}</Text>
				</TouchableOpacity>
			</View>
		</LinearGradient>
	);
};

const createStyles = (colors: Palette) =>
	StyleSheet.create({
		errorContainer: {
			flex: 1,
			justifyContent: "center",
			alignItems: "center",
			paddingHorizontal: 24,
		},
		errorCard: {
			backgroundColor: colors.surface,
			borderRadius: 24,
			padding: 32,
			alignItems: "center",
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 0 },
			shadowOpacity: 0.15,
			shadowRadius: 16,
			elevation: 12,
			width: "100%",
			maxWidth: 320,
		},
		errorText: {
			fontSize: 16,
			color: colors.dangerStrong,
			textAlign: "center",
			marginBottom: 24,
			lineHeight: 24,
			fontWeight: "500",
		},
		retryButton: {
			backgroundColor: colors.brand,
			paddingHorizontal: 24,
			paddingVertical: 16,
			borderRadius: 16,
			shadowColor: colors.brand,
			shadowOffset: { width: 0, height: 4 },
			shadowOpacity: 0.3,
			shadowRadius: 12,
			elevation: 6,
			minWidth: 140,
			alignItems: "center",
			justifyContent: "center",
		},
		retryButtonDisabled: {
			opacity: 0.6,
		},
		retryButtonText: {
			fontSize: 16,
			// ブランド色で塗った CTA の上の文字。地（colors.brand）がライト / ダークで変わらないため文字も振らない
			color: FixedColors.onFilled,
			fontWeight: "600",
			letterSpacing: 0.3,
		},
		backButton: {
			marginTop: 16,
			paddingHorizontal: 24,
			paddingVertical: 12,
		},
		backButtonText: {
			fontSize: 14,
			color: colors.textSecondary,
			fontWeight: "500",
		},
	});
