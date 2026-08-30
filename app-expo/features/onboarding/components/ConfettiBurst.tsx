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
import { FixedColors } from "@/constants/Palette";
import Animated, {
	Easing,
	useAnimatedStyle,
	useSharedValue,
	withDelay,
	withRepeat,
	withSequence,
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
/** 落下の強さ（進捗の 2 乗に掛かる px 数） */
const GRAVITY_PX = 300;

/**
 * 1 周期の長さ。最終検収で «1 回で終わらせず無限ループに» が確定した。
 *
 * 最も遅い粒（delay 720+140ms + duration 2000ms = 2860ms）が舞い終わってから
 * ひと呼吸置いて次の «パンパンパン» が始まるよう、少し余白を持たせてある。
 * ⚠️ 全粒でこの共通周期に揃えること。粒ごとの周期（delay+duration）でループさせると
 * 位相がずれていき、バーストの「パンッ」というまとまりが数周で溶けて消える。
 */
const CYCLE_MS = 3400;

/**
 * 紙片の形。長方形だけだと «単調»（デザインレビューで指摘）なので、
 * 見本のように 丸 / 紙片 / 細長いリボン を混ぜる
 */
type PieceShape = "circle" | "rect" | "ribbon";
const SHAPES: readonly PieceShape[] = ["rect", "circle", "ribbon", "rect", "circle", "rect", "ribbon"];

/**
 * 紙片の色。プロジェクト標準のブランド色を軸に、明度差のある差し色を混ぜたもの。
 *
 * #1629 テーマ非追従（`FixedColors`）にしてある。紙吹雪は情報を持たない純粋な装飾で、
 * «パーティの紙片» という見立て自体が意味なので、ライト / ダークで 2 セット持つ理由が無い。
 * 根拠は constants/Palette.ts の `FixedColors.confettiPieces` のコメント。
 */
const PIECE_COLORS = FixedColors.confettiPieces;

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
	shape: PieceShape;
	width: number;
	height: number;
	delayMs: number;
	/** 粒ごとに飛ぶ速さを変える（全員が同時に着地すると板のように見える） */
	durationMs: number;
	/** ひらひら（横揺れ）の位相と振幅。0 だと直線的に落ちて紙に見えない */
	swayPhase: number;
	swayAmp: number;
};

const buildPieces = (): PieceConfig[] =>
	BURSTS.flatMap((burst, burstIndex) =>
		Array.from({ length: PIECES_PER_BURST }, (_, i) => {
			const index = burstIndex * PIECES_PER_BURST + i;
			const spread = scatter(index, 0);
			const reach = scatter(index, 1);
			const spin = scatter(index, 2);
			const shape = scatter(index, 3);

			const pieceShape = SHAPES[index % SHAPES.length];
			// 形ごとの基本サイズ。リボンは細長く、丸は小さめ、紙片は中くらい
			const size =
				pieceShape === "ribbon"
					? { width: 5 + shape * 3, height: 22 + shape * 12 }
					: pieceShape === "circle"
						? { width: 8 + shape * 5, height: 8 + shape * 5 }
						: { width: 8 + shape * 6, height: 12 + shape * 8 };

			return {
				burst,
				// クラッカーらしく «上向き» を中心に大きく扇状へ。左右の端のバーストも
				// 同じ扇を使い、発射点の位置差でばらけて見える
				angleRad: (-170 + spread * 160) * (Math.PI / 180),
				distance: 130 + reach * 190,
				spinDeg: (spin < 0.5 ? -1 : 1) * (220 + spin * 620),
				color: PIECE_COLORS[index % PIECE_COLORS.length],
				shape: pieceShape,
				...size,
				// バースト内でも数十 ms ずらして «一枚の板» に見えないようにする
				delayMs: burst.delayMs + Math.round(spread * 140),
				// 速い粒と遅い粒を混ぜる（1.35〜2.0 秒）
				durationMs: 1350 + Math.round(reach * 650),
				swayPhase: spin * Math.PI * 2,
				swayAmp: 8 + shape * 14,
			};
		}),
	);

function ConfettiPiece({ config }: { config: PieceConfig }) {
	const progress: SharedValue<number> = useSharedValue(0);

	useEffect(() => {
		// 舞い終わった粒（t=1 で opacity 0）は周期の残り時間だけ待ち、瞬時に 0 へ戻って次の周へ。
		// 全粒が CYCLE_MS の共通周期を持つので、バーストのリズムは何周しても崩れない
		const restMs = Math.max(0, CYCLE_MS - config.delayMs - config.durationMs);
		progress.value = withRepeat(
			withSequence(
				withDelay(
					config.delayMs,
					withTiming(1, {
						duration: config.durationMs,
						// 出だしが速く、飛んだ先で減速する。`パンッ` はこの立ち上がりの速さで決まる
						easing: Easing.out(Easing.quad),
					}),
				),
				withDelay(restMs, withTiming(0, { duration: 1 })),
			),
			-1,
			false,
		);
	}, [config.delayMs, config.durationMs, progress]);

	const animatedStyle = useAnimatedStyle(() => {
		const t = progress.value;
		// ひらひら（横揺れ）。落ちながら左右に振れることで紙らしく見える
		const sway = Math.sin(t * 9 + config.swayPhase) * config.swayAmp * t;
		// 紙片が面を返す «めくれ»。丸には掛けない（回しても見た目が変わらない）
		const flip = config.shape === "circle" ? 1 : 0.35 + Math.abs(Math.sin(t * 7 + config.swayPhase)) * 0.65;

		return {
			opacity: t === 0 ? 0 : 1 - Math.max(0, (t - 0.7) / 0.3),
			transform: [
				{ translateX: Math.cos(config.angleRad) * config.distance * t + sway },
				{ translateY: Math.sin(config.angleRad) * config.distance * t + GRAVITY_PX * t * t },
				{ rotate: `${config.spinDeg * t}deg` },
				{ scaleY: flip },
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
					// 丸は正円、リボンは端まで丸め、紙片は角を少しだけ落とす
					borderRadius: config.shape === "circle" ? config.width / 2 : config.shape === "ribbon" ? 3 : 2,
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
