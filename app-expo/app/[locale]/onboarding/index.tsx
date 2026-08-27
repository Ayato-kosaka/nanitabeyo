/*
このファイルの責務
- #1486 §1 の 3 ステップオンボーディングを «画面» として提供する。
- 課題フェーズ → 解決フェーズの送り、ページ送り、離脱先の決定を持つ。

見た目そのものは features/onboarding/components/OnboardingStepView.tsx が持つ。
この画面は «どのページの、どちらのフェーズか» を決めて渡すだけにしてある。

#1486 §3【設計】旧チュートリアル（TrueSheet の BottomSheet）を置き換える。
シートを «ルート» に変えたのは、ログイン → 位置情報 → 通知 → Welcome という
複数画面の導線がこの後に続くため。シートのままだと「シートの上にシートを重ねる」か
「シートを閉じてから遷移する」しかなく、どちらも #1359 がログイン画面で解いたのと
同じ «表示状態が遷移と無関係な boolean» を作り直すことになる。
*/
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import type { ExternalPathString } from "expo-router";
import { ChevronLeft, ChevronRight } from "lucide-react-native";

import { FixedColors } from "@/constants/Palette";
import { OnboardingScreenOptions } from "@/features/onboarding/components/OnboardingScreenOptions";
import { OnboardingStepIndicator } from "@/features/onboarding/components/OnboardingStepIndicator";
import { OnboardingStepView, type OnboardingPhase } from "@/features/onboarding/components/OnboardingStepView";
import { ONBOARDING_STEPS, clampStepIndex } from "@/features/onboarding/constants";
import {
	appRootPath,
	onboardingLoginPath,
	parseOnboardingMode,
	type OnboardingMode,
} from "@/features/onboarding/navigation";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import i18n from "@/lib/i18n";

/** 現在地。«何ページ目か» と «課題 / 解決のどちらか» を必ず組で動かす（下の設計コメント参照） */
type OnboardingCursor = {
	index: number;
	phase: OnboardingPhase;
};

