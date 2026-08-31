import { useContentWidth } from "@/hooks/useContentWidth";

/**
 * #958 【設計】トピックカード(候補カルーセル)の幅・最大高さ。
 * 従来は features/dishCategories/constants.ts が `Dimensions.get("window").width` を
 * モジュール評価時に1回だけ読んで CARD_WIDTH/CARD_MAX_HEIGHT を算出していたため、
 * リサイズに追従せず、web では CenteredAppShell が収める中央カラム幅とも一致しなかった。
 * useContentWidth() ベースで都度計算することで両方を解消する。
 *
 * #1212 【設計】既定(fullBleed未指定)は左右16pxずつの余白(合計32px)を残す。
 * DishCategoryGroupVoteVoteCard 等、カードが単体表示される画面向けの値。
 * dishCategories.tsx の候補カルーセルだけは fullBleed:true を渡し、余白ゼロ(=画面幅いっぱい)の
 * 値を使う。Carousel は style.width をカード幅・スナップ間隔の両方に使うため、
 * ここで両方 contentWidth に揃えておけば、カードは画面幅いっぱいに広がりつつ
 * スナップ位置(中央寄せ)もズレない。#1629【オーナー確定】中央のカードは等倍（scale:1）にした。
 * parallax の scale はアクティブなカードにも掛かるため、0.9 のままだと #1212 の
 * «左右の余白が無い» を満たせなかった（実測 504px / 期待 560px）。隣接カードは layout={{type:"parallax"}}
 * によるアクティブカードの縮小分(左右各5%)だけ画面端からのぞく。
 */
export function useDishCategoryCardSize(options?: { fullBleed?: boolean }) {
	const contentWidth = useContentWidth();
	const cardWidth = options?.fullBleed ? contentWidth : contentWidth - 32;
	const cardMaxHeight = (cardWidth / 9) * 16; // 16:9 のアスペクト比を維持
	return { cardWidth, cardMaxHeight };
}
