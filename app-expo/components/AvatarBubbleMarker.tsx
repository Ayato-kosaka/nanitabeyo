import React from "react";
import { View, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { Marker } from "./MapView";
import type { MapMarkerProps as RNMarkerProps } from "react-native-maps";

type Props = RNMarkerProps & {
	uri: string;
	size?: number;
	color?: string;
};

export function AvatarBubbleMarker({ uri, size = 48, color = "#FFF", ...props }: Props) {
	const radius = size / 2;

	return (
		<Marker {...props}>
			{/* シャドウ専用ラッパー: elevation はここだけに付与（Android） */}
			<View
				collapsable={false}
				style={[
					styles.shadowWrapper,
					{
						width: size,
						height: size,
						borderRadius: radius,
						shadowColor: color === "#FFF" ? "#000" : color,
						shadowRadius: 10,
						shadowOffset: { width: 0, height: 0 },
						shadowOpacity: 0.25,
						elevation: 10,
					},
				]}>
				{/* 円形クリップ用: borderRadius + overflow:hidden はこの子だけに適用 */}
				<View
					collapsable={false}
					style={[
						styles.circle,
						{
							width: size,
							height: size,
							borderRadius: radius,
							borderColor: color,
						},
					]}>
					<Image
						source={{ uri }}
						style={{
							width: size,
							height: size,
							borderRadius: radius,
						}}
					/>
				</View>

				{/* バブルしっぽ（枠色に合わせたダイヤ形） */}
				<View
					style={[
						styles.bubbleTail,
						{
							backgroundColor: color,
							// size に応じてしっぽの位置を微調整
							bottom: -Math.max(2, Math.round((48 / size) * 2)),
						},
					]}
				/>
			</View>
		</Marker>
	);
}

const styles = StyleSheet.create({
	// 影用の外側。ここには borderRadius を付けない（＝Android の描画欠け回避）
	shadowWrapper: {
		alignItems: "center",
		justifyContent: "center",
	},
	// 円形コンテンツ（クリップ＆枠線）
	circle: {
		overflow: "hidden",
		borderWidth: 2,
		zIndex: 1,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#FFF",
	},
	bubbleTail: {
		position: "absolute",
		width: 8,
		height: 8,
		transform: [{ rotate: "45deg" }],
		zIndex: 0,
	},
});
