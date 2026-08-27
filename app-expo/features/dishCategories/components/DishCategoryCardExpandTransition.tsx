import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
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
import { FixedColors } from "@/constants/Palette";

export type CardRect = { x: number; y: number; width: number; height: number };

type DishCategoryCardExpandTransitionProps = {
	/** 拡大させる料理カードの画像URL */
	imageUrl: string;
	/** アニメーション開始時点の、押されたカード自身の矩形（呼び出し元でこのコンポーネントの親基準に変換済み） */
	originRect: CardRect;
	/** 広がりきった時の目標矩形（同じく呼び出し元でこのコンポーネントの親基準に変換済み） */
	targetRect: CardRect;
	/** カードの角丸（DishCategoryVisualCard.card の borderRadius と揃える） */
	cardBorderRadius?: number;
	/** フルスクリーンまで広がり切ったタイミングで呼ばれる（ここで画面遷移する） */
	onExpandComplete: () => void;
};

const EXPAND_DURATION_MS = 340;

// #1484 【仕様】「この料理にする！」押下位置（押されたカードそのもの）から、その場でフルスクリーンへ
// 広がっていくShared Element的なアニメーション。押下直後はまだ DishCategories 画面に居るまま、
// カードの実測矩形（originRect）から画面全体へ interpolate させ、広がり切ってから画面遷移する。
export const DishCategoryCardExpandTransition = ({
	imageUrl,
	originRect,
	targetRect,
	cardBorderRadius = 24,
	onExpandComplete,
}: DishCategoryCardExpandTransitionProps) => {
	const progress = useSharedValue(0);

	useEffect(() => {
		progress.value = withTiming(1, { duration: EXPAND_DURATION_MS, easing: Easing.out(Easing.cubic) }, (finished) => {
			if (finished) runOnJS(onExpandComplete)();
		});
		// 開始矩形・完了コールバックはマウント時点の値で1回だけ走らせる（再アニメーションさせない）。
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const containerStyle = useAnimatedStyle(() => {
		const x = interpolate(progress.value, [0, 1], [originRect.x, targetRect.x]);
		const y = interpolate(progress.value, [0, 1], [originRect.y, targetRect.y]);
		const width = interpolate(progress.value, [0, 1], [originRect.width, targetRect.width]);
		const height = interpolate(progress.value, [0, 1], [originRect.height, targetRect.height]);
		const borderRadius = interpolate(progress.value, [0, 1], [cardBorderRadius, 0]);
		return { left: x, top: y, width, height, borderRadius };
	});

	const spinnerStyle = useAnimatedStyle(() => ({
		opacity: interpolate(progress.value, [0.55, 1], [0, 1], "clamp"),
	}));

	return (
		// #1484 【仕様】広がっている間は下にある DishCategories 画面の操作（スワイプ・別カードのタップ）を
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
		// #1629 広がっていく料理写真の下地。遷移先の DishSelectionExpandLoading と同じ «メディアの地» で、
		// 画像の読み込みが間に合わなかった一瞬もここが覗く。テーマで振ると遷移の前後で地の色が変わってしまう
		backgroundColor: FixedColors.mediaBackground,
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
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
		justifyContent: "center",
		alignItems: "center",
	},
});
