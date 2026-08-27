import React, { useEffect, useMemo, useRef } from "react";
import { View, StyleSheet, Animated, Easing, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { DimensionValue } from "react-native";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useAppTheme } from "@/contexts/ThemeProvider";

/**
 * SkeletonShimmer（iOSっぽい見た目）
 * ------------------------------------------------------------
 * #615【UX】画像ロード中の視認性を安定させるため、iOS風のスケルトン（グレー地＋白い光帯）を表示
 *
 * ✅ iOSっぽさのポイント
 * - ベース：地からわずかに浮いた面（`colors.skeletonBase`）
 * - 光帯：両端が地に溶けるグラデーション（`colors.skeletonBandGradient`。端は透明で“光”に見せる）
 * - 動くのは「帯」だけ（面全体が動く/明滅しない）
 *
 * ⚠️ #1629 ここに色を直書きしないこと。ダークで «スケルトンだけ白く光る» のは
 *    ダークモードの典型的な事故で、実際に料理提案のローディングで踏んでいる。
 *    ライト / ダークの両方で「地よりわずかに明るい帯が流れる」に見える必要があり、
 *    その 2 値は `constants/Palette.ts` が持つ。
 *
 * ✅ ベストプラクティス
 * - useNativeDriver: true（transformのみ）
 * - enabled でアニメ停止可能
 * - width/height が % の場合も破綻しないようフォールバック値あり
 * - 横/縦方向に対応
 */

export type ShimmerDirection = "horizontal" | "vertical";

interface SkeletonShimmerProps {
	/** #615【設計】表示領域サイズ */
	width: DimensionValue;
	height: DimensionValue;

	/** #615【UX】角丸（カードに合わせる） */
	borderRadius?: number;

	/** #615【UX】shimmer の方向 */
	direction?: ShimmerDirection;

	/** #615【UX】アニメーション速度（ms） */
	durationMs?: number;

	/** #615【デザイン】ベース色。#1629 未指定ならテーマの `skeletonBase` を使う */
	baseColor?: string;

	/** #615【デザイン】ハイライト色（光の中心）。#1629 未指定ならテーマの光帯をそのまま使う */
	highlightColor?: string;

	/**
	 * #615【デザイン】帯の太さ（px）
	 * - 未指定なら領域サイズから自動計算
	 */
	bandSizePx?: number;

	/** #615【パフォーマンス】不要時に停止 */
	enabled?: boolean;

	/** #615【拡張】absoluteFill 等の上書き用 */
	style?: ViewStyle;
}

/** #615【設計】数値幅が取れない（"100%" 等）ときの移動距離フォールバック */
const DEFAULT_TRAVEL_PX = 340;

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
	// #1629【デザイン】地と光帯はテーマから採る（ライトは薄グレー＋白い帯、ダークは
	// わずかに明るい面＋ごく淡い帯）。呼び出し側が明示した色があればそちらを優先する
	const { colors } = useAppTheme();
	const resolvedBaseColor = baseColor ?? colors.skeletonBase;
	// #615【設計】0→1 の進捗値を使い、translate に変換する
	const progress = useRef(new Animated.Value(0)).current;

	// #959【設計】OS の「モーションを減らす」設定が有効なときは、装飾目的のループアニメを止めて静的表示にする
	const reducedMotion = useReducedMotion();
	const shouldAnimate = enabled && !reducedMotion;

	useEffect(() => {
		// #615【パフォーマンス】enabled=false のときは停止して見た目を固定
		// #959【アクセシビリティ】reduced motion 時も同様に停止する
		if (!shouldAnimate) {
			progress.stopAnimation();
			progress.setValue(0);
			return;
		}

		// #615【UX】一定速度で流れるほうが shimmer として自然
		const anim = Animated.loop(
			Animated.timing(progress, {
				toValue: 1,
				duration: durationMs,
				easing: Easing.linear,
				useNativeDriver: true, // transformのみなのでOK
			}),
		);
		anim.start();
		return () => anim.stop();
	}, [shouldAnimate, durationMs, progress]);

	// #615【設計】移動距離（サイズが数値ならレスポンシブに算出）
	const travelDistance = useMemo(() => {
		const base = direction === "horizontal" ? width : height;
		return typeof base === "number" ? base * 0.9 : DEFAULT_TRAVEL_PX;
	}, [direction, width, height]);

	// #615【設計】0→1 を -travel → +travel に変換（端から端へ抜ける）
	const translate = progress.interpolate({
		inputRange: [0, 1],
		outputRange: [-travelDistance, travelDistance],
	});

	// #615【UX】方向に応じて translate を切り替え
	const transformStyle =
		direction === "horizontal"
			? { transform: [{ translateX: translate }] }
			: { transform: [{ translateY: translate }] };

	// #615【デザイン】帯の太さ（未指定なら領域から推定）
	const bandThickness = useMemo(() => {
		if (bandSizePx) return bandSizePx;

		const base = direction === "horizontal" ? width : height;
		// #615【UX】最低値を確保しつつ、領域に対して自然な太さにする
		if (typeof base === "number") return Math.max(96, Math.floor(base * 0.35));
		return 140;
	}, [bandSizePx, direction, width, height]);

	// #615【デザイン】帯のサイズ（横なら幅、縦なら高さ）
	const bandStyle = useMemo(() => {
		return direction === "horizontal"
			? { width: bandThickness, height: "100%" as const }
			: { width: "100%" as const, height: bandThickness };
	}, [direction, bandThickness]);

	/**
	 * #615【デザイン】光帯グラデーション
	 * - 端は透明（背景のベース色が見える）
	 * - 中央がいちばん明るい（ハイライト）
	 * - 段階を踏ませて柔らかくする（値は `colors.skeletonBandGradient`）
	 */
	const gradientColors = useMemo(() => {
		const band = colors.skeletonBandGradient;
		if (!highlightColor) return band;
		// 呼び出し側が中心色を指定したときだけ、中央の 1 段を差し替える
		return [band[0], band[1], highlightColor, band[3], band[4]] as const;
	}, [colors.skeletonBandGradient, highlightColor]);

	return (
		<View style={[styles.container, { width, height, borderRadius, backgroundColor: resolvedBaseColor }, style]}>
			{/* #615【UX】帯だけを absolute で重ねる（背景は固定でチラつかない） */}
			<Animated.View pointerEvents="none" style={[styles.bandWrap, transformStyle]}>
				<LinearGradient
					colors={gradientColors}
					// #615【UX】方向に合わせてグラデーション方向も変更
					start={{ x: 0, y: 0 }}
					end={direction === "horizontal" ? { x: 1, y: 0 } : { x: 0, y: 1 }}
					style={[styles.band, bandStyle]}
				/>
			</Animated.View>
		</View>
	);
};

const styles = StyleSheet.create({
	container: {
		overflow: "hidden",
	},
	bandWrap: {
		...StyleSheet.absoluteFillObject,
		// #615【UX】帯は中央を通る（上下左右は移動で抜ける）
		justifyContent: "center",
		alignItems: "center",
	},
	band: {
		// #615【デザイン】帯のエッジを柔らかく（角を丸めると“光”っぽくなる）
		borderRadius: 999,
		opacity: 0.95,
	},
});
