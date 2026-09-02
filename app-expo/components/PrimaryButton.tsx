import React, { memo, ReactElement, useCallback } from "react";
import {
	ActivityIndicator,
	ColorValue,
	GestureResponderEvent,
	Pressable,
	PressableStateCallbackType,
	StyleProp,
	StyleSheet,
	Text,
	TextStyle,
	ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useHaptics } from "@/hooks/useHaptics";
import { LoadingIndicator } from "./LoadingIndicator";
import { FixedColors } from "@/constants/Palette";
import { useAppTheme } from "@/contexts/ThemeProvider";

export interface PrimaryButtonProps {
	/** 表示テキスト */
	label: string;
	/** 押下時のコールバック */
	onPress: (event: GestureResponderEvent) => void;
	/** 左側に表示するアイコン要素 (例: <ThumbsUp size={20} color={FixedColors.onFilled} />) */
	icon?: ReactElement;
	/** グラデーション用カラー配列。未指定ならブランド色の単色（#1629 テーマの `brand`） */
	colors?: readonly [ColorValue, ColorValue, ...ColorValue[]];
	/** 影の色 */
	shadowColor?: ColorValue;
	/** 角丸 */
	borderRadius?: number;
	/** 読み込み状態でインジケータ表示 */
	loading?: boolean;
	/**
	 * ローディングインジケータの種類
	 * - "custom": 既定値。オレンジ色の Lottie アニメーションを使用（通常はこちらを利用）
	 * - "native": React Native の ActivityIndicator を使用（背景色が明るく custom が視認しづらい既存ボタン向けの後方互換用）
	 */
	loadingIndicatorType?: "custom" | "native";
	/**
	 * loadingIndicatorType="native" のときの ActivityIndicator の色。
	 * 明るい背景色ボタンでインジケータが見えづらい場合のみ指定する想定。未指定なら label の色に近い色を自動採用。
	 */
	nativeLoadingColor?: ColorValue;
	/** 無効化 */
	disabled?: boolean;
	/** 外側（影・角丸含む）用スタイル */
	style?: StyleProp<ViewStyle>;
	/** グラデ枠内（行揃え・パディング等）追加スタイル */
	contentStyle?: StyleProp<ViewStyle>;
	/** テキストスタイル追加 */
	labelStyle?: StyleProp<TextStyle>;
	/** testID / a11y */
	testID?: string;
	/** アクセシビリティラベル */
	accessibilityLabel?: string;
}

const PrimaryButtonComponent: React.FC<PrimaryButtonProps> = ({
	label,
	onPress,
	icon,
	colors: colorsProp,
	shadowColor = "transparent",
	borderRadius = 8,
	loading = false,
	loadingIndicatorType = "custom", // ✅ デフォルト
	nativeLoadingColor,
	disabled = false,
	style,
	contentStyle,
	labelStyle,
	testID,
	accessibilityLabel,
}) => {
	const isDisabled = disabled || loading;
	const { lightImpact } = useHaptics();
	// #1629【デザイン】既定のグラデーションはブランド色（ライト / ダークとも同値なので
	// 見た目は変わらない）。無効時の色差し替えは呼び出し側が colors で行う（下の disabled 参照）
	const { colors: themeColors } = useAppTheme();
	const colors = colorsProp ?? ([themeColors.brand, themeColors.brand] as const);

	const handlePress = useCallback(
		(e: GestureResponderEvent) => {
			if (!isDisabled) {
				lightImpact();
				onPress(e);
			}
		},
		[onPress, isDisabled, lightImpact],
	);

	const getWrapperStyle = useCallback(
		({ pressed }: PressableStateCallbackType) => [
			styles.wrapper,
			{
				// 影
				shadowColor,
				shadowOffset: { width: 0, height: 0 },
				shadowOpacity: 0.4,
				shadowRadius: 32,
				elevation: 12,
			},
			{ borderRadius },
			pressed && !isDisabled && styles.pressed,
			isDisabled && styles.disabled,
			style,
		],
		[style, borderRadius, isDisabled],
	);

	// #1136 【設計】ボタン内スピナーの testID。web は LoadingIndicator が出す `role="status"` で
	// 特定できるが、ネイティブには相当する手掛かりが無く「投稿中かどうか」を Detox から観測できない。
	// 呼び出し側が testID を渡しているボタンでだけ `${testID}-loading` を派生させる（見た目は変わらない）。
	const loadingTestID = testID ? `${testID}-loading` : undefined;

	const renderLoading = () => {
		if (!loading) return null;

		if (loadingIndicatorType === "native") {
			const flattenedLabelStyle = StyleSheet.flatten(labelStyle) as TextStyle | undefined;
			// #1629 塗り潰した面の上のインジケータなので、label と同じ固定の白へ倒す
			const defaultNativeColor = flattenedLabelStyle?.color ?? FixedColors.onFilled;
			return (
				<ActivityIndicator size={"small"} color={nativeLoadingColor ?? defaultNativeColor} testID={loadingTestID} />
			);
		}
		return <LoadingIndicator size="small" testID={loadingTestID} />;
	};

	return (
		<Pressable
			accessibilityRole="button"
			// #930 【仕様】react-native-web は disabled prop からのみ aria-disabled を生成し、
			// accessibilityState.disabled だけでは DOM 上「有効なボタン」に見えてしまう。
			// disabled を渡すことで見た目(opacity)と実際の操作可否・支援技術への伝達を一致させる。
			disabled={isDisabled}
			accessibilityState={{ disabled: isDisabled, busy: loading }}
			accessibilityLabel={accessibilityLabel ?? label}
			testID={testID}
			onPress={handlePress}
			style={getWrapperStyle}
			android_ripple={{ color: "rgba(255,255,255,0.12)", borderless: true }}>
			<LinearGradient colors={colors} style={[styles.gradient, { borderRadius }, contentStyle]}>
				<>
					{renderLoading() ?? icon}
					<Text style={[styles.label, labelStyle]}>{label}</Text>
				</>
			</LinearGradient>
		</Pressable>
	);
};

export const PrimaryButton = memo(PrimaryButtonComponent);

const styles = StyleSheet.create({
	wrapper: {
		overflow: "hidden",
	},
	gradient: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		paddingVertical: 10,
		paddingHorizontal: 16,
		gap: 12,
	},
	pressed: {
		opacity: 0.8,
	},
	/*
	#1375（5 巡目・デザインレビュー #4）**opacity で無効を表さない。**

	ブランドの赤 + 白文字に 0.4 を掛けると赤が淡いサーモンまで飛び、
	コントラスト比が約 1.7:1 まで落ちて **文字がほぼ読めない**（「食べたいに保存」
	「レビューを投稿する」で実測）。参照実装の検索画面は disabled にせず
	**色だけ差し替えて**いる（`colors.ctaBackgroundDisabled` の灰、約 2.9:1）。

	ここは «押せない» を色で示しつつ文字は読めるままにするため、
	透過を弱く（0.4 → 0.75）し、呼び出し側は無効時に
	`colors={[colors.ctaBackgroundDisabled, colors.ctaBackgroundDisabled]}` を渡す。
	*/
	disabled: {
		opacity: 0.75,
	},
	label: {
		fontSize: 16,
		fontWeight: "700",
		// #1629 このボタンは常に «濃い色で塗り潰した面» なので、文字はテーマで振らず固定の白
		//（ライトで黒にすると、ブランド色の赤の上で読めなくなる）
		color: FixedColors.onFilled,
		letterSpacing: 0.5,
	},
});
