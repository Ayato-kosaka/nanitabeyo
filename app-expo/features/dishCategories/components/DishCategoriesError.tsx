import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";
import { LoadingIndicator } from "@/components/LoadingIndicator";

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
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.errorContainer} testID="dish-categories-error">
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

const styles = StyleSheet.create({
	errorContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		paddingHorizontal: 24,
	},
	errorCard: {
		backgroundColor: "#FFFFFF",
		borderRadius: 24,
		padding: 32,
		alignItems: "center",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.15,
		shadowRadius: 16,
		elevation: 12,
		width: "100%",
		maxWidth: 320,
	},
	errorText: {
		fontSize: 16,
		color: "#EF4444",
		textAlign: "center",
		marginBottom: 24,
		lineHeight: 24,
		fontWeight: "500",
	},
	retryButton: {
		backgroundColor: "#F05537",
		paddingHorizontal: 24,
		paddingVertical: 16,
		borderRadius: 16,
		shadowColor: "#F05537",
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
		color: "#FFFFFF",
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
		color: "#6B7280",
		fontWeight: "500",
	},
});
