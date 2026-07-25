import React, { useEffect, useMemo, useRef } from "react";
import { View, StyleSheet, Animated, Easing, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { DimensionValue } from "react-native";
import { useReducedMotion } from "@/hooks/useReducedMotion";

/**
 * SkeletonShimmer（iOSっぽい見た目）
 * ------------------------------------------------------------
 * #615【UX】画像ロード中の視認性を安定させるため、iOS風のスケルトン（グレー地＋白い光帯）を表示
 *
 * ✅ iOSっぽさのポイント
 * - ベース：やや青みのある薄グレー（iOSのプレースホルダーに近いトーン）
 * - 光帯：白〜半透明のグラデーション（端は透明で“光”に見せる）
 * - 動くのは「帯」だけ（面全体が動く/明滅しない）
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

	/** #615【デザイン】iOS風ベース色（固定背景） */
	baseColor?: string;

	/** #615【デザイン】iOS風ハイライト色（光の中心） */
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
	// #615【デザイン】iOSっぽい薄グレー（白背景でも沈みすぎない）
	baseColor = "#E9ECEF",
	// #615【デザイン】光帯は白（中心が白いほうが “iOS感” が出る）
	highlightColor = "#FFFFFF",
	bandSizePx,
	enabled = true,
	style,
}) => {
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
	 * - 中央は白（ハイライト）
	 * - iOSっぽくするため「白の透明度」を段階にして柔らかくする
	 */
	const gradientColors = useMemo(() => {
		// NOTE: expo-linear-gradient は alpha 付き色指定OK
		return [
			"rgba(255,255,255,0.0)",
			"rgba(255,255,255,0.25)",
			highlightColor,
			"rgba(255,255,255,0.25)",
			"rgba(255,255,255,0.0)",
		] as const;
	}, [highlightColor]);

	return (
		<View style={[styles.container, { width, height, borderRadius, backgroundColor: baseColor }, style]}>
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
