/*
このファイルの責務
- オンボーディング 1 ページ分の «見た目» を描く（#1486 §1）。
- 「課題フェーズ → 解決フェーズ」の切り替えアニメーションを持つ。

ページ送り・タイマー・遷移は持たない。それらは app/[locale]/onboarding/index.tsx の責務。
このコンポーネントは `phase` を受け取って描くだけなので、フェーズを外から与えれば
どの状態でもそのまま描画できる（= 戻ったときに課題状態から再生し直せる）。

## レイアウト（デザインレビューで確定した «テンプレートカード» 構成）

上から順に 1 本の縦カラム:

1. ステップ番号バッジ（1 個だけ。3 つ並べない）
2. 課題文 — **ストーリー投稿のテキストのような半透明の背景ボックス**に載せる。
   ページを開くと同時に «下から上へ» フェードインする
3. 解決文 — 課題文の **すぐ下**（画像の下ではない）。**枠は付けない**（最終検収で確定）
4. 解決画像 — 中央にカードとして収める（全面に広げない）

初回実装は課題文が画面上端・解決文が画像の下にあり、バッジと課題文が重なる /
解決画像が大きすぎるという指摘を受けた。バッジとテキストを同じカラムに流すことで
重なりは構造的に起きなくなっている。
*/
import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { FixedColors } from "@/constants/Palette";

import {
	PROBLEM_INTRO_DURATION_MS,
	PROBLEM_INTRO_TRANSLATE_Y,
	SOLUTION_OVERLAY_COLOR,
	SOLUTION_REVEAL_DURATION_MS,
	type OnboardingStepConst,
} from "../constants";

export type OnboardingPhase = "problem" | "solution";

export type OnboardingStepViewProps = {
	step: OnboardingStepConst;
	/** バッジに出すステップ番号バッジ要素（index.tsx が状態を持つため受け取る） */
	badge: React.ReactNode;
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
	badge,
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

	/**
	 * 課題文の «入り»。0 = 出ていない / 1 = 出ている。
	 *
	 * `step` はページごとに別のオブジェクト（`ONBOARDING_STEPS` の要素）なので、
	 * ページが変わったときだけこの effect が走り、入りのモーションが再生し直される。
	 */
	const intro = useSharedValue(reducedMotion ? 1 : 0);

	useEffect(() => {
		if (reducedMotion) {
			// #959 モーションを減らす設定では «動かさずに» 最終状態を見せる
			intro.value = 1;
			return;
		}

		// 0 へ戻してから再生する。戻さないと 2 ページ目以降で «すでに出ている» 状態から
		// 始まってしまい、入りのモーションが 1 ページ目にしか無いことになる
		intro.value = 0;
		intro.value = withTiming(1, {
			duration: PROBLEM_INTRO_DURATION_MS,
			easing: Easing.out(Easing.cubic),
		});
	}, [step, reducedMotion, intro]);

	const overlayStyle = useAnimatedStyle(() => ({ opacity: reveal.value }));

	const introStyle = useAnimatedStyle(() => ({
		opacity: intro.value,
		transform: [{ translateY: (1 - intro.value) * PROBLEM_INTRO_TRANSLATE_Y }],
	}));

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
				{badge}

				{/* 課題文はページを開くと同時に «下から上へ» フェードインする（デザイン確定仕様）。
				    解決フェーズへ移っても消さない（下の ⚠️ を参照） */}
				<Animated.View style={[styles.textBox, introStyle]}>
					<Text style={styles.problemText} testID={testID ? `${testID}-problem` : undefined}>
						{problemText}
					</Text>
				</Animated.View>

				{/* 解決文は課題文の «すぐ下»。課題フェーズでは opacity 0 で場所だけ確保しておく。
				    表示のたびにレイアウトが組み直されると課題文や画像の位置が動いてしまうため */}
				<Animated.View style={[styles.solutionTextArea, solutionStyle]}>
					<Text style={styles.solutionText} testID={testID ? `${testID}-solution` : undefined}>
						{solutionText}
					</Text>
				</Animated.View>

				{/* 解決画像。全面ではなく «カード» として中央に収める */}
				<Animated.View style={[styles.solutionImageArea, solutionStyle]}>
					<Image source={step.solutionImage} style={styles.solutionImage} contentFit="contain" transition={0} />
				</Animated.View>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	// #1629 全面写真の下地。写真が出る前の一瞬と、写真の外側に見える墨色。
	// この画面は写真と、その上の白文字・白い円だけで出来ているのでテーマに追従させない
	//（理由は constants/Palette.ts の FixedColors.photoBackdrop）
	container: {
		flex: 1,
		backgroundColor: FixedColors.photoBackdrop,
		overflow: "hidden",
	},
	content: {
		flex: 1,
		paddingHorizontal: 28,
		paddingTop: 12,
		// 下部の円形ナビボタン（index.tsx のオーバーレイ）と画像がぶつからない余白
		paddingBottom: 104,
	},
	// ストーリー投稿のテキストのような、角丸 + 半透明の背景ボックス。
	// 写真の明暗によらず文字が読めることと、「文字がそこに置いてある」感を両立する。
	// 最終検収で «色付きではなく黒の半透明に» の指摘（課題文側）
	textBox: {
		alignSelf: "center",
		marginTop: 16,
		paddingHorizontal: 16,
		paddingVertical: 9,
		borderRadius: 10,
		backgroundColor: "rgba(0, 0, 0, 0.55)",
	},
	// 解決文は **枠を持たない**（最終検収で「四角枠は不要」が確定）。
	// 背景ボックスが無くなったぶん、暗いオーバーレイの上でも輪郭が立つよう影で読ませる。
	// 課題文との間隔は «もう少しだけ下» の指摘を受けて広げてある
	solutionTextArea: {
		alignSelf: "center",
		marginTop: 26,
		paddingHorizontal: 8,
	},
	// 文字は大きくしすぎない（デザインレビュー・最終検収で 2 度指摘）。
	// 折り返し位置は文言側の明示 \n が決める（locales/*.json）ので、ここで幅の調整はしない
	problemText: {
		fontSize: 16,
		lineHeight: 25,
		fontWeight: "700",
		// 全面写真（＋黒の半透明オーバーレイ）の上に載る文字。地が常に暗いので白で固定する
		color: FixedColors.onMedia,
		textAlign: "center",
	},
	solutionText: {
		fontSize: 13,
		lineHeight: 21,
		fontWeight: "700",
		// 同上（写真の上の文字）
		color: FixedColors.onMedia,
		textAlign: "center",
		textShadowColor: "rgba(0, 0, 0, 0.6)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 4,
	},
	solutionImageArea: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		marginTop: 8,
	},
	solutionImage: {
		// カードとして収める。幅の上限と «縦は余った分だけ» の両方を制約にすることで、
		// 小さい端末では自動的に縮む（でかすぎたという指摘への対応）
		width: "82%",
		maxWidth: 340,
		height: "100%",
	},
});
