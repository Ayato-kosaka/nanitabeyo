import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	AccessibilityInfo,
	findNodeHandle,
	Modal,
	ScrollView,
	StyleSheet,
	Text,
	TouchableOpacity,
	View,
	useWindowDimensions,
	type LayoutChangeEvent,
} from "react-native";
import Svg, { Defs, Mask, Rect as SvgRect } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import i18n from "@/lib/i18n";
import { useLogger } from "@/hooks/useLogger";
import type {
	TopicsTutorialOpenReason,
	TopicsTutorialRect,
	TopicsTutorialStepDefinition,
	TopicsTutorialTargetKey,
	TopicsTutorialTargetRefs,
} from "@/features/topics/types/tutorial";

const SPOTLIGHT_PADDING = 10;
const CALLOUT_EDGE_MARGIN = 16;
const CALLOUT_TARGET_GAP = 16;
const CALLOUT_MAX_WIDTH = 360;
const INITIAL_CALLOUT_HEIGHT = 210;
const MEASURE_RETRY_COUNT = 6;
const MEASURE_RETRY_INTERVAL_MS = 50;
const MEASURE_TIMEOUT_MS = 150;

/**
 * 表示順はプロダクト判断そのものなので、描画コードから切り離して固定する。
 *
 * deepDiveだけは料理データに候補がある場合に限って表示する。
 * 「見えていない機能を架空の位置で説明する」ことはしない。
 */
const TUTORIAL_STEPS: readonly TopicsTutorialStepDefinition[] = [
	{
		id: "swipeAndDecide",
		targetKeys: ["swipeArea", "selectCta"],
		titleKey: "Topics.tutorial.steps.swipeAndDecide.title",
		bodyKeys: ["Topics.tutorial.steps.swipeAndDecide.body"],
		preferredPlacement: "above",
	},
	{
		id: "deepDive",
		targetKeys: ["deepDive"],
		titleKey: "Topics.tutorial.steps.deepDive.title",
		bodyKeys: ["Topics.tutorial.steps.deepDive.body"],
		preferredPlacement: "above",
		optional: true,
	},
	{
		id: "topicActions",
		targetKeys: ["topicActions"],
		titleKey: "Topics.tutorial.steps.topicActions.title",
		bodyKeys: ["Topics.tutorial.steps.topicActions.save", "Topics.tutorial.steps.topicActions.block"],
		preferredPlacement: "below",
	},
	{
		id: "groupVote",
		targetKeys: ["groupVote"],
		titleKey: "Topics.tutorial.steps.groupVote.title",
		bodyKeys: ["Topics.tutorial.steps.groupVote.body"],
		preferredPlacement: "below",
	},
] as const;

type TopicsSpotlightTutorialProps = {
	visible: boolean;
	requestId: number;
	openReason: TopicsTutorialOpenReason;
	targetRefs: TopicsTutorialTargetRefs;
	includeDeepDiveStep: boolean;
	onPresented: () => void;
	onClose: () => void;
	onUnavailable: () => void;
};

