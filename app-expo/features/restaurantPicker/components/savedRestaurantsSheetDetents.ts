export const CARD_HEIGHT = 100;

// カード 1 枚 + タイトル + ちょい余白分をスクリーン比から計算する
const CARD_AREA_HEIGHT = CARD_HEIGHT + 24; // カード + margin ちょい
const TITLE_AREA_HEIGHT = 40;
const TOP_PADDING = 12;
const BOTTOM_PADDING = 0;

// 使いたい見た目の高さ = 上マージン + タイトル + カード + 下マージン
export const SMALL_DETENT_HEIGHT = TOP_PADDING + TITLE_AREA_HEIGHT + CARD_AREA_HEIGHT + BOTTOM_PADDING;

export const LARGE_DETENT = 0.7;

/**
 * #1074 native で回転するとウィンドウ高さが変わりうる（web のリサイズ、Android の分割画面・
 * フリーフォーム、OS が orientation 指定を無視する大画面デバイスなど）ため、`SMALL_DETENT` を
 * モジュール評価時の固定値ではなく `useWindowDimensions()` の高さから算出する。
 */
export function computeSmallDetent(windowHeight: number): number {
	// windowHeight が 0 や非有限値になる瞬間があり得るので、その場合は clamp 上限をそのまま使う
	return Number.isFinite(windowHeight) && windowHeight > 0 ? Math.min(SMALL_DETENT_HEIGHT / windowHeight, 0.5) : 0.5;
}
