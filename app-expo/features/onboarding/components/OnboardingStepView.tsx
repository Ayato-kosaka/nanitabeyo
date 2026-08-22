/*
このファイルの責務
- オンボーディング 1 ページ分の «見た目» を描く（#1486 §1）。
- 「課題フェーズ → 解決フェーズ」の切り替えアニメーションを持つ。

ページ送り・タイマー・遷移は持たない。それらは app/[locale]/onboarding/index.tsx の責務。
このコンポーネントは `phase` を受け取って描くだけなので、フェーズを外から与えれば
どの状態でもそのまま描画できる（= 戻ったときに課題状態から再生し直せる）。
*/
import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { SOLUTION_OVERLAY_COLOR, SOLUTION_REVEAL_DURATION_MS, type OnboardingStepConst } from "../constants";

export type OnboardingPhase = "problem" | "solution";

export type OnboardingStepViewProps = {
	step: OnboardingStepConst;
	/** 課題文（i18n 済み） */
	problemText: string;
	/** 解決文（i18n 済み） */
	solutionText: string;
	phase: OnboardingPhase;
	/** OS の「モーションを減らす」設定。true なら動かさず、最終状態を即座に見せる */
	reducedMotion: boolean;
	testID?: string;
};

/**
 * #1486 §1 の見せ方をそのまま形にしたもの。
 *
 * - 共感写真は **全面**（`StyleSheet.absoluteFill`）。課題フェーズではこれだけが見える
 * - 解決フェーズでは共感写真の上に黒の半透明オーバーレイをかけ、
 *   **課題文は残したまま** 解決画像と解決文をフェード / ポップで重ねる
 *
 * ⚠️ 課題文を消さないこと。「悩み → こう解決する」を 1 画面で対比させるのがこの設計の要点で、
 * 課題文が消えると解決文だけが宙に浮く。
 */
export function OnboardingStepView({
	step,
	problemText,
	solutionText,
	phase,
	reducedMotion,
	testID,
}: OnboardingStepViewProps) {
	const isSolution = phase === "solution";

	// 0 = 課題フェーズ / 1 = 解決フェーズ。オーバーレイ・解決画像・解決文が共有する進捗値
	const reveal = useSharedValue(isSolution ? 1 : 0);

	useEffect(() => {
		const target = isSolution ? 1 : 0;

		if (reducedMotion) {
			// #959 モーションを減らす設定では «動かさずに» 最終状態へ飛ばす（表示内容は同じ）
			reveal.value = target;
			return;
		}

		reveal.value = withTiming(target, {
			duration: SOLUTION_REVEAL_DURATION_MS,
			easing: Easing.out(Easing.cubic),
		});
	}, [isSolution, reducedMotion, reveal]);

	const overlayStyle = useAnimatedStyle(() => ({ opacity: reveal.value }));

	const solutionStyle = useAnimatedStyle(() => ({
		opacity: reveal.value,
		// 「ポップ」表現。0.88 → 1.0 へ持ち上げる。translateY を併せると «下から出る» 印象になり、
		// 解決画像がカードとして «せり上がる» 見え方になる
		transform: [{ scale: 0.88 + reveal.value * 0.12 }, { translateY: (1 - reveal.value) * 16 }],
	}));

	return (
		<View style={styles.container} testID={testID}>
			{/* 共感写真（全面）。課題フェーズではこれだけが見える */}
			<Image
				source={step.empathyImage}
				style={StyleSheet.absoluteFill}
				contentFit="cover"
				// #1486 §2 ローカルアセットなので取得は発生しないが、
				// 遷移の瞬間に «前の画像 → 新しい画像» のクロスフェードが挟まると
				// 「ちらつき」に見えるため無効化する
				transition={0}
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
			/>

			{/* 解決フェーズの黒半透明オーバーレイ（#1486 §1） */}
			<Animated.View
				style={[StyleSheet.absoluteFill, { backgroundColor: SOLUTION_OVERLAY_COLOR }, overlayStyle]}
				pointerEvents="none"
			/>

			<View style={styles.content} pointerEvents="none">
				<Text style={styles.problemText} testID={testID ? `${testID}-problem` : undefined}>
					{problemText}
				</Text>

				{/* 解決フェーズの中身。課題フェーズでは opacity 0 で «場所だけ» 確保しておく。
				    表示のたびにレイアウトが組み直されると課題文の位置が動いてしまうため */}
				<Animated.View style={[styles.solutionBlock, solutionStyle]}>
					<Image source={step.solutionImage} style={styles.solutionImage} contentFit="contain" transition={0} />
					<Text style={styles.solutionText} testID={testID ? `${testID}-solution` : undefined}>
						{solutionText}
					</Text>
				</Animated.View>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#1A1A1A",
		overflow: "hidden",
	},
	content: {
		flex: 1,
		paddingHorizontal: 24,
		paddingTop: 8,
		paddingBottom: 16,
	},
	problemText: {
		fontSize: 22,
		lineHeight: 32,
		fontWeight: "700",
		color: "#FFFFFF",
		textAlign: "center",
		// 課題フェーズでは «写真の上に直接» 載るので、影が無いと明るい写真で読めなくなる
		textShadowColor: "rgba(0, 0, 0, 0.6)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 8,
	},
	solutionBlock: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		gap: 20,
		marginTop: 16,
	},
	solutionImage: {
		width: "100%",
		flex: 1,
	},
	solutionText: {
		fontSize: 17,
		lineHeight: 26,
		fontWeight: "600",
		color: "#FFFFFF",
		textAlign: "center",
	},
});
