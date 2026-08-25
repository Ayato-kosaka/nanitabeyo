import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	AccessibilityInfo,
	findNodeHandle,
	Modal,
	Platform,
	ScrollView,
	StatusBar,
	StyleSheet,
	Text,
	TouchableOpacity,
	View,
	useWindowDimensions,
	type LayoutChangeEvent,
} from "react-native";
import Svg, { Defs, Mask, Rect as SvgRect } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { Pointer } from "lucide-react-native";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";
import i18n from "@/lib/i18n";
import { useLogger } from "@/hooks/useLogger";
import type {
	SpotlightOpenReason,
	SpotlightPlacement,
	SpotlightRect,
	SpotlightStepDefinition,
	SpotlightTargetRefs,
} from "@/features/tutorial/types/spotlight";

const SPOTLIGHT_PADDING = 10;
const CALLOUT_EDGE_MARGIN = 16;
const CALLOUT_TARGET_GAP = 16;
const CALLOUT_MAX_WIDTH = 360;
const INITIAL_CALLOUT_HEIGHT = 210;
const MEASURE_RETRY_COUNT = 6;
const MEASURE_RETRY_INTERVAL_MS = 50;
const MEASURE_TIMEOUT_MS = 150;

/** 最初のステップだけ表示する、横スワイプを手ほどきするアイコンの往復ヒント。 */
const SWIPE_HINT_ICON_SIZE = 40;
const SWIPE_HINT_TRAVEL = 34;
const SWIPE_HINT_DURATION_MS = 850;

type SpotlightTutorialProps<K extends string> = {
	visible: boolean;
	requestId: number;
	openReason: SpotlightOpenReason;
	targetRefs: SpotlightTargetRefs<K>;
	/**
	 * 表示するステップ。**順序はプロダクト判断そのもの**なので、描画コードではなく
	 * 呼び出し元（画面ごとのラッパー）が固定する。
	 * 条件付きのステップは、呼び出し元が渡す前に落としておくこと
	 *（「見えていない機能を架空の位置で説明する」ことはしない）。
	 */
	steps: readonly SpotlightStepDefinition<K>[];
	/**
	 * testID の接頭辞。E2E がチュートリアルを画面ごとに見分けるために要る。
	 * 既定は料理提案画面のもの（既存の spec を壊さないため）。
	 */
	testIDPrefix?: string;
	/**
	 * 横スワイプを手ほどきする往復アイコンを出すステップと、その対象。
	 *
	 * «横に振れる» ことは静止画では伝わらないので、そういうステップのある画面だけが渡す。
	 * 渡さなければアイコンは一切出ない（説明できない動きを匂わせない）。
	 */
	swipeHint?: { stepId: string; targetKey: K };
	onPresented: () => void;
	onClose: () => void;
	onUnavailable: () => void;
};

