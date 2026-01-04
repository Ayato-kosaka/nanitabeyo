import React from "react";
import { View, StyleSheet, Image } from "react-native";

type Props = {
	uri: string | undefined;
	size?: number;
	color?: string;
};

/**
 * #235 【設計】オフスクリーン描画用のピンコンポーネント
 * react-native-view-shot で PNG 生成するための View（Map に直接載せない）
 * RN標準 Image を使用（生成の安定性優先）
 */
export function BubblePinBitmap({ uri, size = 48, color = "#FFF" }: Props) {
	const radius = size / 2;

	return (
		<View
			style={[
				styles.container,
				{
					width: size,
					height: size + 4, // #235 【設計】tail分の高さを追加
					alignItems: "center",
				},
			]}>
			{/* 円形のアバター画像 */}
			<View
				style={[
					styles.avatarContainer,
					{
						width: size,
						height: size,
						borderRadius: radius,
						backgroundColor: "#E0E0E0", // #235 【設計】fallback背景色（画像読み込み前）
					},
				]}>
				{uri && (
					<Image
						source={{ uri, cache: "force-cache" }}
						style={[
							styles.avatar,
							{
								borderColor: color,
								width: size,
								height: size,
								borderRadius: radius,
							},
						]}
						resizeMode="cover"
					/>
				)}
			</View>

			{/* バブルしっぽ */}
			<View
				style={[
					styles.bubbleTail,
					{
						backgroundColor: color,
						bottom: -2, // #235 【設計】円の下端から2px下に配置
					},
				]}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		alignItems: "center",
		justifyContent: "flex-start",
	},
	avatarContainer: {
		overflow: "hidden",
		zIndex: 1,
	},
	avatar: {
		borderWidth: 2,
	},
	bubbleTail: {
		position: "absolute",
		width: 8,
		height: 8,
		transform: [{ rotate: "45deg" }],
	},
});
