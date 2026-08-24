import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";

interface EmptyStateProps {
	/** 空状態のメッセージ。error 指定時は代わりに error が使われる */
	message: string;
	/** CTA ボタンのラベル。未指定なら CTA を表示しない */
	actionLabel?: string;
	/** CTA ボタン押下時のハンドラ */
	onAction?: () => void;
	/** エラー発生時のメッセージ。指定時は message の代わりにこちらを表示する */
	error?: string | null;
	/** エラー時の再試行ハンドラ。指定時は error 表示に再試行ボタンを出す */
	onRetry?: () => void;
	testID?: string;
}

/**
 * #947 【仕様】空状態(データ0件)/エラー状態の共通UI。
 * LikeTab/SaveDishCategoryTab/blocked-dish-categories 等で同じ見た目・スタイルが 4箇所以上コピペされており、
 * CTAがあるのもLikeTabだけだった。ここに集約し、
 * 各画面には「何を表示するか(message/actionLabel/onAction)」だけを渡させる。
 * CTAはPrimaryButton経由にすることでrole/label/disabled状態のアクセシビリティを担保する。
 *
 * （#1402 でマイページの 4 グリッドタブを廃止し、SavedPostsTab / ReviewTab は撤去された）
 */
export function EmptyState({ message, actionLabel, onAction, error, onRetry, testID }: EmptyStateProps) {
	const isError = !!error;

	return (
		<View style={styles.container} testID={testID}>
			<View style={styles.card}>
				<Text style={styles.text}>{isError ? error : message}</Text>
				{isError && onRetry ? (
					<PrimaryButton
						style={styles.button}
						label={i18n.t("Profile.tabError.retry")}
						onPress={onRetry}
						testID={testID ? `${testID}-retry` : undefined}
					/>
				) : !isError && actionLabel && onAction ? (
					<PrimaryButton
						style={styles.button}
						label={actionLabel}
						onPress={onAction}
						testID={testID ? `${testID}-action` : undefined}
					/>
				) : null}
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
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
