import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useThemedStyles } from "@/contexts/ThemeProvider";
import type { Palette } from "@/constants/Palette";
import i18n from "@/lib/i18n";

interface EmptyStateProps {
	/** 空状態のメッセージ。error 指定時は代わりに error が使われる */
	message: string;
	/**
	 * #1505 message の下に置く 1 行説明。「なぜ空か」だけでなく
	 * 「次に何をすればよいか」を言うために足した（docs/design-guidelines.md §4）。
	 * 未指定なら描画しない = 既存の呼び出し側の見た目は変わらない。
	 */
	description?: string;
	/**
	 * #1505 message の上に置く装飾アイコン。文字 1 行だけの空状態は
	 * 「読み込みに失敗したのか、本当に空なのか」が伝わらないため。
	 * 読み上げ対象からは外す（意味は message/description が持つ）。
	 */
	icon?: React.ReactNode;
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
 * LikeTab/SaveTopicTab/blocked-topics 等で同じ見た目・スタイルが 4箇所以上コピペされており、
 * CTAがあるのもLikeTabだけだった。ここに集約し、
 * 各画面には「何を表示するか(message/actionLabel/onAction)」だけを渡させる。
 * CTAはPrimaryButton経由にすることでrole/label/disabled状態のアクセシビリティを担保する。
 *
 * （#1402 でマイページの 4 グリッドタブを廃止し、SavedPostsTab / ReviewTab は撤去された）
 *
 * #1505 icon / description を任意で受けられるようにし、色を #1509 のパレット経由にした。
 * ライトの値は置換前のリテラルと同一（surface = #FFFFFF、textSecondary = #6B7280）なので、
 * 既存の呼び出し側のライトの見た目は 1px も変わらない。
 */
export function EmptyState({
	message,
	description,
	icon,
	actionLabel,
	onAction,
	error,
	onRetry,
	testID,
}: EmptyStateProps) {
	const styles = useThemedStyles(createStyles);
	const isError = !!error;

	return (
		<View style={styles.container} testID={testID}>
			<View style={styles.card}>
				{/* アイコンは装飾。同じ内容を二重に読み上げさせない */}
				{icon ? (
					<View style={styles.icon} accessibilityElementsHidden importantForAccessibility="no">
						{icon}
					</View>
				) : null}
				<Text style={styles.text}>{isError ? error : message}</Text>
				{!isError && description ? <Text style={styles.description}>{description}</Text> : null}
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

const createStyles = (colors: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
		},
		card: {
			backgroundColor: colors.surface,
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
		icon: {
			marginBottom: 12,
		},
		text: {
			fontSize: 16,
			color: colors.textSecondary,
			textAlign: "center",
		},
		description: {
			marginTop: 6,
			fontSize: 13,
			color: colors.textTertiary,
			textAlign: "center",
			lineHeight: 18,
		},
		button: {
			marginTop: 16,
		},
	});
