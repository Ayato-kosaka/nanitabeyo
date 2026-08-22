import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import i18n from "@/lib/i18n";
import { LoadingIndicator } from "@/components/LoadingIndicator";

type DishSelectionExpandLoadingProps = {
	/** #1484 選択された料理カードの画像URL。店舗提案の取得完了までこの画像を画面に残す。 */
	imageUrl: string;
};

// #1484 【仕様】「この料理にする！」押下後、独立したローディング画面の代わりに選択した料理画像を
// ほぼフルスクリーンに拡大表示したまま店舗提案の取得を待つ。食欲・期待感を画面から消さないための演出。
export const DishSelectionExpandLoading = ({ imageUrl }: DishSelectionExpandLoadingProps) => {
	const scale = useSharedValue(0.94);
	const opacity = useSharedValue(0);

	useEffect(() => {
		scale.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
		opacity.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
	}, [opacity, scale]);

	const animatedStyle = useAnimatedStyle(() => ({
		opacity: opacity.value,
		transform: [{ scale: scale.value }],
	}));

	return (
		<Animated.View
			style={[styles.container, animatedStyle]}
			accessibilityRole="progressbar"
			accessibilityLabel={i18n.t("Restaurant.Loading.title")}>
			<Image
				source={{ uri: imageUrl }}
				style={styles.image}
				contentFit="cover"
				cachePolicy="memory-disk"
				transition={0}
			/>
			<LinearGradient
				pointerEvents="none"
				colors={["rgba(0, 0, 0, 0.00)", "rgba(0, 0, 0, 0.18)", "rgba(0, 0, 0, 0.48)"]}
				locations={[0, 0.6, 1]}
				style={styles.bottomGradient}
			/>
			<View style={styles.spinnerContainer} pointerEvents="none">
				<LoadingIndicator size="large" />
			</View>
		</Animated.View>
	);
};

const styles = StyleSheet.create({
	container: {
		...StyleSheet.absoluteFillObject,
		backgroundColor: "#000",
	},
	image: {
		width: "100%",
		height: "100%",
	},
	bottomGradient: {
		position: "absolute",
		left: 0,
		right: 0,
		bottom: 0,
		height: "40%",
	},
	spinnerContainer: {
		position: "absolute",
		left: 0,
		right: 0,
		bottom: 64,
		alignItems: "center",
	},
});
