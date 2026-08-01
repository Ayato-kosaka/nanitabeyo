export type TravelMode = "walk" | "bike" | "car" | "train";

export interface TravelTimeEstimate {
	mode: TravelMode;
	minutes: number;
	isRecommended: boolean;
}

interface TravelModeRule {
	mode: TravelMode;
	fixedMinutes: number;
	speedKmh: number;
	recommendedMinMeters: number;
	recommendedMaxMeters: number;
	order: number;
}

const MINUTES_PER_HOUR = 60;
const METERS_PER_KILOMETER = 1000;
export const MAX_RECOMMENDED_TRAVEL_MODES = 2;

// #987 【仕様】国土交通省の一般化所要時間モデルと距離帯別交通実態を、既存の距離プリセットへ対応させる
// https://www.mlit.go.jp/sogoseisaku/soukou/soukou-magazine/rennraku7.1.pdf
// https://www.mlit.go.jp/common/001292044.pdf
// https://www.mlit.go.jp/common/001156467.pdf
const TRAVEL_MODE_RULES = [
	{
		mode: "walk",
		fixedMinutes: 0,
		speedKmh: 4.8,
		recommendedMinMeters: 0,
		recommendedMaxMeters: 2000,
		order: 0,
	},
	{
		mode: "bike",
		fixedMinutes: 4,
		speedKmh: 15,
		recommendedMinMeters: 500,
		recommendedMaxMeters: 5000,
		order: 1,
	},
	{
		mode: "car",
		fixedMinutes: 7,
		speedKmh: 17.5,
		recommendedMinMeters: 5000,
		recommendedMaxMeters: Number.POSITIVE_INFINITY,
		order: 2,
	},
	{
		mode: "train",
		fixedMinutes: 17,
		speedKmh: 32,
		recommendedMinMeters: 10000,
		recommendedMaxMeters: Number.POSITIVE_INFINITY,
		order: 3,
	},
] as const satisfies readonly TravelModeRule[];

/**
 * 検索半径の端までの一般化所要時間を、短い順で返す。
 *
 * 入力: 検索半径（メートル）。負値は0mとして扱う。
 * 出力: 交通手段、切り上げ後の分数、距離帯に基づくおすすめ可否。
 * 副作用: なし。
 */
export function getTravelTimeEstimates(distanceMeters: number): TravelTimeEstimate[] {
	const normalizedDistanceMeters = Math.max(0, distanceMeters);

	return TRAVEL_MODE_RULES.map((rule) => ({
		mode: rule.mode,
		// #987 【実装】kmへ先に変換すると整数分の境界で丸め誤差が出るため、メートルのまま計算する
		minutes: Math.ceil(
			rule.fixedMinutes +
				(normalizedDistanceMeters * MINUTES_PER_HOUR) / (METERS_PER_KILOMETER * rule.speedKmh),
		),
		isRecommended:
			normalizedDistanceMeters >= rule.recommendedMinMeters &&
			normalizedDistanceMeters <= rule.recommendedMaxMeters,
	})).sort((left, right) => {
		if (left.minutes !== right.minutes) return left.minutes - right.minutes;
		const leftOrder = TRAVEL_MODE_RULES.find((rule) => rule.mode === left.mode)?.order ?? 0;
		const rightOrder = TRAVEL_MODE_RULES.find((rule) => rule.mode === right.mode)?.order ?? 0;
		return leftOrder - rightOrder;
	});
}

/**
 * 距離帯に適した交通手段を、所要時間が短い順で最大2件返す。
 *
 * 入力: 検索半径（メートル）。
 * 出力: おすすめ対象の所要時間。対象が無い場合は全手段の上位を返す。
 * 副作用: なし。
 */
export function getRecommendedTravelTimeEstimates(distanceMeters: number): TravelTimeEstimate[] {
	const estimates = getTravelTimeEstimates(distanceMeters);
	const recommended = estimates.filter((estimate) => estimate.isRecommended);
	return (recommended.length > 0 ? recommended : estimates).slice(0, MAX_RECOMMENDED_TRAVEL_MODES);
}