type MeasuredTargets<K extends string> = Partial<Record<K, SpotlightRect>>;

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** 幅・高さが0のレイアウト値は「まだ描画されていない」として扱う。 */
const isUsableRect = (rect: SpotlightRect) =>
	[rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;

/**
 * #927 【修正】Android の measureInWindow はアプリのウィンドウ(ステータスバーの下から始まる)
 * 基準の座標を返すが、オーバーレイの Modal は statusBarTranslucent のため画面最上端から
 * 描画される。座標基準の差 = ステータスバー高さのぶん、穴が対象より上にずれていたため、
 * Android でのみ y に StatusBar.currentHeight を加算して Modal の座標系へ揃える。
 * (iOS はウィンドウ=画面全体、web は viewport 基準で Modal と一致するため補正不要。
 *  将来 edge-to-edge を有効化した場合はウィンドウが画面全体になるためこの補正は不要になる)
 */
const ANDROID_STATUS_BAR_OFFSET = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

/**
 * 1つのViewを画面座標で計測する。
 *
 * measureInWindowは対象が未mountの場合にcallbackが返らない実装差もあり得るため、
 * timeoutで必ずnullへ収束させてチュートリアル全体の停止を防ぐ。
 */
const measureTarget = <K extends string>(
	targetKey: K,
	targetRefs: SpotlightTargetRefs<K>,
): Promise<SpotlightRect | null> => {
	const target = targetRefs[targetKey].current;
	if (!target) return Promise.resolve(null);

	return new Promise((resolve) => {
		let isSettled = false;
		const finish = (rect: SpotlightRect | null) => {
			if (isSettled) return;
			isSettled = true;
			clearTimeout(timeoutId);
			resolve(rect && isUsableRect(rect) ? rect : null);
		};
		const timeoutId = setTimeout(() => finish(null), MEASURE_TIMEOUT_MS);

		requestAnimationFrame(() => {
			target.measureInWindow((x, y, width, height) => {
				finish({ x, y: y + ANDROID_STATUS_BAR_OFFSET, width, height });
			});
		});
	});
};

/**
 * #927 【修正】2回の計測結果が実質同一(各値の差が1px以内)かを判定する。
 * カルーセルの初期スナップや画像ロードによるレイアウト確定前に計測すると、
 * その瞬間の座標で穴が固定され全プラットフォームで「ずれた」表示になるため、
 * 連続2回一致するまで待って「動いていない」ことを確認してから表示する。
 */
const isSameRect = (a: SpotlightRect | null | undefined, b: SpotlightRect | null | undefined) => {
	if (!a || !b) return false;
	return (
		Math.abs(a.x - b.x) <= 1 &&
		Math.abs(a.y - b.y) <= 1 &&
		Math.abs(a.width - b.width) <= 1 &&
		Math.abs(a.height - b.height) <= 1
	);
};

/** 複数スポットの外接矩形。吹き出しの配置基準にだけ使い、穴自体は個別に描画する。 */
const getUnionRect = (rects: readonly SpotlightRect[]): SpotlightRect | null => {
	if (rects.length === 0) return null;

	const left = Math.min(...rects.map((rect) => rect.x));
	const top = Math.min(...rects.map((rect) => rect.y));
	const right = Math.max(...rects.map((rect) => rect.x + rect.width));
	const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
	return { x: left, y: top, width: right - left, height: bottom - top };
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * 穴を対象より少し広げる。
 *
 * 画面端を越える値はSVG実装差の原因になるため、必ず画面内へclampする。
 */
const padRect = (rect: SpotlightRect, windowWidth: number, windowHeight: number): SpotlightRect => {
	const left = clamp(rect.x - SPOTLIGHT_PADDING, 0, windowWidth);
	const top = clamp(rect.y - SPOTLIGHT_PADDING, 0, windowHeight);
	const right = clamp(rect.x + rect.width + SPOTLIGHT_PADDING, 0, windowWidth);
	const bottom = clamp(rect.y + rect.height + SPOTLIGHT_PADDING, 0, windowHeight);

	return {
		x: left,
		y: top,
		width: Math.max(0, right - left),
		height: Math.max(0, bottom - top),
	};
};

/**
 * 対象・Safe Area・吹き出し実寸から配置を決める。
 *
 * preferredPlacementはあくまで優先方向。収まらなければ反対側へ退避し、
 * それでも足りない小画面ではSafe Area内へclampする。
 */
const getCalloutPosition = ({
	targetRect,
	calloutWidth,
	calloutHeight,
	windowWidth,
	windowHeight,
	safeTop,
	safeBottom,
	preferredPlacement,
}: {
	targetRect: SpotlightRect;
	calloutWidth: number;
	calloutHeight: number;
	windowWidth: number;
	windowHeight: number;
	safeTop: number;
	safeBottom: number;
	preferredPlacement: SpotlightPlacement;
}) => {
	const safeAreaTop = safeTop + CALLOUT_EDGE_MARGIN;
	const safeAreaBottom = windowHeight - safeBottom - CALLOUT_EDGE_MARGIN;
	const aboveTop = targetRect.y - CALLOUT_TARGET_GAP - calloutHeight;
	const belowTop = targetRect.y + targetRect.height + CALLOUT_TARGET_GAP;
	const canFitAbove = aboveTop >= safeAreaTop;
	const canFitBelow = belowTop + calloutHeight <= safeAreaBottom;

	let placement: "above" | "below" = preferredPlacement;
	if (preferredPlacement === "above" && !canFitAbove && canFitBelow) {
		placement = "below";
	} else if (preferredPlacement === "below" && !canFitBelow && canFitAbove) {
		placement = "above";
	}

	const idealTop = placement === "above" ? aboveTop : belowTop;
	const top = clamp(idealTop, safeAreaTop, safeAreaBottom - calloutHeight);
	const idealLeft = targetRect.x + targetRect.width / 2 - calloutWidth / 2;
	const left = clamp(idealLeft, CALLOUT_EDGE_MARGIN, windowWidth - calloutWidth - CALLOUT_EDGE_MARGIN);
	const targetCenterX = targetRect.x + targetRect.width / 2;
	const arrowLeft = clamp(targetCenterX - left - 8, 20, calloutWidth - 36);

	return { top, left, arrowLeft, placement };
};

/**
 * 料理提案画面専用のスポットライトチュートリアル。
 *
 * - 背面UIを操作させないModal
 * - SVG Maskによる複数の透明穴
 * - 実UIのmeasureInWindow座標に追従
 * - 深掘り候補なし時の動的ステップ除外
 *
 * BottomSheet型の検索チュートリアルとは責務が異なるため、独立実装としている。
 */
export function SpotlightTutorial<K extends string>({
	visible,
	requestId,
	openReason,
	targetRefs,
	steps,
	testIDPrefix = "spotlight-tutorial",
	swipeHint,
	onPresented,
	onClose,
	onUnavailable,
}: SpotlightTutorialProps<K>) {
	const styles = useThemedStyles(createStyles);
	const { width: windowWidth, height: windowHeight } = useWindowDimensions();
	const insets = useSafeAreaInsets();
	const { logFrontendEvent } = useLogger();
	const titleRef = useRef<Text>(null);
	const openedRequestIdRef = useRef<number | null>(null);
	const viewedStepKeysRef = useRef<Set<string>>(new Set());
	const reportedMissingKeysRef = useRef<Set<string>>(new Set());
	const [availableSteps, setAvailableSteps] = useState<readonly SpotlightStepDefinition<K>[]>([]);
	const [measuredTargets, setMeasuredTargets] = useState<MeasuredTargets<K>>({});
	const [currentStepIndex, setCurrentStepIndex] = useState(0);
	const [calloutHeight, setCalloutHeight] = useState(INITIAL_CALLOUT_HEIGHT);
	const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);

	const candidateSteps = steps;

	const reportMissingTarget = useCallback(
		(step: SpotlightStepDefinition<K>, targetKey: K) => {
			const reportKey = `${requestId}:${step.id}:${targetKey}`;
			if (reportedMissingKeysRef.current.has(reportKey)) return;
			reportedMissingKeysRef.current.add(reportKey);

			void logFrontendEvent({
				event_name: "topics_tutorial_target_missing",
				error_level: step.optional ? "debug" : "warn",
				payload: {
					step_id: step.id,
					target_key: targetKey,
					opened_reason: openReason,
				},
			});
		},
		[logFrontendEvent, openReason, requestId],
	);

	useEffect(() => {
		void AccessibilityInfo.isReduceMotionEnabled()
			.then(setReduceMotionEnabled)
			.catch(() => {
				// OS設定の取得可否はチュートリアル表示を妨げない。既定のfadeを使う。
			});
	}, []);

	/**
	 * Modalを見せる前のプリフライト。
	 *
	 * 必須ターゲットを全部計測できた場合だけオーバーレイを表示する。
	 * optionalなdeepDiveは最終リトライ後も取れなければ、総ページ数ごと除外する。
	 */
	useEffect(() => {
		if (!visible) {
			setAvailableSteps([]);
			setMeasuredTargets({});
			setCurrentStepIndex(0);
			setCalloutHeight(INITIAL_CALLOUT_HEIGHT);
			return;
		}

		let isCancelled = false;

		const prepare = async () => {
			const targetKeys = Array.from(new Set(candidateSteps.flatMap((step) => step.targetKeys)));
			let latestMeasurements: MeasuredTargets<K> = {};
			let previousMeasurements: MeasuredTargets<K> = {};

			for (let attempt = 0; attempt < MEASURE_RETRY_COUNT; attempt += 1) {
				if (attempt > 0) {
					await wait(MEASURE_RETRY_INTERVAL_MS);
				}
				if (isCancelled) return;

				const entries = await Promise.all(
					targetKeys.map(async (targetKey) => [targetKey, await measureTarget(targetKey, targetRefs)] as const),
				);
				previousMeasurements = latestMeasurements;
				latestMeasurements = Object.fromEntries(entries.filter(([, rect]) => rect !== null)) as MeasuredTargets<K>;

				// #927 【修正】optionalを含め全ターゲットが揃い、かつ直前の計測と一致(=レイアウトが
				// 静止)したときだけ確定する。カルーセルの初期スナップや画像ロードで座標が動いている
				// 最中の値で穴を固定すると、全プラットフォームで「ずれた」スポットライトになるため。
				const allMeasured = targetKeys.every((targetKey) => latestMeasurements[targetKey]);
				const allStable = targetKeys.every((targetKey) =>
					isSameRect(latestMeasurements[targetKey], previousMeasurements[targetKey]),
				);
				if (allMeasured && allStable) {
					break;
				}
			}

			if (isCancelled) return;

			const displayableSteps = candidateSteps.filter((step) => {
				const missingTargetKeys = step.targetKeys.filter((targetKey) => !latestMeasurements[targetKey]);
				missingTargetKeys.forEach((targetKey) => reportMissingTarget(step, targetKey));
				return missingTargetKeys.length === 0;
			});
			const hasMissingRequiredStep = candidateSteps.some(
				(step) => !step.optional && !displayableSteps.some((displayableStep) => displayableStep.id === step.id),
			);

			if (hasMissingRequiredStep || displayableSteps.length === 0) {
				// グループ投票など必須説明を欠いた不完全なチュートリアルは出さない。
				onUnavailable();
				return;
			}

			setMeasuredTargets(latestMeasurements);
			setAvailableSteps(displayableSteps);
			setCurrentStepIndex(0);
		};

		void prepare();

		return () => {
			isCancelled = true;
		};
	}, [candidateSteps, onUnavailable, reportMissingTarget, targetRefs, visible]);

	const currentStep = availableSteps[currentStepIndex];
	const isSwipeStep = !!swipeHint && currentStep?.id === swipeHint.stepId;

	/**
	 * 1ステップ目だけ、カード上で指アイコンを左右に往復させてスワイプ操作を手本で示す。
	 *
	 * Reduce Motion設定時はアイコン自体を出さないため、アニメーションも起動しない。
	 */
	const swipeHintTranslateX = useSharedValue(-SWIPE_HINT_TRAVEL);
	useEffect(() => {
		if (isSwipeStep && visible && !reduceMotionEnabled) {
			swipeHintTranslateX.value = withRepeat(
				withTiming(SWIPE_HINT_TRAVEL, { duration: SWIPE_HINT_DURATION_MS, easing: Easing.inOut(Easing.quad) }),
				-1,
				true,
			);
		} else {
			swipeHintTranslateX.value = -SWIPE_HINT_TRAVEL;
		}
	}, [isSwipeStep, reduceMotionEnabled, swipeHintTranslateX, visible]);

	const swipeHintAnimatedStyle = useAnimatedStyle(() => ({
		transform: [{ translateX: swipeHintTranslateX.value }],
	}));

	/**
	 * ステップ移動・画面回転・Webリサイズのたびに、現在の対象だけ再計測する。
	 *
	 * 初期値を使い続けると回転後に穴がずれるため、座標更新を表示ライフサイクルへ
	 * 明示的に組み込む。失敗時は誤案内を続けず安全に閉じる。
	 */
	useEffect(() => {
		if (!visible || !currentStep) return;

		let isCancelled = false;

		const remeasureCurrentStep = async () => {
			let entries: readonly (readonly [K, SpotlightRect | null])[] = [];
			let previousEntries: ReadonlyMap<K, SpotlightRect | null> = new Map();

			// ステップ切替直後の1フレームだけrefが不安定でも閉じないよう、短く再試行する。
			// #927 【修正】prepare と同様に、連続2回一致するまで待ってレイアウト静止を確認する
			// (回転・リサイズ直後の遷移アニメーション中の座標で穴を固定しないため)。
			for (let attempt = 0; attempt < 3; attempt += 1) {
				if (attempt > 0) {
					await wait(MEASURE_RETRY_INTERVAL_MS);
				}
				if (isCancelled) return;

				previousEntries = new Map(entries);
				entries = await Promise.all(
					currentStep.targetKeys.map(
						async (targetKey) => [targetKey, await measureTarget(targetKey, targetRefs)] as const,
					),
				);
				const allMeasured = entries.every(([, rect]) => rect !== null);
				const allStable = entries.every(([targetKey, rect]) => isSameRect(rect, previousEntries.get(targetKey)));
				if (allMeasured && allStable) break;
			}
			if (isCancelled) return;

			const missingEntry = entries.find(([, rect]) => rect === null);
			if (missingEntry) {
				reportMissingTarget(currentStep, missingEntry[0]);
				onUnavailable();
				return;
			}

			setMeasuredTargets((previous) => ({
				...previous,
				...Object.fromEntries(entries),
			}));
		};

		void remeasureCurrentStep();

		return () => {
			isCancelled = true;
		};
	}, [
		currentStep,
		currentStepIndex,
		onUnavailable,
		reportMissingTarget,
		requestId,
		targetRefs,
		visible,
		windowHeight,
		windowWidth,
	]);

	const activeTargetRects = useMemo(() => {
		if (!currentStep) return [];
		return currentStep.targetKeys
			.map((targetKey) => measuredTargets[targetKey])
			.filter((rect): rect is SpotlightRect => rect !== undefined)
			.map((rect) => padRect(rect, windowWidth, windowHeight));
	}, [currentStep, measuredTargets, windowHeight, windowWidth]);

	const targetUnionRect = useMemo(() => getUnionRect(activeTargetRects), [activeTargetRects]);
	const calloutWidth = Math.min(CALLOUT_MAX_WIDTH, Math.max(0, windowWidth - CALLOUT_EDGE_MARGIN * 2));
	const calloutPosition = useMemo(() => {
		if (!currentStep || !targetUnionRect) return null;
		return getCalloutPosition({
			targetRect: targetUnionRect,
			calloutWidth,
			calloutHeight,
			windowWidth,
			windowHeight,
			safeTop: insets.top,
			safeBottom: insets.bottom,
			preferredPlacement: currentStep.preferredPlacement,
		});
	}, [calloutHeight, calloutWidth, currentStep, insets.bottom, insets.top, targetUnionRect, windowHeight, windowWidth]);

	/**
	 * 座標計測だけでなく、Modalを描画できるstateが揃った後に初めて「表示済み」とする。
	 *
	 * これにより、計測成功直後に画面がunmountした場合でも
	 * 実際には見せていないチュートリアルをStorageへ保存しない。
	 */
	useEffect(() => {
		if (!visible || !currentStep || !targetUnionRect || !calloutPosition) return;
		if (openedRequestIdRef.current === requestId) return;

		openedRequestIdRef.current = requestId;
		onPresented();
		void logFrontendEvent({
			event_name: "topics_tutorial_opened",
			error_level: "log",
			payload: {
				opened_reason: openReason,
				tutorial_version: 1,
				displayed_step_ids: availableSteps.map((step) => step.id),
			},
		});
	}, [
		availableSteps,
		calloutPosition,
		currentStep,
		logFrontendEvent,
		onPresented,
		openReason,
		requestId,
		targetUnionRect,
		visible,
	]);

	/** ステップ表示ログ・スクリーンリーダー通知は、同一表示中に各1回だけ送る。 */
	useEffect(() => {
		if (!visible || !currentStep || !calloutPosition) return;

		const viewedKey = `${requestId}:${currentStep.id}`;
		if (viewedStepKeysRef.current.has(viewedKey)) return;

		viewedStepKeysRef.current.add(viewedKey);
		void logFrontendEvent({
			event_name: "topics_tutorial_step_viewed",
			error_level: "log",
			payload: {
				step_id: currentStep.id,
				step_index: currentStepIndex,
				total_steps: availableSteps.length,
				opened_reason: openReason,
			},
		});

		const title = i18n.t(currentStep.titleKey);
		const body = currentStep.bodyKeys.map((bodyKey) => i18n.t(bodyKey)).join(" ");
		const progress = i18n.t("Tutorial.spotlight.progressAccessibility", {
			current: currentStepIndex + 1,
			total: availableSteps.length,
		});
		AccessibilityInfo.announceForAccessibility(`${title}. ${body}. ${progress}`);

		// 読み上げ開始後、タイトルへフォーカスを移す。親Viewをaccessibleにすると
		// 子の「スキップ」「次へ」が1要素へ統合されるため、タイトルだけを対象にする。
		const focusTimeoutId = setTimeout(() => {
			const nodeHandle = findNodeHandle(titleRef.current);
			if (nodeHandle) {
				AccessibilityInfo.setAccessibilityFocus(nodeHandle);
			}
		}, 100);

		return () => clearTimeout(focusTimeoutId);
	}, [
		availableSteps.length,
		calloutPosition,
		currentStep,
		currentStepIndex,
		logFrontendEvent,
		openReason,
		requestId,
		visible,
	]);

	const handleSkip = useCallback(() => {
		if (currentStep) {
			void logFrontendEvent({
				event_name: "topics_tutorial_skipped",
				error_level: "log",
				payload: {
					step_id: currentStep.id,
					step_index: currentStepIndex,
					opened_reason: openReason,
				},
			});
		}
		onClose();
	}, [currentStep, currentStepIndex, logFrontendEvent, onClose, openReason]);

	const handlePrimaryAction = useCallback(() => {
		if (!currentStep) return;

		const nextStep = availableSteps[currentStepIndex + 1];
		if (nextStep) {
			void logFrontendEvent({
				event_name: "topics_tutorial_next",
				error_level: "log",
				payload: {
					from_step_id: currentStep.id,
					to_step_id: nextStep.id,
					opened_reason: openReason,
				},
			});
			setCurrentStepIndex((index) => index + 1);
			return;
		}

		void logFrontendEvent({
			event_name: "topics_tutorial_completed",
			error_level: "log",
			payload: {
				opened_reason: openReason,
				displayed_step_ids: availableSteps.map((step) => step.id),
			},
		});
		onClose();
	}, [availableSteps, currentStep, currentStepIndex, logFrontendEvent, onClose, openReason]);

	const handleCalloutLayout = useCallback((event: LayoutChangeEvent) => {
		const nextHeight = event.nativeEvent.layout.height;
		if (nextHeight > 0) {
			setCalloutHeight(nextHeight);
		}
	}, []);

	// 計測完了まではtransparent Modal自体も出さず、画面を一瞬操作不能にしない。
	const isReadyToRender = visible && currentStep && targetUnionRect && calloutPosition;
	if (!isReadyToRender) return null;

	const isLastStep = currentStepIndex === availableSteps.length - 1;
	const progressLabel = i18n.t("Tutorial.spotlight.progress", {
		current: currentStepIndex + 1,
		total: availableSteps.length,
	});
	const progressAccessibilityLabel = i18n.t("Tutorial.spotlight.progressAccessibility", {
		current: currentStepIndex + 1,
		total: availableSteps.length,
	});
	const maskId = `${testIDPrefix}-mask-${requestId}`;
	// スワイプ範囲の実測値でだけアイコンを出す。穴の外接矩形ではなくカード自体の座標を使う。
	const swipeAreaRect = swipeHint ? measuredTargets[swipeHint.targetKey] : undefined;
	const showSwipeHint = isSwipeStep && !reduceMotionEnabled && !!swipeAreaRect;

	return (
		<Modal
			visible
			transparent
			statusBarTranslucent
			presentationStyle="overFullScreen"
			animationType={reduceMotionEnabled ? "none" : "fade"}
			onRequestClose={handleSkip}>
			<View style={styles.overlay} testID={`${testIDPrefix}-overlay`} accessibilityViewIsModal pointerEvents="auto">
				{/* 白いMaskから対象部分を黒で抜き、複数箇所を同時に透明化する。 */}
				<Svg pointerEvents="none" width={windowWidth} height={windowHeight} style={StyleSheet.absoluteFillObject}>
					<Defs>
						<Mask id={maskId}>
							<SvgRect x={0} y={0} width={windowWidth} height={windowHeight} fill={FixedColors.maskOpaque} />
							{activeTargetRects.map((rect, index) => (
								<SvgRect
									key={`mask-hole-${index}`}
									x={rect.x}
									y={rect.y}
									width={rect.width}
									height={rect.height}
									rx={14}
									ry={14}
									fill={FixedColors.maskHole}
								/>
							))}
						</Mask>
					</Defs>
					<SvgRect
						x={0}
						y={0}
						width={windowWidth}
						height={windowHeight}
						fill="rgba(0, 0, 0, 0.64)"
						mask={`url(#${maskId})`}
					/>
					{activeTargetRects.map((rect, index) => (
						<SvgRect
							key={`spotlight-border-${index}`}
							x={rect.x}
							y={rect.y}
							width={rect.width}
							height={rect.height}
							rx={14}
							ry={14}
							fill="transparent"
							stroke="rgba(255, 255, 255, 0.95)"
							strokeWidth={2}
						/>
					))}
				</Svg>

				{showSwipeHint && swipeAreaRect && (
					<Animated.View
						pointerEvents="none"
						testID={`${testIDPrefix}-swipe-hint`}
						style={[
							styles.swipeHint,
							{
								left: swipeAreaRect.x + swipeAreaRect.width / 2 - SWIPE_HINT_ICON_SIZE / 2,
								top: swipeAreaRect.y + swipeAreaRect.height * 0.38 - SWIPE_HINT_ICON_SIZE / 2,
							},
							swipeHintAnimatedStyle,
						]}>
						<View style={styles.swipeHintBadge}>
							<Pointer size={20} color={FixedColors.onMedia} />
						</View>
					</Animated.View>
				)}

				<View
					collapsable={false}
					style={[
						styles.callout,
						{
							top: calloutPosition.top,
							left: calloutPosition.left,
							width: calloutWidth,
							maxHeight: windowHeight - insets.top - insets.bottom - CALLOUT_EDGE_MARGIN * 2,
						},
					]}
					onLayout={handleCalloutLayout}
					testID={`${testIDPrefix}-step-${currentStep.id}`}>
					<View
						pointerEvents="none"
						style={[
							styles.arrow,
							{ left: calloutPosition.arrowLeft },
							calloutPosition.placement === "above" ? styles.arrowBelow : styles.arrowAbove,
						]}
					/>

					<ScrollView
						style={styles.calloutScroll}
						bounces={false}
						showsVerticalScrollIndicator
						contentContainerStyle={styles.calloutContent}>
						<Text ref={titleRef} accessible accessibilityRole="header" style={styles.title}>
							{i18n.t(currentStep.titleKey)}
						</Text>
						<View style={styles.bodyContainer}>
							{currentStep.bodyKeys.map((bodyKey) => (
								<Text key={bodyKey} style={styles.body}>
									{currentStep.bodyKeys.length > 1 ? "• " : ""}
									{i18n.t(bodyKey)}
								</Text>
							))}
						</View>

						<View style={styles.progressRow}>
							<View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
								{availableSteps.map((step, index) => (
									<View key={step.id} style={[styles.dot, index === currentStepIndex && styles.activeDot]} />
								))}
							</View>
							<Text
								style={styles.progress}
								accessibilityLiveRegion="polite"
								accessibilityLabel={progressAccessibilityLabel}
								testID={`${testIDPrefix}-progress`}>
								{progressLabel}
							</Text>
						</View>

						<View style={styles.actions}>
							{/* 最終ステップは「使ってみる」と機能が重複するため、スキップ導線は出さない。 */}
							{!isLastStep && (
								<TouchableOpacity
									onPress={handleSkip}
									style={styles.skipButton}
									accessibilityRole="button"
									testID={`${testIDPrefix}-skip`}>
									<Text style={styles.skipButtonText}>{i18n.t("Tutorial.spotlight.skip")}</Text>
								</TouchableOpacity>
							)}
							<TouchableOpacity
								onPress={handlePrimaryAction}
								style={styles.primaryButton}
								accessibilityRole="button"
								testID={isLastStep ? `${testIDPrefix}-finish` : `${testIDPrefix}-next`}>
								<Text style={styles.primaryButtonText}>
									{i18n.t(isLastStep ? "Tutorial.spotlight.finish" : "Tutorial.spotlight.next")}
								</Text>
							</TouchableOpacity>
						</View>
					</ScrollView>
				</View>
			</View>
		</Modal>
	);
}

/*
#1509 【設計】吹き出しは «64% の黒い暗幕の上に浮くカード» である。

ライトの «白いカードに濃い文字» をそのまま出すと、ダークでは暗幕の上で
唯一まぶしい白面になり、実測（run 32683977248 の my-dishes ダーク）で
「最初に見えるのが真っ白な吹き出し」という状態になっていた。
地は `surface`、文字は `textPrimary` / `textSecondaryAlt` でテーマへ追従させる。

⚠️ マスクのチャンネル値（`FixedColors.maskOpaque` / `maskHole`）と、暗幕の上に載る
   要素（スワイプヒントのバッジ・アイコン、ブランド塗りボタンの文字）は固定のままにすること。
*/
const createStyles = (c: Palette) =>
	StyleSheet.create({
		overlay: {
			flex: 1,
		},
		callout: {
			position: "absolute",
			backgroundColor: c.surface,
			borderRadius: 20,
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 8 },
			shadowOpacity: 0.24,
			shadowRadius: 20,
			elevation: 16,
		},
		calloutContent: {
			paddingHorizontal: 20,
			paddingTop: 20,
			paddingBottom: 16,
		},
		calloutScroll: {
			flexShrink: 1,
		},
		arrow: {
			position: "absolute",
			width: 16,
			height: 16,
			backgroundColor: c.surface,
			transform: [{ rotate: "45deg" }],
		},
		arrowAbove: {
			top: -8,
		},
		arrowBelow: {
			bottom: -8,
		},
		swipeHint: {
			position: "absolute",
			width: SWIPE_HINT_ICON_SIZE,
			height: SWIPE_HINT_ICON_SIZE,
		},
		swipeHintBadge: {
			width: SWIPE_HINT_ICON_SIZE,
			height: SWIPE_HINT_ICON_SIZE,
			borderRadius: SWIPE_HINT_ICON_SIZE / 2,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: "rgba(0, 0, 0, 0.55)",
			borderWidth: 2,
			borderColor: "rgba(255, 255, 255, 0.9)",
		},
		title: {
			color: c.textPrimary,
			fontSize: 20,
			fontWeight: "800",
			lineHeight: 28,
			textAlign: "auto",
		},
		bodyContainer: {
			marginTop: 8,
			gap: 4,
		},
		body: {
			color: c.textSecondaryAlt,
			fontSize: 15,
			fontWeight: "500",
			lineHeight: 22,
			textAlign: "auto",
		},
		progressRow: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			marginTop: 16,
		},
		dots: {
			flexDirection: "row",
			alignItems: "center",
			gap: 6,
		},
		dot: {
			width: 7,
			height: 7,
			borderRadius: 4,
			backgroundColor: c.trackMuted,
		},
		activeDot: {
			width: 18,
			backgroundColor: c.brand,
		},
		progress: {
			color: c.textSecondary,
			fontSize: 13,
			fontWeight: "700",
		},
		actions: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "flex-end",
			gap: 12,
			marginTop: 14,
		},
		skipButton: {
			minHeight: 44,
			paddingHorizontal: 12,
			alignItems: "center",
			justifyContent: "center",
		},
		skipButtonText: {
			color: c.textSecondary,
			fontSize: 15,
			fontWeight: "700",
		},
		primaryButton: {
			minHeight: 44,
			minWidth: 104,
			paddingHorizontal: 20,
			borderRadius: 22,
			backgroundColor: c.brand,
			alignItems: "center",
			justifyContent: "center",
		},
		primaryButtonText: {
			// brand 塗りの上。地がライト / ダークで変わらないため文字も固定
			color: FixedColors.onFilled,
			fontSize: 15,
			fontWeight: "800",
		},
	});
