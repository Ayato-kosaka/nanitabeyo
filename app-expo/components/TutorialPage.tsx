import { Image } from "expo-image";
import React from "react";
import { View, Text, StyleSheet, ImageSourcePropType } from "react-native";

export type TutorialPageProps = {
	image: ImageSourcePropType;
	title: string;
	bodyLines: string[];
};

/**
 * #642 チュートリアル用ページの「上側コンテンツ」
 *
 * - 16:9 イラスト + タイトル + 本文のみを担当
 * - ページインジケータ / CTA は親コンポーネント側で制御する
 */
export function TutorialPage({ image, title, bodyLines }: TutorialPageProps) {
	return (
		<View style={styles.container}>
			{/* 16:9 イラスト画像 */}
			<View style={styles.imageContainer}>
				<Image source={image} style={styles.image} contentFit="cover" />
			</View>

			{/* タイトル */}
			<Text style={styles.title}>{title}</Text>

			{/* 本文 */}
			<View style={styles.bodyContainer}>
				{bodyLines.map((line, index) => (
					<Text key={index} style={styles.bodyText}>
						{line}
					</Text>
				))}
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	// 上側コンテンツ全体
	container: {
		flex: 1,
		paddingHorizontal: 24,
		paddingTop: 32,
	},
	imageContainer: {
		aspectRatio: 16 / 9,
		width: "100%",
		marginBottom: 24,
	},
	image: {
		width: "100%",
		height: "100%",
	},
	title: {
		fontSize: 22,
		fontWeight: "700",
		color: "#1A1A1A",
		textAlign: "center",
		marginBottom: 16,
		letterSpacing: -0.3,
	},
	bodyContainer: {
		marginBottom: 8,
	},
	bodyText: {
		fontSize: 15,
		color: "#4B5563",
		textAlign: "left",
		lineHeight: 22,
		marginBottom: 4,
	},
});
