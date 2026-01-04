import React from "react";
import { View, StyleSheet } from "react-native";
import { Marker } from "./MapView";
import type { MapMarkerProps as RNMarkerProps } from "react-native-maps";
import { Image } from "expo-image";
import { getCacheKeyForImage } from "@/lib/image";
import { Platform } from "react-native";

type Props = RNMarkerProps & {
	uri: string | undefined;
	size?: number;
	color?: string;
};

/**
 * #235 【設計】DEPRECATED: View Marker方式（Android で円形崩れ・ちらつき問題あり）
 *
 * 本コンポーネントは Android(Google Maps) で以下の問題が発生するため、
 * 新規実装では AvatarBubbleMarkerBitmap を使用すること：
 * - 円形が崩れて扇形や欠けた形で表示される
 * - state/region更新時にちらつく（再キャプチャ処理起因）
 *
 * 問題の原因は View Marker の bitmap化処理で borderRadius/overflow:hidden が
 * 端末/GPU依存で破綻すること。bitmap icon方式（AvatarBubbleMarkerBitmap）で根治。
 *
 * @deprecated Use AvatarBubbleMarkerBitmap instead
 */
export function AvatarBubbleMarker({ uri, size = 48, color = "#FFF", ...props }: Props) {
	const radius = size / 2;
	return (
		<Marker {...props}>
			<View
				style={[
					styles.container,
					{
						width: size,
						height: size,
						borderRadius: radius,
						...(Platform.OS === "ios"
							? {
									shadowColor: color === "#FFF" ? "#000" : color,
									alignItems: "center",
									justifyContent: "center",
								}
							: {
									shadowColor: color === "#FFF" ? "#000" : color,
									shadowRadius: 10,
									shadowOffset: { width: 0, height: 0 },
									shadowOpacity: 0.25,
									elevation: 10,
								}),
					},
				]}>
				<Image
					source={{ uri, cacheKey: getCacheKeyForImage(uri) }}
					style={[
						styles.avatar,
						{
							borderColor: color,
							width: size,
							height: size,
							borderRadius: radius,
						},
					]}
					contentFit="cover"
				/>
				{/* バブルしっぽ */}
				<View
					style={[
						styles.bubbleTail,
						{
							backgroundColor: color,
							bottom: -(48 / size) * 2,
						},
					]}
				/>
			</View>
		</Marker>
	);
}

const styles = StyleSheet.create({
	container: {
		alignItems: "center",
	},
	avatar: {
		borderWidth: 2,
		zIndex: 1000,
	},
	bubbleTail: {
		position: "absolute",
		width: 8,
		height: 8,
		transform: [{ rotate: "45deg" }],
	},
});
