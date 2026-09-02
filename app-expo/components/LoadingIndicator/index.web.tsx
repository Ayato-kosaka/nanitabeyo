// #690 【設計】Lottie ベースの共通 Loading コンポーネント( web 専用 )
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { dualBallLottie, SIZE_MAP, LoadingIndicatorProps } from "./shared";

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

		const dualBallData = JSON.stringify(dualBallLottie);

		return (
			<View
				style={[styles.container, style]}
				testID={testID}
				{...(Platform.OS === "web"
					? {
							// #690 【設計】Web アクセシビリティ対応 - role="status" / aria-live="polite"
							role: "status" as const,
							"aria-live": "polite" as const,
							"aria-label": accessibilityLabel,
						}
					: {})}
				pointerEvents="none">
				<DotLottieReact data={dualBallData} autoplay loop style={{ width: dimension, height: dimension }} />
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
