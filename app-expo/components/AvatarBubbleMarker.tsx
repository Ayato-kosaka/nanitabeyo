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
			<View
				style={[
					styles.container,
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
				<Image
					source={{ uri }}
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
					transition={0}
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
