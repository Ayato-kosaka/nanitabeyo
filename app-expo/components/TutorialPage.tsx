import React from "react";
import { View, Text, StyleSheet } from "react-native";

import { PreloadedImage } from "@/components/PreloadedImage";
import type { PreloadAssetKey } from "@/constants/preloadAssets";

export type TutorialPageProps = {
	/**
	 * #1087 【設計】`source` ではなく先読み定義のキーを受け取る。
	 * cachePolicy が先読み側と必ず一致することを型で保証するため(#785)。
	 */
	asset: PreloadAssetKey;
	title: string;
	bodyLines: string[];
};

/**
 * #642 チュートリアル用ページの「上側コンテンツ」
 *
 * - 16:9 イラスト + タイトル + 本文のみを担当
 * - ページインジケータ / CTA は親コンポーネント側で制御する
 */
export function TutorialPage({ asset, title, bodyLines }: TutorialPageProps) {
	return (
		<View style={styles.container}>
			{/* 16:9 イラスト画像 */}
			<View style={styles.imageContainer}>
				<PreloadedImage asset={asset} style={styles.image} contentFit="cover" />
			</View>

			{/* タイトル */}
			<Text style={styles.title}>{title}</Text>

			{/* 本文 */}
			<View style={styles.bodyContainer}>
				<Text style={styles.bodyText}>{bodyLines.join("")}</Text>
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
	},
});
