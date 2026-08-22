/*
このファイルの責務
- Welcome 画面（#1486 §7）の「クラッカー / 紙吹雪が `パンッ` と出る」演出を描く。

## なぜライブラリを足さないのか

紙吹雪ライブラリ（react-native-confetti-cannon 等）は依存を 1 つ増やすわりに、
この画面でしか使わない。Lottie という手もあるが、リポジトリにある Lottie は
`assets/lottie/DualBall.json`（ローディング）1 つだけで、色をプロジェクト標準へ
合わせるには JSON を直接編集することになる。

必要なのは «弾けて舞う紙片» だけなので、既に入っている react-native-reanimated で組む。
粒の軌道は 1 本の共有進捗値から計算するため、JS スレッドを跨ぐ更新は起こらない
（各粒が個別に setState する実装ではない）。

## 見せ方（デザインレビューで «もっと派手に» が確定）

- **画面全体**に散らす。ロゴの上に被ってよい（親が絶対配置で全面に敷く）
- 1 回のバーストではなく、**位置と時間をずらした複数のバースト**（パンッ、パンッ、パンッ）
- 各バーストの発射点は画面上部寄りの 3 箇所。紙片は扇状に飛んで重力で落ちる

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

/** バーストの発射点（画面に対する % 位置）と開始遅延。パン、パン、パンのリズム */
const BURSTS = [
	{ leftPct: 50, topPct: 30, delayMs: 120 },
	{ leftPct: 22, topPct: 18, delayMs: 420 },
	{ leftPct: 78, topPct: 22, delayMs: 720 },
] as const;

/** 1 バーストあたりの紙片の枚数。3 バーストで計 84 枚 */
const PIECES_PER_BURST = 28;
/** 1 バーストが飛び散りきるまでの時間 */
const BURST_DURATION_MS = 1600;
/** 落下の強さ（進捗の 2 乗に掛かる px 数） */
const GRAVITY_PX = 300;

/** プロジェクト標準色（#F05537）を軸に、明度差のある差し色を混ぜる */
const PIECE_COLORS = ["#F05537", "#FFB03A", "#FFE066", "#4ECDC4", "#8E7DFF", "#FF8FA3", "#3BC46A"];

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
	burst: (typeof BURSTS)[number];
	angleRad: number;
	distance: number;
	spinDeg: number;
	color: string;
	width: number;
	height: number;
	delayMs: number;
};

const buildPieces = (): PieceConfig[] =>
	BURSTS.flatMap((burst, burstIndex) =>
		Array.from({ length: PIECES_PER_BURST }, (_, i) => {
			const index = burstIndex * PIECES_PER_BURST + i;
			const spread = scatter(index, 0);
			const reach = scatter(index, 1);
			const spin = scatter(index, 2);
			const shape = scatter(index, 3);

			return {
				burst,
				// クラッカーらしく «上向き» を中心に大きく扇状へ。左右の端のバーストも
				// 同じ扇を使い、発射点の位置差でばらけて見える
				angleRad: (-170 + spread * 160) * (Math.PI / 180),
				distance: 130 + reach * 190,
				spinDeg: (spin < 0.5 ? -1 : 1) * (220 + spin * 620),
				color: PIECE_COLORS[index % PIECE_COLORS.length],
				width: 7 + shape * 5,
				height: 11 + shape * 7,
				// バースト内でも数十 ms ずらして «一枚の板» に見えないようにする
				delayMs: burst.delayMs + Math.round(spread * 140),
			};
		}),
	);

function ConfettiPiece({ config }: { config: PieceConfig }) {
	const progress: SharedValue<number> = useSharedValue(0);

	useEffect(() => {
		progress.value = withDelay(
			config.delayMs,
			withTiming(1, {
				duration: BURST_DURATION_MS,
				// 出だしが速く、飛んだ先で減速する。`パンッ` はこの立ち上がりの速さで決まる
				easing: Easing.out(Easing.quad),
			}),
		);
	}, [config.delayMs, progress]);

	const animatedStyle = useAnimatedStyle(() => {
		const t = progress.value;

		return {
			opacity: t === 0 ? 0 : 1 - Math.max(0, (t - 0.7) / 0.3),
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
				{
					left: `${config.burst.leftPct}%`,
					top: `${config.burst.topPct}%`,
					backgroundColor: config.color,
					width: config.width,
					height: config.height,
				},
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
 * 画面全体へ紙吹雪を弾けさせる。**親の全面に絶対配置される**ので、
 * ロゴやテキストの上へ被せたい階層（それらの後）に置くこと。
 *
 * #959 モーションを減らす設定では **何も描かない**。
 * 紙吹雪は情報を持たない純粋な装飾なので、静止画として残す価値も無い。
 */
export function ConfettiBurst({ reducedMotion, testID }: ConfettiBurstProps) {
	const pieces = useMemo(buildPieces, []);

	if (reducedMotion) return null;

	return (
		<View style={StyleSheet.absoluteFill} pointerEvents="none" testID={testID} aria-hidden>
			{pieces.map((config, index) => (
				<ConfettiPiece key={index} config={config} />
			))}
		</View>
	);
}

const styles = StyleSheet.create({
	piece: {
		position: "absolute",
		borderRadius: 2,
	},
});
