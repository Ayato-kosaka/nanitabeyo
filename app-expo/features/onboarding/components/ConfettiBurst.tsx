/*
このファイルの責務
- Welcome 画面（#1486 §7）の「クラッカー / 紙吹雪が `パンッ` と出る」演出を描く。

## なぜライブラリを足さないのか

紙吹雪ライブラリ（react-native-confetti-cannon 等）は依存を 1 つ増やすわりに、
この画面でしか使わない。Lottie という手もあるが、リポジトリにある Lottie は
`assets/lottie/DualBall.json`（ローディング）1 つだけで、色をプロジェクト標準へ
合わせるには JSON を直接編集することになる。

必要なのは «中心から放射状に飛ぶ紙片» だけなので、既に入っている
react-native-reanimated で組む。粒の軌道は 1 本の共有進捗値から計算するため、
JS スレッドを跨ぐ更新は起こらない（各粒が個別に setState する実装ではない）。

## 決定的な «ランダム»

粒の角度・距離・色は `Math.random()` ではなく添字から決めている。
乱数だと「たまたま全部が右下へ飛ぶ」当たりを引いたときに再現できず、
スナップショットやスクリーンショットの比較も安定しない。
*/
import React, { useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
	Easing,
	useAnimatedStyle,
	useSharedValue,
	withDelay,
	withTiming,
	type SharedValue,
} from "react-native-reanimated";

/** 紙片の枚数。多すぎると低性能端末で落ちるので «パンッ» が成立する最小限にとどめる */
const PIECE_COUNT = 28;
/** 飛び散りきるまでの時間 */
const BURST_DURATION_MS = 1500;
/** 落下の強さ（進捗の 2 乗に掛かる px 数） */
const GRAVITY_PX = 260;

/** プロジェクト標準色（#F05537）を軸に、明度差のある差し色を混ぜる */
const PIECE_COLORS = ["#F05537", "#FFB03A", "#FFE066", "#4ECDC4", "#8E7DFF", "#FF8FA3"];

/**
 * 添字から決定的に «ばらけた» 0〜1 の値を作る。
 *
 * 黄金比の小数部を足していく低食い違い列（Weyl 列）。連番を入れても値が固まらず、
 * 乱数のように見えて完全に再現できる。
 */
const scatter = (index: number, seed: number): number => {
	const value = (index + 1) * 0.6180339887498949 + seed * 0.3819660112501051;
	return value - Math.floor(value);
};

type PieceConfig = {
	angleRad: number;
	distance: number;
	spinDeg: number;
	color: string;
	width: number;
	height: number;
	delayMs: number;
};

const buildPieces = (): PieceConfig[] =>
	Array.from({ length: PIECE_COUNT }, (_, index) => {
		const spread = scatter(index, 0);
		const reach = scatter(index, 1);
		const spin = scatter(index, 2);
		const shape = scatter(index, 3);

		return {
			// 上向き（-90°）を中心に扇状へ広げる。クラッカーは «上へ» 弾けるため、
			// 全方位へ均等に飛ばすと «爆発» に見えて祝いの絵にならない
			angleRad: (-150 + spread * 120) * (Math.PI / 180),
			distance: 120 + reach * 130,
			spinDeg: (spin < 0.5 ? -1 : 1) * (180 + spin * 540),
			color: PIECE_COLORS[index % PIECE_COLORS.length],
			width: 6 + shape * 5,
			height: 10 + shape * 6,
			// 全部を同時に出すと «一枚の板» が飛ぶように見える。数十 ms ずらして «パンッ» の粒感を出す
			delayMs: Math.round(spread * 120),
		};
	});

function ConfettiPiece({ config, progress }: { config: PieceConfig; progress: SharedValue<number> }) {
	const animatedStyle = useAnimatedStyle(() => {
		const t = progress.value;

		return {
			opacity: t === 0 ? 0 : 1 - Math.max(0, (t - 0.65) / 0.35),
			transform: [
				{ translateX: Math.cos(config.angleRad) * config.distance * t },
				{ translateY: Math.sin(config.angleRad) * config.distance * t + GRAVITY_PX * t * t },
				{ rotate: `${config.spinDeg * t}deg` },
				// 出た瞬間だけ少し大きく見せる（«弾ける» 感じ）
				{ scale: t < 0.15 ? 0.6 + t * 2.6 : 1 },
			],
		};
	});

	return (
		<Animated.View
			style={[
				styles.piece,
				{ backgroundColor: config.color, width: config.width, height: config.height },
				animatedStyle,
			]}
		/>
	);
}

export type ConfettiBurstProps = {
	/** OS の「モーションを減らす」設定。true なら紙吹雪そのものを出さない */
	reducedMotion: boolean;
	testID?: string;
};

/**
 * 中心から紙吹雪を 1 回だけ弾けさせる。親の中央に絶対配置される。
 *
 * #959 モーションを減らす設定では **何も描かない**。
 * 紙吹雪は情報を持たない純粋な装飾なので、静止画として残す価値も無い。
 */
export function ConfettiBurst({ reducedMotion, testID }: ConfettiBurstProps) {
	const progress = useSharedValue(0);
	const pieces = useMemo(buildPieces, []);

	useEffect(() => {
		if (reducedMotion) return;

		progress.value = withDelay(
			120,
			withTiming(1, {
				duration: BURST_DURATION_MS,
				// 出だしが速く、飛んだ先で減速する。`パンッ` はこの立ち上がりの速さで決まる
				easing: Easing.out(Easing.quad),
			}),
		);
	}, [reducedMotion, progress]);

	if (reducedMotion) return null;

	return (
		<View style={styles.container} pointerEvents="none" testID={testID} aria-hidden>
			{pieces.map((config, index) => (
				<ConfettiPiece key={index} config={config} progress={progress} />
			))}
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		...StyleSheet.absoluteFillObject,
		alignItems: "center",
		justifyContent: "center",
	},
	piece: {
		position: "absolute",
		borderRadius: 2,
	},
});
