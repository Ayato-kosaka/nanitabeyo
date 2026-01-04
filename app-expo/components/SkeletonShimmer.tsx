import React, { useEffect, useRef } from "react";
import { View, StyleSheet, Animated } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

interface SkeletonShimmerProps {
	width: number | string;
	height: number | string;
	borderRadius?: number;
}

// #615 【UX】画像ロード中に shimmer スケルトンを表示（低速回線でも視認性安定）
export const SkeletonShimmer: React.FC<SkeletonShimmerProps> = ({ width, height, borderRadius = 0 }) => {
	const animatedValue = useRef(new Animated.Value(0)).current;

	useEffect(() => {
		const animation = Animated.loop(
			Animated.sequence([
				Animated.timing(animatedValue, {
					toValue: 1,
					duration: 1200,
					useNativeDriver: true,
				}),
				Animated.timing(animatedValue, {
					toValue: 0,
					duration: 1200,
					useNativeDriver: true,
				}),
			]),
		);
		animation.start();
		return () => animation.stop();
	}, [animatedValue]);

	// #615 【設計】画面幅の 80% を shimmer の移動範囲とする（レスポンシブ対応）
	const shimmerWidth = typeof width === "number" ? width * 0.8 : 300;
	const translateX = animatedValue.interpolate({
		inputRange: [0, 1],
		outputRange: [-shimmerWidth, shimmerWidth],
	});

	return (
		<View style={[styles.container, { width, height, borderRadius }]}>
			<Animated.View
				style={[
					styles.shimmer,
					{
						transform: [{ translateX }],
					},
				]}>
				<LinearGradient
					colors={["#E0E0E0", "#F5F5F5", "#E0E0E0"]}
					start={{ x: 0, y: 0 }}
					end={{ x: 1, y: 0 }}
					style={styles.gradient}
				/>
			</Animated.View>
		</View>
	);
};

const styles = StyleSheet.create({
	container: {
		backgroundColor: "#E0E0E0",
		overflow: "hidden",
	},
	shimmer: {
		width: "100%",
		height: "100%",
	},
	gradient: {
		width: "300%",
		height: "100%",
	},
});