export default function OnboardingScreen() {
	const { locale } = useLocale();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const reducedMotion = useReducedMotion();
	const { mode: rawMode } = useLocalSearchParams<{ mode?: string }>();
	const mode: OnboardingMode = useMemo(() => parseOnboardingMode(rawMode), [rawMode]);

	/**
	 * 現在地 = «何ページ目の、どちらのフェーズか»。
	 *
	 * #1486【設計】ページ番号とフェーズを **1 つの state にまとめている**。
	 * 解決フェーズへの切り替えが「次へ」の押下そのものになったため、1 回の押下で
	 * ページ番号とフェーズの «どちらか» が動く。2 つに分けたままだと、待機を挟まない連打で
	 * «同じ古い値を読んだ複数のハンドラ» がページ番号とフェーズを別々に進めてしまい、
	 * 「解決を見せずに 2 ページ先へ飛ぶ」ような中間状態が作れてしまう。
	 */
	const [cursor, setCursor] = useState<OnboardingCursor>({ index: 0, phase: "problem" });

	/**
	 * 押下した «その瞬間の» 現在地。
	 *
	 * React の state は再描画までコミットされないので、連打では複数のハンドラが同じ値を読む
	 *（features/onboarding/constants.ts の `clampStepIndex` に実測の顛末がある）。
	 * ref は同期的に進むため、連打でも «1 押下 = 1 段» が保たれる。
	 */
	const cursorRef = useRef(cursor);

	const applyCursor = useCallback((next: OnboardingCursor) => {
		cursorRef.current = next;
		setCursor(next);
	}, []);

	const { index: stepIndex, phase } = cursor;
	// `clampStepIndex` を通してあるので範囲外にはならないが、添字アクセスの結果が
	// undefined になりうることを型でも消しておく（描画側は step が必ずある前提で書かれている）
	const step = ONBOARDING_STEPS[clampStepIndex(stepIndex)];
	const isFirstStep = stepIndex === 0;

	// 離脱は 1 回だけ。連打や、遷移中の再描画で二重に走らせない
	const hasLeftRef = useRef(false);

	/** オンボーディングを抜けてアプリ本体（検索画面）へ戻す */
	const leaveToApp = useCallback(() => {
		if (hasLeftRef.current) return;
		hasLeftRef.current = true;

		// この画面は検索画面から push されているので、通常は 1 枚戻れば検索画面に着く。
		// 履歴が無い（URL 直叩き / ディープリンク）ときだけ置き換えで着地させる
		if (router.canDismiss()) {
			router.dismissAll();
			return;
		}
		router.replace(appRootPath(locale) as ExternalPathString);
	}, [locale]);

	/** 3 ステップを終えて既存ログイン画面へ進む（#1486 §4） */
	const goToLogin = useCallback(() => {
		if (hasLeftRef.current) return;
		hasLeftRef.current = true;
		router.push(onboardingLoginPath(locale) as ExternalPathString);
	}, [locale]);

	/**
	 * 右下の矢印。**1 押下目で解決フェーズを出し、2 押下目で次のページへ送る。**
	 *
	 * #1486【設計】当初は「約 1.5 秒で自動的に解決フェーズへ」だったが、課題文を読み終える前に
	 * 画面が変わるという指摘を受けて «ユーザーが送る» 形へ変えた。解決を «見る» 操作が
	 * ユーザーの手に残っていないと、読む速さの個人差をアプリ側が決めてしまう。
	 */
	const handleNext = useCallback(() => {
		lightImpact();

		const { index, phase: currentPhase } = cursorRef.current;

		if (currentPhase === "problem") {
			applyCursor({ index, phase: "solution" });
			return;
		}

		if (index < ONBOARDING_STEPS.length - 1) {
			// ⚠️ **クランプを外さないこと。** 連打すると複数のハンドラが同じ現在地を読むため、
			// クランプが無いと添字が範囲外へ出て `step` が undefined になり画面ごと落ちる
			//（詳細は features/onboarding/constants.ts の `clampStepIndex`）
			applyCursor({ index: clampStepIndex(index + 1), phase: "problem" });
			return;
		}

		logFrontendEvent({
			event_name: "onboarding_steps_completed",
			error_level: "log",
			payload: { mode, last_step: index + 1 },
		});

		// #1486 §3 `？` から開いた場合は 3 ステップだけを見せて元の画面へ戻す
		//（ログイン・権限・Welcome は初回導線のためのもので、既存ユーザーに再度見せる意味が無い）
		if (mode === "manual") {
			leaveToApp();
			return;
		}
		goToLogin();
	}, [lightImpact, applyCursor, logFrontendEvent, mode, leaveToApp, goToLogin]);

	/**
	 * 左下の矢印。**ページ単位で戻る**（解決フェーズから課題フェーズへは戻さない）。
	 *
	 * 戻り先を必ず課題フェーズにしているのが「前のページへ戻った場合は、課題状態から
	 * 解決アニメーションを再生する」（#1486 §1 の確定仕様）の実装。フェーズをページごとに
	 * 覚えてしまうと、戻ったときに解決状態のまま出てしまい、悩み → 解決の対比が伝わらない。
	 */
	const handleBack = useCallback(() => {
		const { index } = cursorRef.current;
		// #1486 §1 1 枚目は戻る操作無効
		if (index === 0) return;
		lightImpact();
		// 「次へ」と同じ理由でクランプする（連打で添字が負になるのを防ぐ）
		applyCursor({ index: clampStepIndex(index - 1), phase: "problem" });
	}, [lightImpact, applyCursor]);

	const handleSkip = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "onboarding_skipped",
			error_level: "log",
			payload: { mode, skipped_at_step: stepIndex + 1 },
		});

		// #1486 §1「スキップ」でも既存ログイン画面へ（初回導線の場合）
		if (mode === "manual") {
			leaveToApp();
			return;
		}
		goToLogin();
	}, [lightImpact, logFrontendEvent, mode, stepIndex, leaveToApp, goToLogin]);

	/**
	 * Android のハードウェアバック。
	 *
	 * 既定のままだと «画面ごと» pop されてしまい、2 枚目・3 枚目からいきなり検索画面へ抜ける。
	 * 画面内の「前へ」と同じ意味にそろえる。1 枚目では戻る操作を無効にしている（#1486 §1）ので、
	 * `true` を返して既定の pop も止める。
	 */
	useEffect(() => {
		if (Platform.OS !== "android") return;

		const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
			if (isFirstStep) return true;
			handleBack();
			return true;
		});
		return () => subscription.remove();
	}, [isFirstStep, handleBack]);

	useEffect(() => {
		logFrontendEvent({
			event_name: "onboarding_step_viewed",
			error_level: "log",
			payload: { mode, step: stepIndex + 1 },
		});
	}, [logFrontendEvent, mode, stepIndex]);

	return (
		<View style={styles.container} testID="onboarding-screen">
			<OnboardingScreenOptions />
			{/* SafeArea ごと StepView に渡すのではなく、上端の余白だけ SafeAreaView で確保する。
			    バッジ・課題文・解決文・解決画像は StepView の中で 1 本のカラムに流れる
			   （バッジと課題文が重なっていた指摘への対応。同じカラムなら構造的に重ならない） */}
			<SafeAreaView style={styles.stepArea} edges={["top"]}>
				<OnboardingStepView
					step={step}
					badge={
						<OnboardingStepIndicator
							currentIndex={stepIndex}
							total={ONBOARDING_STEPS.length}
							accessibilityLabel={i18n.t("Onboarding.accessibility.stepProgress", {
								current: stepIndex + 1,
								total: ONBOARDING_STEPS.length,
							})}
							testID="onboarding-step-indicator"
						/>
					}
					problemText={i18n.t(step.problemKey)}
					solutionText={i18n.t(step.solutionKey)}
					phase={phase}
					reducedMotion={reducedMotion}
					testID={`onboarding-step-${stepIndex + 1}`}
				/>
			</SafeAreaView>

			<SafeAreaView style={styles.bottomLayer} edges={["bottom"]} pointerEvents="box-none">
				<View style={styles.navRow}>
					{/* #1486 §1 1 枚目は戻る操作無効。押せないだけでなく «出さない» が、
					    「次へ」の位置が 1 枚目だけ動かないようスペーサーで幅を保つ。
					    文字ではなく円形のアイコンボタン（デザインレビューで確定）。
					    アイコンだけなので accessibilityLabel で意味を補う */}
					{isFirstStep ? (
						<View style={styles.navCirclePlaceholder} />
					) : (
						<TouchableOpacity
							style={styles.backCircle}
							onPress={handleBack}
							accessibilityRole="button"
							accessibilityLabel={i18n.t("Onboarding.back")}
							testID="onboarding-back">
							<ChevronLeft size={26} color={FixedColors.onMedia} />
						</TouchableOpacity>
					)}

					{/* 下部中央の小さめのスキップ（#1486 §1）。円形ボタンと同じ行に置く */}
					<TouchableOpacity
						style={styles.skipButton}
						onPress={handleSkip}
						accessibilityRole="button"
						hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
						testID="onboarding-skip">
						<Text style={styles.skipLabel}>{i18n.t("Onboarding.skip")}</Text>
					</TouchableOpacity>

					<TouchableOpacity
						style={styles.nextCircle}
						onPress={handleNext}
						accessibilityRole="button"
						accessibilityLabel={i18n.t("Onboarding.next")}
						testID="onboarding-next">
						<ChevronRight size={26} color={FixedColors.photoBackdrop} />
					</TouchableOpacity>
				</View>
			</SafeAreaView>
		</View>
	);
}

