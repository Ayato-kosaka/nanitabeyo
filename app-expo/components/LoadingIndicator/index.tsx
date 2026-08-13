// #690 【設計】Lottie ベースの共通 Loading コンポーネント - 全 ActivityIndicator を置換
import React from "react";
import { StyleSheet, View } from "react-native";
import LottieView from "lottie-react-native";
import { SIZE_MAP, LoadingIndicatorProps, dualBallLottie } from "./shared";

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
	({ size = "large", style, accessibilityLabel = "Loading", testID }) => {
		const dimension = SIZE_MAP[size];

		return (
			<View style={[styles.container, style]} testID={testID} pointerEvents="none">
				<LottieView source={dualBallLottie} autoPlay loop style={{ width: dimension, height: dimension }} />
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
