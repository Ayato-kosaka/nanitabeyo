import type { RefObject } from "react";
import type { View } from "react-native";

/**
 * スポットライトで指し示す実UIの識別子。
 *
 * 文字列を画面側とチュートリアル側で共有することで、
 * 座標の渡し間違いや「吹き出しだけ表示される」事故を型で防ぐ。
 */
export type TopicsTutorialTargetKey = "swipeArea" | "selectCta" | "deepDive" | "topicActions" | "groupVote";

/**
 * 各ターゲットのネイティブView参照。
 *
 * measureInWindow() が必要なため、TouchableOpacityそのものではなく
 * collapsable={false} を指定したViewを登録する。
 */
export type TopicsTutorialTargetRefs = Record<TopicsTutorialTargetKey, RefObject<View | null>>;

/** チュートリアルを開いた経路。分析ログでも同じ値を利用する。 */
export type TopicsTutorialOpenReason = "auto" | "manual";

/** measureInWindow() で取得した、画面左上基準の矩形。 */
export type TopicsTutorialRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

/** 吹き出しを優先して置きたい方向。収まらない場合は自動で反対側へ退避する。 */
export type TopicsTutorialPlacement = "above" | "below";

/** 1ステップ分の不変な表示定義。 */
export type TopicsTutorialStepDefinition = {
	id: "swipeAndDecide" | "deepDive" | "topicActions" | "groupVote";
	targetKeys: readonly TopicsTutorialTargetKey[];
	titleKey: string;
	bodyKeys: readonly string[];
	preferredPlacement: TopicsTutorialPlacement;
	optional?: boolean;
};
