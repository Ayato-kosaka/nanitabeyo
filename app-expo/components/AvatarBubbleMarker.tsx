import React, { useMemo } from "react";
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

// #235 【バグ】React.memo で不要な再描画を防止
export const AvatarBubbleMarker = React.memo(function AvatarBubbleMarker({
	uri,
	size = 48,
	color = "#FFF",
	...props
}: Props) {
	const radius = size / 2;
	const tailSize = 8;
	const tailOffset = 4; // tail の半分を circle に重ねる

	// #235 【パフォーマンス】動的スタイルを useMemo で最適化
	const dynamicStyles = useMemo(() => {
		const shadowColor = color === "#FFF" ? "#000" : color;
		return {
			wrapper: {
				width: size,
				height: size + tailOffset,
				alignItems: "center" as const,
			},
			circle: {
				width: size,
				height: size,
				borderRadius: radius,
				overflow: "hidden" as const,
				...(Platform.OS === "ios"
					? {
							shadowColor,
							shadowOffset: { width: 0, height: 2 },
							shadowOpacity: 0.25,
							shadowRadius: 4,
						}
					: {
							shadowColor,
							shadowOffset: { width: 0, height: 0 },
							shadowOpacity: 0.25,
							shadowRadius: 10,
							elevation: 10,
						}),
			},
			avatar: {
				borderColor: color,
				width: size,
				height: size,
				borderRadius: radius,
			},
			tail: {
				backgroundColor: color,
				width: tailSize,
				height: tailSize,
				bottom: -tailOffset,
			},
		};
	}, [size, color]);

	return (
		<Marker {...props}>
			{/* #235 【設計】wrapper / circle / tail を分離して Android の円形崩れを修正 */}
			<View style={[styles.wrapper, dynamicStyles.wrapper]}>
				{/* circle: 円形クリップ担当 */}
				<View style={[styles.circle, dynamicStyles.circle]}>
					<Image
						source={{ uri, cacheKey: getCacheKeyForImage(uri) }}
						style={[styles.avatar, dynamicStyles.avatar]}
						contentFit="cover"
					/>
				</View>
				{/* tail: circle の外に配置（クリップ影響を受けない） */}
				<View style={[styles.bubbleTail, dynamicStyles.tail]} />
			</View>
		</Marker>
	);
});

const styles = StyleSheet.create({
	wrapper: {
		justifyContent: "flex-start",
	},
	circle: {
		backgroundColor: "transparent",
	},
	avatar: {
		borderWidth: 2,
	},
	bubbleTail: {
		position: "absolute",
		transform: [{ rotate: "45deg" }],
	},
});
