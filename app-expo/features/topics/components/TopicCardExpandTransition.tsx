import React, { useEffect } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
	Easing,
	interpolate,
	runOnJS,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import i18n from "@/lib/i18n";
import { LoadingIndicator } from "@/components/LoadingIndicator";

export type CardRect = { x: number; y: number; width: number; height: number };

type TopicCardExpandTransitionProps = {
	/** 拡大させる料理カードの画像URL */
	imageUrl: string;
	/** アニメーション開始時点の、押されたカード自身の画面上の矩形（measureInWindow由来） */
	originRect: CardRect;
	/** カードの角丸（TopicVisualCard.card の borderRadius と揃える） */
	cardBorderRadius?: number;
	/** フルスクリーンまで広がり切ったタイミングで呼ばれる（ここで画面遷移する） */
	onExpandComplete: () => void;
};

const EXPAND_DURATION_MS = 340;

// #1484 【仕様】「この料理にする！」押下位置（押されたカードそのもの）から、その場でフルスクリーンへ
// 広がっていくShared Element的なアニメーション。押下直後はまだ Topics 画面に居るまま、
// カードの実測矩形（originRect）から画面全体へ interpolate させ、広がり切ってから画面遷移する。
export const TopicCardExpandTransition = ({
	imageUrl,
	originRect,
	cardBorderRadius = 24,
	onExpandComplete,
}: TopicCardExpandTransitionProps) => {
	const { width: screenWidth, height: screenHeight } = useWindowDimensions();
	const progress = useSharedValue(0);

	useEffect(() => {
		progress.value = withTiming(1, { duration: EXPAND_DURATION_MS, easing: Easing.out(Easing.cubic) }, (finished) => {
			if (finished) runOnJS(onExpandComplete)();
		});
		// 開始矩形・完了コールバックはマウント時点の値で1回だけ走らせる（再アニメーションさせない）。
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const containerStyle = useAnimatedStyle(() => {
		const x = interpolate(progress.value, [0, 1], [originRect.x, 0]);
		const y = interpolate(progress.value, [0, 1], [originRect.y, 0]);
		const width = interpolate(progress.value, [0, 1], [originRect.width, screenWidth]);
		const height = interpolate(progress.value, [0, 1], [originRect.height, screenHeight]);
		const borderRadius = interpolate(progress.value, [0, 1], [cardBorderRadius, 0]);
		return { left: x, top: y, width, height, borderRadius };
	});

	const spinnerStyle = useAnimatedStyle(() => ({
		opacity: interpolate(progress.value, [0.55, 1], [0, 1], "clamp"),
	}));

	return (
		// #1484 【仕様】広がっている間は下にある Topics 画面の操作（スワイプ・別カードのタップ）を
		// 受け付けたくないため、pointerEvents は "none" にしない（"none" だと下へ突き抜けてしまう）。
		<Animated.View style={[styles.root, containerStyle]} pointerEvents="auto">
			<Image
				source={{ uri: imageUrl }}
				style={StyleSheet.absoluteFill}
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
			<Animated.View
				style={[styles.spinnerContainer, spinnerStyle]}
				accessibilityRole="progressbar"
				accessibilityLabel={i18n.t("Restaurant.Loading.title")}>
				<View pointerEvents="none">
					<LoadingIndicator size="large" />
				</View>
			</Animated.View>
		</Animated.View>
	);
};

const styles = StyleSheet.create({
	root: {
		position: "absolute",
		zIndex: 9999,
		elevation: 24,
		backgroundColor: "#000",
		overflow: "hidden",
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