type MeasuredTargets = Partial<Record<TopicsTutorialTargetKey, TopicsTutorialRect>>;

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** 幅・高さが0のレイアウト値は「まだ描画されていない」として扱う。 */
const isUsableRect = (rect: TopicsTutorialRect) =>
	[rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;

/**
 * 1つのViewを画面座標で計測する。
 *
 * measureInWindowは対象が未mountの場合にcallbackが返らない実装差もあり得るため、
 * timeoutで必ずnullへ収束させてチュートリアル全体の停止を防ぐ。
 */
const measureTarget = (
	targetKey: TopicsTutorialTargetKey,
	targetRefs: TopicsTutorialTargetRefs,
): Promise<TopicsTutorialRect | null> => {
	const target = targetRefs[targetKey].current;
	if (!target) return Promise.resolve(null);

	return new Promise((resolve) => {
		let isSettled = false;
		const finish = (rect: TopicsTutorialRect | null) => {
			if (isSettled) return;
			isSettled = true;
			clearTimeout(timeoutId);
			resolve(rect && isUsableRect(rect) ? rect : null);
		};
		const timeoutId = setTimeout(() => finish(null), MEASURE_TIMEOUT_MS);

		requestAnimationFrame(() => {
			target.measureInWindow((x, y, width, height) => {
				finish({ x, y, width, height });
			});
		});
	});
};

/** 複数スポットの外接矩形。吹き出しの配置基準にだけ使い、穴自体は個別に描画する。 */
const getUnionRect = (rects: readonly TopicsTutorialRect[]): TopicsTutorialRect | null => {
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
const padRect = (rect: TopicsTutorialRect, windowWidth: number, windowHeight: number): TopicsTutorialRect => {
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
	targetRect: TopicsTutorialRect;
	calloutWidth: number;
	calloutHeight: number;
	windowWidth: number;
	windowHeight: number;
	safeTop: number;
	safeBottom: number;
	preferredPlacement: TopicsTutorialStepDefinition["preferredPlacement"];
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
export function TopicsSpotlightTutorial({
	visible,
	requestId,
	openReason,
	targetRefs,
	includeDeepDiveStep,
	onPresented,
	onClose,
	onUnavailable,
}: TopicsSpotlightTutorialProps) {
	const { width: windowWidth, height: windowHeight } = useWindowDimensions();
	const insets = useSafeAreaInsets();
	const { logFrontendEvent } = useLogger();
	const titleRef = useRef<Text>(null);
	const openedRequestIdRef = useRef<number | null>(null);
	const viewedStepKeysRef = useRef<Set<string>>(new Set());
	const reportedMissingKeysRef = useRef<Set<string>>(new Set());
	const [availableSteps, setAvailableSteps] = useState<readonly TopicsTutorialStepDefinition[]>([]);
	const [measuredTargets, setMeasuredTargets] = useState<MeasuredTargets>({});
	const [currentStepIndex, setCurrentStepIndex] = useState(0);
	const [calloutHeight, setCalloutHeight] = useState(INITIAL_CALLOUT_HEIGHT);
	const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);

	const candidateSteps = useMemo(
		() => TUTORIAL_STEPS.filter((step) => step.id !== "deepDive" || includeDeepDiveStep),
		[includeDeepDiveStep],
	);

	const reportMissingTarget = useCallback(
		(step: TopicsTutorialStepDefinition, targetKey: TopicsTutorialTargetKey) => {
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
			let latestMeasurements: MeasuredTargets = {};

			for (let attempt = 0; attempt < MEASURE_RETRY_COUNT; attempt += 1) {
				if (attempt > 0) {
					await wait(MEASURE_RETRY_INTERVAL_MS);
				}
				if (isCancelled) return;

				const entries = await Promise.all(
					targetKeys.map(async (targetKey) => [targetKey, await measureTarget(targetKey, targetRefs)] as const),
				);
				latestMeasurements = Object.fromEntries(entries.filter(([, rect]) => rect !== null)) as MeasuredTargets;

				// optionalを含め全ターゲットが揃えば、最終リトライを待たずに表示できる。
				if (targetKeys.every((targetKey) => latestMeasurements[targetKey])) {
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
			let entries: readonly (readonly [TopicsTutorialTargetKey, TopicsTutorialRect | null])[] = [];

			// ステップ切替直後の1フレームだけrefが不安定でも閉じないよう、短く再試行する。
			for (let attempt = 0; attempt < 3; attempt += 1) {
				if (attempt > 0) {
					await wait(MEASURE_RETRY_INTERVAL_MS);
				}
				if (isCancelled) return;

				entries = await Promise.all(
					currentStep.targetKeys.map(
						async (targetKey) => [targetKey, await measureTarget(targetKey, targetRefs)] as const,
					),
				);
				if (entries.every(([, rect]) => rect !== null)) break;
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
			.filter((rect): rect is TopicsTutorialRect => rect !== undefined)
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
		const progress = i18n.t("Topics.tutorial.progressAccessibility", {
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
	const progressLabel = i18n.t("Topics.tutorial.progress", {
		current: currentStepIndex + 1,
		total: availableSteps.length,
	});
	const progressAccessibilityLabel = i18n.t("Topics.tutorial.progressAccessibility", {
		current: currentStepIndex + 1,
		total: availableSteps.length,
	});
	const maskId = `topics-tutorial-mask-${requestId}`;

	return (
		<Modal
			visible
			transparent
			statusBarTranslucent
			presentationStyle="overFullScreen"
			animationType={reduceMotionEnabled ? "none" : "fade"}
			onRequestClose={handleSkip}>
			<View style={styles.overlay} testID="topics-tutorial-overlay" accessibilityViewIsModal pointerEvents="auto">
				{/* 白いMaskから対象部分を黒で抜き、複数箇所を同時に透明化する。 */}
				<Svg pointerEvents="none" width={windowWidth} height={windowHeight} style={StyleSheet.absoluteFillObject}>
					<Defs>
						<Mask id={maskId}>
							<SvgRect x={0} y={0} width={windowWidth} height={windowHeight} fill="#FFFFFF" />
							{activeTargetRects.map((rect, index) => (
								<SvgRect
									key={`mask-hole-${index}`}
									x={rect.x}
									y={rect.y}
									width={rect.width}
									height={rect.height}
									rx={14}
									ry={14}
									fill="#000000"
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
					testID={`topics-tutorial-step-${currentStep.id}`}>
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
								testID="topics-tutorial-progress">
								{progressLabel}
							</Text>
						</View>

						<View style={styles.actions}>
							<TouchableOpacity
								onPress={handleSkip}
								style={styles.skipButton}
								accessibilityRole="button"
								testID="topics-tutorial-skip">
								<Text style={styles.skipButtonText}>{i18n.t("Topics.tutorial.skip")}</Text>
							</TouchableOpacity>
							<TouchableOpacity
								onPress={handlePrimaryAction}
								style={styles.primaryButton}
								accessibilityRole="button"
								testID={isLastStep ? "topics-tutorial-finish" : "topics-tutorial-next"}>
								<Text style={styles.primaryButtonText}>
									{i18n.t(isLastStep ? "Topics.tutorial.finish" : "Topics.tutorial.next")}
								</Text>
							</TouchableOpacity>
						</View>
					</ScrollView>
				</View>
			</View>
		</Modal>
	);
}

const styles = StyleSheet.create({
	overlay: {
		flex: 1,
	},
	callout: {
		position: "absolute",
		backgroundColor: "#FFFFFF",
		borderRadius: 20,
		shadowColor: "#000000",
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
		backgroundColor: "#FFFFFF",
		transform: [{ rotate: "45deg" }],
	},
	arrowAbove: {
		top: -8,
	},
	arrowBelow: {
		bottom: -8,
	},
	title: {
		color: "#171717",
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
		color: "#4B5563",
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
		backgroundColor: "#D1D5DB",
	},
	activeDot: {
		width: 18,
		backgroundColor: "#F05537",
	},
	progress: {
		color: "#6B7280",
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
		color: "#6B7280",
		fontSize: 15,
		fontWeight: "700",
	},
	primaryButton: {
		minHeight: 44,
		minWidth: 104,
		paddingHorizontal: 20,
		borderRadius: 22,
		backgroundColor: "#F05537",
		alignItems: "center",
		justifyContent: "center",
	},
	primaryButtonText: {
		color: "#FFFFFF",
		fontSize: 15,
		fontWeight: "800",
	},
});
