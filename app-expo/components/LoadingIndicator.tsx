// #690 【設計】Lottie ベースの共通 Loading コンポーネント - 全 ActivityIndicator を置換
import React from "react";
import { Platform, StyleSheet, View, ViewStyle } from "react-native";
import LottieView from "lottie-react-native";

type LoadingIndicatorSize = "small" | "large";

type LoadingIndicatorProps = {
	/** サイズバリエーション (デフォルト: "large") */
	size?: LoadingIndicatorSize;
	/** 追加スタイル */
	style?: ViewStyle | ViewStyle[];
	/** Web 用アクセシビリティラベル（指定がなければ "Loading" をデフォルトとする） */
	accessibilityLabel?: string;
};

// #690 【設計】サイズマップ - small: 24px, large: 48px
const SIZE_MAP: Record<LoadingIndicatorSize, number> = {
	small: 24,
	large: 48,
};

/**
 * Lottie ベースの共通ローディングインジケータ
 * 
 * @example
 * // 基本的な使い方
 * <LoadingIndicator size="large" />
 * 
 * @example
 * // ボタン内などで小さいサイズを使用
 * <LoadingIndicator size="small" />
 * 
 * @example
 * // カスタムスタイルを追加
 * <LoadingIndicator size="large" style={{ marginTop: 20 }} />
 */
export const LoadingIndicator: React.FC<LoadingIndicatorProps> = React.memo(
	({ size = "large", style, accessibilityLabel = "Loading" }) => {
		const dimension = SIZE_MAP[size];

		return (
			<View
				style={[styles.container, style]}
				{...(Platform.OS === "web"
					? {
							// #690 【設計】Web アクセシビリティ対応 - role="status" / aria-live="polite"
							role: "status" as const,
							"aria-live": "polite" as const,
							"aria-label": accessibilityLabel,
						}
					: {})}
				pointerEvents="none">
				<LottieView
					source={require("../assets/lottie/DualBall.json")}
					autoPlay
					loop
					style={{ width: dimension, height: dimension }}
				/>
			</View>
		);
	},
);

LoadingIndicator.displayName = "LoadingIndicator";

const styles = StyleSheet.create({
	container: {
		justifyContent: "center",
		alignItems: "center",
	},
});
