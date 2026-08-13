import { ViewStyle } from "react-native";

export type LoadingIndicatorSize = "small" | "large";

export type LoadingIndicatorProps = {
	/** サイズバリエーション (デフォルト: "large") */
	size?: LoadingIndicatorSize;
	/** 追加スタイル */
	style?: ViewStyle | ViewStyle[];
	/** Web 用アクセシビリティラベル（指定がなければ "Loading" をデフォルトとする） */
	accessibilityLabel?: string;
	/**
	 * E2E 用の testID（#1136）。
	 *
	 * web は `role="status"` から Playwright で特定できるが、ネイティブには相当する手掛かりが無く
	 * 「ローディング中かどうか」を Detox から観測できなかった。指定された場合のみコンテナ View へ付与する
	 * （既定は undefined。付けても見た目・レイアウトは変わらない）。
	 */
	testID?: string;
};

// #690 【設計】サイズマップ - small: 24px, large: 48px
export const SIZE_MAP: Record<LoadingIndicatorSize, number> = {
	small: 24,
	large: 48,
};

export const dualBallLottie = require("@/assets/lottie/DualBall.json");
