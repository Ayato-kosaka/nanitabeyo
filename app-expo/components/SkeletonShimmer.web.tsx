import React, { useEffect, useMemo } from "react";
import { View, StyleSheet, ViewStyle, DimensionValue } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useAppTheme } from "@/contexts/ThemeProvider";

/**
 * SkeletonShimmer（web 専用実装）
 * ------------------------------------------------------------
 * #959【根因】RNW 0.20 は native の Animated モジュールを持たないため、
 * `useNativeDriver: true` を指定した Animated は必ず
 * 「Animated: `useNativeDriver` is not supported ... Falling back to JS-based animation」
 * という console.warn を出す(vendor/react-native/Animated/NativeAnimatedHelper.js 参照)。
 * SkeletonShimmer.tsx（native 実装）は複数画面で常時マウントされるため、この警告が
 * web コンソールを埋め尽くしていた。
 *
 * 対応方針: web だけは Animated を一切使わず、CSS @keyframes + transform で
 * 同じ「光の帯が流れる」見た目を再現する。react-native-web の createDOMProps は
 * RN の style オブジェクトに含まれる未知のプロパティ(animationName 等)をそのまま
 * inline style として DOM へ転送するため、この方法でネイティブアニメーション相当の
 * 滑らかさ(ブラウザ側のコンポジタスレッドで動く)を維持できる。
 *
 * 型定義は SkeletonShimmer.tsx と同一だが、Metro の `.web.tsx` プラットフォーム解決の都合上
 * 同一ファイル名を相互 import すると自己参照になり得るため、あえて重複定義している。
 *
 * ⚠️ #1629 色は native 実装とまったく同じテーマトークン（`skeletonBase` /
 * `skeletonBandGradient`）から採る。片方だけ直書きに戻すと、web とネイティブで
 * ダークの見え方が食い違い、録画での確認が当てにならなくなる。
 */

export type ShimmerDirection = "horizontal" | "vertical";

interface SkeletonShimmerProps {
	width: DimensionValue;
	height: DimensionValue;
	borderRadius?: number;
	direction?: ShimmerDirection;
	durationMs?: number;
	baseColor?: string;
	highlightColor?: string;
	bandSizePx?: number;
	enabled?: boolean;
	style?: ViewStyle;
}

const KEYFRAMES_STYLE_ELEMENT_ID = "nanitabeyo-skeleton-shimmer-keyframes";

/**
 * #959【設計】@keyframes は inline style では定義できないため、初回のみ <style> タグを
 * document.head に注入する(以降のマウントでは ID の存在チェックで再注入をスキップ)。
 */
function ensureKeyframesInjected(): void {
	if (typeof document === "undefined") return;
	if (document.getElementById(KEYFRAMES_STYLE_ELEMENT_ID)) return;

	const styleElement = document.createElement("style");
	styleElement.id = KEYFRAMES_STYLE_ELEMENT_ID;
	styleElement.textContent = `
@keyframes nanitabeyo-skeleton-shimmer-h {
	from { transform: translateX(-100%); }
	to { transform: translateX(100%); }
}
@keyframes nanitabeyo-skeleton-shimmer-v {
	from { transform: translateY(-100%); }
	to { transform: translateY(100%); }
}
`;
	document.head.appendChild(styleElement);
}

export const SkeletonShimmer: React.FC<SkeletonShimmerProps> = ({
	width,
	height,
	borderRadius = 0,
	direction = "horizontal",
	durationMs = 1100,
	baseColor,
	highlightColor,
	bandSizePx,
	enabled = true,
	style,
}) => {
	// #1629【デザイン】地と光帯はテーマから採る（native 実装と同じトークン）
	const { colors } = useAppTheme();
	const resolvedBaseColor = baseColor ?? colors.skeletonBase;
	// #959【アクセシビリティ】OS/ブラウザの「モーションを減らす」設定時は装飾アニメを止めて静的表示にする
	const reducedMotion = useReducedMotion();
	const shouldAnimate = enabled && !reducedMotion;

	useEffect(() => {
		if (shouldAnimate) ensureKeyframesInjected();
	}, [shouldAnimate]);

	const bandThickness = useMemo(() => {
		if (bandSizePx) return bandSizePx;
		const base = direction === "horizontal" ? width : height;
		return typeof base === "number" ? Math.max(96, Math.floor(base * 0.35)) : 140;
	}, [bandSizePx, direction, width, height]);

	const bandStyle = useMemo(() => {
		return direction === "horizontal"
			? { width: bandThickness, height: "100%" as const }
			: { width: "100%" as const, height: bandThickness };
	}, [direction, bandThickness]);

	const gradientColors = useMemo(() => {
		const band = colors.skeletonBandGradient;
		if (!highlightColor) return band;
		// 呼び出し側が中心色を指定したときだけ、中央の 1 段を差し替える
		return [band[0], band[1], highlightColor, band[3], band[4]] as const;
	}, [colors.skeletonBandGradient, highlightColor]);

	// #959【設計】animationName 等は React Native の ViewStyle 型に存在しないため
	// unknown 経由でキャストする(#935 の onKeyDown と同じ、web 専用プロパティを渡す既存パターン)
	const animationStyle = shouldAnimate
		? ({
				animationName: direction === "horizontal" ? "nanitabeyo-skeleton-shimmer-h" : "nanitabeyo-skeleton-shimmer-v",
				animationDuration: `${durationMs}ms`,
				animationTimingFunction: "linear",
				animationIterationCount: "infinite",
			} as unknown as ViewStyle)
		: undefined;

	return (
		<View style={[styles.container, { width, height, borderRadius, backgroundColor: resolvedBaseColor }, style]}>
			<View pointerEvents="none" style={[styles.bandWrap, animationStyle]}>
				<LinearGradient
					colors={gradientColors}
					start={{ x: 0, y: 0 }}
					end={direction === "horizontal" ? { x: 1, y: 0 } : { x: 0, y: 1 }}
					style={[styles.band, bandStyle]}
				/>
			</View>
		</View>
	);
};

const styles = StyleSheet.create({
	container: {
		overflow: "hidden",
	},
	bandWrap: {
		...StyleSheet.absoluteFillObject,
		justifyContent: "center",
		alignItems: "center",
	},
	band: {
		borderRadius: 999,
		opacity: 0.95,
	},
});
