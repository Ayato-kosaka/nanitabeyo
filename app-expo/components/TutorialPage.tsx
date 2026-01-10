import React from "react";
import { View, Text, StyleSheet, Image, ImageSourcePropType, TouchableOpacity } from "react-native";

export type TutorialPageProps = {
	image: ImageSourcePropType;
	title: string;
	bodyLines: string[];
	primaryCtaLabel: string;
	onPrimaryCtaPress?: () => void;
	secondaryCtaLabel?: string;
	onSecondaryCtaPress?: () => void;
};

/**
 * #642 【設計】チュートリアル用の単一ページコンポーネント
 * - 16:9 イラスト画像 + タイトル + 本文 + CTA ボタン
 */
export function TutorialPage({
	image,
	title,
	bodyLines,
	primaryCtaLabel,
	onPrimaryCtaPress,
	secondaryCtaLabel,
	onSecondaryCtaPress,
}: TutorialPageProps) {
	return (
		<View style={styles.container}>
			{/* 16:9 イラスト画像 */}
			<View style={styles.imageContainer}>
				<Image source={image} style={styles.image} resizeMode="contain" />
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

			{/* CTA ボタン */}
			<View style={styles.ctaContainer}>
				{/* Primary CTA */}
				<TouchableOpacity style={styles.primaryButton} onPress={onPrimaryCtaPress}>
					<Text style={styles.primaryButtonText}>{primaryCtaLabel}</Text>
				</TouchableOpacity>

				{/* Secondary CTA (optional) */}
				{secondaryCtaLabel && onSecondaryCtaPress && (
					<TouchableOpacity style={styles.secondaryButton} onPress={onSecondaryCtaPress}>
						<Text style={styles.secondaryButtonText}>{secondaryCtaLabel}</Text>
					</TouchableOpacity>
				)}
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		paddingHorizontal: 24,
		paddingVertical: 32,
		justifyContent: "space-between",
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
		fontSize: 24,
		fontWeight: "700",
		color: "#1A1A1A",
		textAlign: "center",
		marginBottom: 16,
		letterSpacing: -0.5,
	},
	bodyContainer: {
		marginBottom: 32,
	},
	bodyText: {
		fontSize: 16,
		color: "#6B7280",
		textAlign: "center",
		lineHeight: 24,
		marginBottom: 8,
	},
	ctaContainer: {
		gap: 12,
	},
	primaryButton: {
		backgroundColor: "#5EA2FF",
		paddingVertical: 16,
		paddingHorizontal: 32,
		borderRadius: 32,
		alignItems: "center",
		shadowColor: "#5EA2FF",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.3,
		shadowRadius: 12,
		elevation: 8,
	},
	primaryButtonText: {
		fontSize: 18,
		fontWeight: "700",
		color: "#FFF",
		letterSpacing: 0.5,
	},
	secondaryButton: {
		backgroundColor: "transparent",
		paddingVertical: 16,
		paddingHorizontal: 32,
		borderRadius: 32,
		alignItems: "center",
	},
	secondaryButtonText: {
		fontSize: 16,
		fontWeight: "600",
		color: "#6B7280",
		letterSpacing: 0.5,
	},
});
