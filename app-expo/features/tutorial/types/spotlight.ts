import type { RefObject } from "react";
import type { View } from "react-native";

/*
スポットライト型チュートリアルの共有型。

## なぜ «画面ごと» ではなく共有なのか

料理提案画面（#927）で作った «実 UI の位置を指すスポットライト» は、
測定・マスク・吹き出しの退避・進捗表示まで含めて 900 行ある。#1375 で my-dishes にも
同じ形の案内が要ることになったので、**画面固有なのはステップ定義だけ**に切り出した。

画面ごとに違うのは 3 つだけである。
- どの UI を指すか（`targetKeys` と、画面側が登録する ref）
- 何を説明するか（`titleKey` / `bodyKeys`）
- 保存キー（どのチュートリアルを見たか）

それ以外（座標の測り直し・画面外への退避・アニメーション・読み上げ）は共有する。
*/

/**
 * スポットライトで指し示す実 UI の識別子。
 *
 * 文字列を画面側とチュートリアル側で共有することで、
 * 座標の渡し間違いや「吹き出しだけ表示される」事故を型で防ぐ。
 * 画面ごとに独自の union を定義してこの型引数へ渡すこと。
 */
export type SpotlightTargetRefs<K extends string> = Record<K, RefObject<View | null>>;

/** チュートリアルを開いた経路。分析ログでも同じ値を利用する。 */
export type SpotlightOpenReason = "auto" | "manual";

/** measureInWindow() で取得した、画面左上基準の矩形。 */
export type SpotlightRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

/** 吹き出しを優先して置きたい方向。収まらない場合は自動で反対側へ退避する。 */
export type SpotlightPlacement = "above" | "below";

/** 1ステップ分の不変な表示定義。 */
export type SpotlightStepDefinition<K extends string> = {
	id: string;
	targetKeys: readonly K[];
	titleKey: string;
	bodyKeys: readonly string[];
	preferredPlacement: SpotlightPlacement;
	/** 条件付きで出すステップ（画面側が `visibleStepIds` で落とす） */
	optional?: boolean;
};

// ───────── 料理提案画面（#927）の別名。既存の呼び出し元を壊さないために残す ─────────
// #1553 «topic» という表現をアプリ内から消したため、別名も DishCategories 系へ揃えた。

export type DishCategoriesTutorialTargetKey =
	| "swipeArea"
	| "selectCta"
	| "deepDive"
	| "dishCategoryActions"
	| "groupVote";
export type DishCategoriesTutorialTargetRefs = SpotlightTargetRefs<DishCategoriesTutorialTargetKey>;
export type DishCategoriesTutorialOpenReason = SpotlightOpenReason;
export type DishCategoriesTutorialRect = SpotlightRect;
export type DishCategoriesTutorialPlacement = SpotlightPlacement;
export type DishCategoriesTutorialStepDefinition = SpotlightStepDefinition<DishCategoriesTutorialTargetKey>;
