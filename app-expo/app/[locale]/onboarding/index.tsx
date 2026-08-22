/*
このファイルの責務
- #1486 §1 の 3 ステップオンボーディングを «画面» として提供する。
- 課題フェーズ → 解決フェーズのタイマー、ページ送り、離脱先の決定を持つ。

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

import { OnboardingScreenOptions } from "@/features/onboarding/components/OnboardingScreenOptions";
import { OnboardingStepIndicator } from "@/features/onboarding/components/OnboardingStepIndicator";
import { OnboardingStepView, type OnboardingPhase } from "@/features/onboarding/components/OnboardingStepView";
import { ONBOARDING_STEPS, PROBLEM_PHASE_DURATION_MS } from "@/features/onboarding/constants";
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

export default function OnboardingScreen() {
	const { locale } = useLocale();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const reducedMotion = useReducedMotion();
	const { mode: rawMode } = useLocalSearchParams<{ mode?: string }>();
	const mode: OnboardingMode = useMemo(() => parseOnboardingMode(rawMode), [rawMode]);

	const [stepIndex, setStepIndex] = useState(0);
	const [phase, setPhase] = useState<OnboardingPhase>("problem");

	const step = ONBOARDING_STEPS[stepIndex];
	const isFirstStep = stepIndex === 0;
	const isLastStep = stepIndex === ONBOARDING_STEPS.length - 1;

	/**
	 * #1486 §1【設計】課題フェーズを見せてから解決フェーズへ切り替える。
	 *
	 * `stepIndex` が変わるたびにこの effect が張り直され、まず `phase` を `"problem"` へ戻す。
	 * これが「前のページへ戻った場合は、課題状態から解決アニメーションを再生する」
	 *（#1486 §1 の確定仕様）の実装そのもの。フェーズをページごとに覚えてしまうと、
	 * 戻ったときに解決状態のまま出てしまい、対比が伝わらない。
	 */
	useEffect(() => {
		setPhase("problem");
		const timeoutId = setTimeout(() => setPhase("solution"), PROBLEM_PHASE_DURATION_MS);
		return () => clearTimeout(timeoutId);
	}, [stepIndex]);

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

	const handleNext = useCallback(() => {
		lightImpact();

		if (!isLastStep) {
			setStepIndex((index) => index + 1);
			return;
		}

		logFrontendEvent({
			event_name: "onboarding_steps_completed",
			error_level: "log",
			payload: { mode, last_step: stepIndex + 1 },
		});

		// #1486 §3 `？` から開いた場合は 3 ステップだけを見せて元の画面へ戻す
		//（ログイン・権限・Welcome は初回導線のためのもので、既存ユーザーに再度見せる意味が無い）
		if (mode === "manual") {
			leaveToApp();
			return;
		}
		goToLogin();
	}, [lightImpact, isLastStep, logFrontendEvent, mode, stepIndex, leaveToApp, goToLogin]);

	const handleBack = useCallback(() => {
		// #1486 §1 1 枚目は戻る操作無効
		if (isFirstStep) return;
		lightImpact();
		setStepIndex((index) => index - 1);
	}, [isFirstStep, lightImpact]);

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
			<OnboardingStepView
				step={step}
				problemText={i18n.t(step.problemKey)}
				solutionText={i18n.t(step.solutionKey)}
				phase={phase}
				reducedMotion={reducedMotion}
				testID={`onboarding-step-${stepIndex + 1}`}
			/>

			{/* 丸数字と操作ボタンは写真の «上» に重ねる。写真が全面表示（#1486 §1）なので、
			    通常フローに載せると写真の高さが削れてしまう */}
			<SafeAreaView style={styles.topLayer} edges={["top"]} pointerEvents="box-none">
				<OnboardingStepIndicator
					currentIndex={stepIndex}
					total={ONBOARDING_STEPS.length}
					accessibilityLabel={i18n.t("Onboarding.accessibility.stepProgress", {
						current: stepIndex + 1,
						total: ONBOARDING_STEPS.length,
					})}
					testID="onboarding-step-indicator"
				/>
			</SafeAreaView>

			<SafeAreaView style={styles.bottomLayer} edges={["bottom"]} pointerEvents="box-none">
				{/* 下部中央付近の小さめのスキップ（#1486 §1） */}
				<TouchableOpacity
					style={styles.skipButton}
					onPress={handleSkip}
					accessibilityRole="button"
					hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
					testID="onboarding-skip">
					<Text style={styles.skipLabel}>{i18n.t("Onboarding.skip")}</Text>
				</TouchableOpacity>

				<View style={styles.navRow}>
					{/* #1486 §1 1 枚目は戻る操作無効。押せないだけでなく «出さない» が、
					    「次へ」の位置が 1 枚目だけ動かないようスペーサーで幅を保つ */}
					{isFirstStep ? (
						<View style={styles.navPlaceholder} />
					) : (
						<TouchableOpacity
							style={styles.navButton}
							onPress={handleBack}
							accessibilityRole="button"
							testID="onboarding-back">
							<ChevronLeft size={20} color="#FFFFFF" />
							<Text style={styles.navLabel}>{i18n.t("Onboarding.back")}</Text>
						</TouchableOpacity>
					)}

					<TouchableOpacity
						style={styles.navButton}
						onPress={handleNext}
						accessibilityRole="button"
						testID="onboarding-next">
						<Text style={styles.navLabel}>{i18n.t("Onboarding.next")}</Text>
						<ChevronRight size={20} color="#FFFFFF" />
					</TouchableOpacity>
				</View>
			</SafeAreaView>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#1A1A1A",
	},
	topLayer: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		paddingTop: 12,
	},
	bottomLayer: {
		position: "absolute",
		bottom: 0,
		left: 0,
		right: 0,
		paddingBottom: 8,
	},
	skipButton: {
		alignSelf: "center",
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
		paddingHorizontal: 12,
		paddingBottom: 8,
	},
	navButton: {
		flexDirection: "row",
		alignItems: "center",
		gap: 2,
		paddingVertical: 12,
		paddingHorizontal: 12,
	},
	navPlaceholder: {
		// 「前へ」と同じ見かけの幅。1 枚目でも「次へ」が右下から動かないようにする
		width: 88,
	},
	navLabel: {
		fontSize: 16,
		fontWeight: "700",
		color: "#FFFFFF",
	},
});