const NAV_CIRCLE_SIZE = 56;

const styles = StyleSheet.create({
	// #1629 全面写真の下地。この画面は写真とその上の白い要素だけで出来ているのでテーマに追従させない
	//（理由は constants/Palette.ts の FixedColors.photoBackdrop）
	container: {
		flex: 1,
		backgroundColor: FixedColors.photoBackdrop,
	},
	stepArea: {
		flex: 1,
	},
	bottomLayer: {
		position: "absolute",
		bottom: 0,
		left: 0,
		right: 0,
		paddingBottom: 8,
	},
	skipButton: {
		paddingVertical: 8,
		paddingHorizontal: 16,
	},
	skipLabel: {
		fontSize: 13,
		fontWeight: "600",
		color: "rgba(255, 255, 255, 0.75)",
	},
	navRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingHorizontal: 24,
		paddingBottom: 12,
	},
	// 前へ: 白い輪郭だけの円（参考デザインの左下ボタン）
	backCircle: {
		width: NAV_CIRCLE_SIZE,
		height: NAV_CIRCLE_SIZE,
		borderRadius: NAV_CIRCLE_SIZE / 2,
		borderWidth: 2,
		// 写真の上に載る円。地が常に暗いので白のまま（FixedColors.onMedia）
		borderColor: FixedColors.onMedia,
		alignItems: "center",
		justifyContent: "center",
	},
	// 次へ: 白塗りの円に黒の矢印（参考デザインの右下ボタン）
	nextCircle: {
		width: NAV_CIRCLE_SIZE,
		height: NAV_CIRCLE_SIZE,
		borderRadius: NAV_CIRCLE_SIZE / 2,
		// 同上。白塗りの円と、その中の photoBackdrop の矢印で 1 セット
		backgroundColor: FixedColors.onMedia,
		alignItems: "center",
		justifyContent: "center",
	},
	navCirclePlaceholder: {
		// 「前へ」と同じ見かけの幅。1 枚目でも「次へ」とスキップの位置が動かないようにする
		width: NAV_CIRCLE_SIZE,
	},
});
