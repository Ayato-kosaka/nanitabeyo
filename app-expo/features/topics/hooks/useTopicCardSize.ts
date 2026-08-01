import { useContentWidth } from "@/hooks/useContentWidth";

/**
 * #958 【設計】トピックカード(候補カルーセル)の幅・最大高さ。
 * 従来は features/topics/constants.ts が `Dimensions.get("window").width` を
 * モジュール評価時に1回だけ読んで CARD_WIDTH/CARD_MAX_HEIGHT を算出していたため、
 * リサイズに追従せず、web では CenteredAppShell が収める中央カラム幅とも一致しなかった。
 * useContentWidth() ベースで都度計算することで両方を解消する。
 */
export function useTopicCardSize() {
	const contentWidth = useContentWidth();
	const cardWidth = contentWidth - 32;
	const cardMaxHeight = (cardWidth / 9) * 16; // 16:9 のアスペクト比を維持
	return { cardWidth, cardMaxHeight };
}
