import { ViewStyle } from "react-native";

export type LoadingIndicatorSize = "small" | "large";

export type LoadingIndicatorProps = {
    /** サイズバリエーション (デフォルト: "large") */
    size?: LoadingIndicatorSize;
    /** 追加スタイル */
    style?: ViewStyle | ViewStyle[];
    /** Web 用アクセシビリティラベル（指定がなければ "Loading" をデフォルトとする） */
    accessibilityLabel?: string;
};

// #690 【設計】サイズマップ - small: 24px, large: 48px
export const SIZE_MAP: Record<LoadingIndicatorSize, number> = {
    small: 24,
    large: 48,
};

export const dualBallLottie = require("@/assets/lottie/DualBall.json")