import React, { forwardRef } from "react";
import { View, ViewProps, ViewStyle, Platform, StyleProp } from "react-native";
import { FixedColors } from "@/constants/Palette";
import { useAppTheme } from "@/contexts/ThemeProvider";

export interface CardProps extends ViewProps {
	/** 角丸 (dp)。デフォルト 20 */
	radius?: number;
	/** elevation / shadow 深さ。iOS は 0–16、Android は 0–24 程度 */
	elevation?: number;
	/** 内側パディング。単一値または StyleSheet のショートハンド形式 */
	padding?: number | ViewStyle["padding"];
	/** カスタムスタイル (背景色や余白などを上書き) */
	style?: StyleProp<ViewStyle>;
	/** テスト用 ID */
	testID?: string;
}

/**
 * Reusable white (or themed) card with rounded corners and shadow.
 */
export const Card = forwardRef<View, CardProps>(
	(
		{
			children,
			radius = 20,
			elevation = 4,
			padding = { paddingHorizontal: 16, paddingVertical: 20 },
			style,
			onLayout,
			...rest
		},
		ref,
	) => {
		/** ----- Theme-aware background ----- */
		// #1509 【設計】ここは `useColorScheme` を import しながら使わず `#FFFFFF` 固定だった。
		// カードは全画面の下地なので、ここが白のままだとダークにしても白い矩形が残る。
		const { colors } = useAppTheme();
		const bgColor = colors.surface;

		/** ----- Compose shadow style (iOS / Android / Web) ----- */
		const shadowStyle: ViewStyle =
			Platform.OS === "android"
				? { elevation }
				: {
						// #1509 影はテーマ非追従（`#000` と `#000000` は同一色。値は変わっていない）
						shadowColor: FixedColors.shadow,
						shadowOffset: { width: 0, height: 0 },
						shadowOpacity: 0.1,
						shadowRadius: elevation * 4,
					};

		/** ----- Merge all styles ----- */
		const containerStyle: StyleProp<ViewStyle> = [
			{
				borderRadius: radius,
				margin: 16,
				// Android の描画安定化（端末によって効く）
				// @ts-ignore
				renderToHardwareTextureAndroid: true,
				backgroundColor: "transparent",
			},
			shadowStyle,
		];
		const surfaceStyle: StyleProp<ViewStyle> = [
			{
				backgroundColor: bgColor,
				borderRadius: radius,
				overflow: "hidden",
				// Default padding
				...(typeof padding === "number" ? { padding } : (padding as object)),
			},
			style,
		];

		return (
			<View style={containerStyle} onLayout={onLayout} pointerEvents="box-none">
				<View ref={ref} style={surfaceStyle} {...rest}>
					{children}
				</View>
			</View>
		);
	},
);

Card.displayName = "Card";
