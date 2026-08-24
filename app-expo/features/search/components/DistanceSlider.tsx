import React, { useCallback, useMemo, useRef, useState } from "react";
import {
	View,
	Text,
	PanResponder,
	Pressable,
	StyleSheet,
	TouchableOpacity,
	type LayoutChangeEvent,
} from "react-native";
import { Bike, CarFront, ChevronDown, ChevronUp, Footprints, TrainFront } from "lucide-react-native";
import { distanceOptions } from "@/features/search/constants";
import {
	getRecommendedTravelTimeEstimates,
	getTravelTimeEstimates,
	type TravelMode,
	type TravelTimeEstimate,
} from "@/features/search/travelTimeEstimates";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

// #935 【設計】距離スライダーの再実装。旧実装は以下の不具合を抱えていた:
//   1. `gestureState.moveX - 50` というマジックナンバーで画面絶対座標→トラック相対座標を
//      誤変換していた(実際のオフセットは画面幅に依存し、広い画面ほどズレて端に張り付く)
//   2. onPanResponderGrant が無く、タップしても値が変わらなかった(トラックタップ不可)
//   3. サム(28×28)のみタッチ対象でヒットスロップも無く、指が少しズレるだけで操作できなかった
//   4. PanResponder.create を毎レンダー再生成しており、パフォーマンス上望ましくなかった
//   5. ScrollView 内でも常にレスポンダを奪うため、縦スクロールと衝突しうる状態だった
//   6. accessibilityRole 等が無く、スクリーンリーダー・キーボードで操作できなかった
// 本実装は onLayout で実測したトラック幅を使い、locationX ベースで位置を計算することで
// 端末サイズに依存しない正確なタップ/ドラッグ操作を実現する。

const THUMB_SIZE = 28;
const TICK_SIZE = 6;
const THUMB_HIT_SLOP = { top: 19, bottom: 19, left: 19, right: 19 };
// ドラッグとして確定する最小水平移動量。ScrollView の縦スクロールと共存させるため、
// 「横方向の移動が縦方向より明確に大きい」場合のみこのスライダーがジェスチャーを奪う
const DRAG_ACTIVATION_THRESHOLD_PX = 4;

const TRAVEL_MODE_LABEL_KEYS = {
	walk: "Search.DistanceSlider.modes.walk",
	bike: "Search.DistanceSlider.modes.bike",
	car: "Search.DistanceSlider.modes.car",
	train: "Search.DistanceSlider.modes.train",
} as const satisfies Record<TravelMode, string>;

const TRAVEL_MODE_ICONS = {
	walk: Footprints,
	bike: Bike,
	car: CarFront,
	train: TrainFront,
} as const;

interface DistanceSliderProps {
	distance: number;
	setDistance: (value: number) => void;
}

function TravelEstimateChip({ estimate, secondary = false }: { estimate: TravelTimeEstimate; secondary?: boolean }) {
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const Icon = TRAVEL_MODE_ICONS[estimate.mode];
	const modeLabel = i18n.t(TRAVEL_MODE_LABEL_KEYS[estimate.mode]);
	const minutesLabel = i18n.t("Search.DistanceSlider.approxMinutes", {
		minutes: estimate.minutes,
	});

	return (
		<View
			style={[styles.estimateChip, secondary && styles.secondaryEstimateChip]}
			accessibilityLabel={`${modeLabel} ${minutesLabel}`}
			testID={`search-distance-estimate-${estimate.mode}`}>
			<Icon size={16} color={secondary ? colors.textSecondary : colors.brand} />
			<Text style={styles.estimateLabel}>{modeLabel}</Text>
			<Text style={[styles.estimateMinutes, secondary && styles.secondaryEstimateMinutes]}>{minutesLabel}</Text>
		</View>
	);
}

export function DistanceSlider({ distance, setDistance }: DistanceSliderProps) {
	// #1509 検索フォーム直下の部品。基盤と同じ PR でテーマ対応する
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { selectionChanged } = useHaptics();
	const [trackWidth, setTrackWidth] = useState(0);
	const [showAllEstimates, setShowAllEstimates] = useState(false);

	const currentIndex = useMemo(() => {
		const index = distanceOptions.findIndex((option) => option.value === distance);
		return index === -1 ? 0 : index;
	}, [distance]);

	const allEstimates = useMemo(() => getTravelTimeEstimates(distance), [distance]);
	const recommendedEstimates = useMemo(() => getRecommendedTravelTimeEstimates(distance), [distance]);
	const recommendedModes = useMemo(
		() => new Set(recommendedEstimates.map((estimate) => estimate.mode)),
		[recommendedEstimates],
	);
	const otherEstimates = useMemo(
		() => allEstimates.filter((estimate) => !recommendedModes.has(estimate.mode)),
		[allEstimates, recommendedModes],
	);

	// #935 【設計】PanResponder のコールバックは生成時のクロージャを使い続けるため、
	// 最新値を ref 経由で参照する(useRef で1回だけ生成し毎レンダーの再生成を避けるため)
	const trackWidthRef = useRef(trackWidth);
	trackWidthRef.current = trackWidth;
	const currentIndexRef = useRef(currentIndex);
	currentIndexRef.current = currentIndex;
	const setDistanceRef = useRef(setDistance);
	setDistanceRef.current = setDistance;
	const selectionChangedRef = useRef(selectionChanged);
	selectionChangedRef.current = selectionChanged;

	const commitIndex = useCallback((newIndex: number) => {
		const clamped = Math.max(0, Math.min(distanceOptions.length - 1, newIndex));
		if (clamped !== currentIndexRef.current) {
			currentIndexRef.current = clamped;
			selectionChangedRef.current();
			setDistanceRef.current(distanceOptions[clamped].value);
		}
	}, []);

	const updateFromLocationX = useCallback(
		(locationX: number) => {
			const width = trackWidthRef.current;
			if (width <= 0 || !Number.isFinite(locationX)) return;
			const ratio = Math.max(0, Math.min(1, locationX / width));
			commitIndex(Math.round(ratio * (distanceOptions.length - 1)));
		},
		[commitIndex],
	);

	// #935 【設計】タップ位置のトラック相対Xを取り出す。native の PressEvent は locationX を
	// 持つが、web(react-native-web)のクリックでは nativeEvent が DOM MouseEvent 相当で
	// locationX が無いため、同じ意味を持つ offsetX(ターゲット相対X)へフォールバックする
	const handleTrackPress = useCallback(
		(event: { nativeEvent: { locationX?: number; offsetX?: number } }) => {
			updateFromLocationX(event.nativeEvent.locationX ?? event.nativeEvent.offsetX ?? Number.NaN);
		},
		[updateFromLocationX],
	);

	// #935 【修正】ドラッグ開始時のトラック相対X。移動中は locationX を読まず、
	// この起点 + gestureState.dx(画面座標ベースの累積差分)で位置を計算する。
	// locationX は「今タッチしているビュー」基準のため、Android では指が高さ6pxの
	// トラックから縦に外れた瞬間に基準が変わって値が飛び、サムが往復する(ブルブル)
	// 不具合の原因になっていた。dx はビューに依存せず安定している。
	const grantLocationXRef = useRef(0);

	const panResponder = useRef(
		PanResponder.create({
			// #935 【修正】PR #980 レビュー指摘: タッチ開始で即レスポンダを奪うと、
			// トラック(+ヒットスロップ)上から始まる縦スワイプまで奪ってしまい、
			// 親の検索 ScrollView がスクロールできなくなる。開始時は奪わず、
			// 「横方向の移動が確定した」ときだけ奪う(タップは下の Pressable が担う)
			onStartShouldSetPanResponder: () => false,
			onMoveShouldSetPanResponder: (_evt, gestureState) =>
				Math.abs(gestureState.dx) > DRAG_ACTIVATION_THRESHOLD_PX &&
				Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
			onPanResponderGrant: (evt, gestureState) => {
				// #935 【設計】grant は横移動の確定後に来るため、locationX から確定までの
				// 累積移動量(dx)を引き戻してタッチ開始時点のトラック相対Xを復元する
				grantLocationXRef.current = evt.nativeEvent.locationX - gestureState.dx;
				updateFromLocationX(evt.nativeEvent.locationX);
			},
			onPanResponderMove: (_evt, gestureState) => {
				updateFromLocationX(grantLocationXRef.current + gestureState.dx);
			},
			// #935 【修正】横ドラッグ確定後に指が縦へずれても親 ScrollView へ譲渡しない
			// (譲渡すると交互に掴んで表示が震える)。縦スワイプはそもそも上の条件で
			// レスポンダを取らないため、スクロールを妨げない
			onPanResponderTerminationRequest: () => false,
		}),
	).current;

	const handleTrackLayout = useCallback((event: LayoutChangeEvent) => {
		setTrackWidth(event.nativeEvent.layout.width);
	}, []);

	const decrement = useCallback(() => {
		commitIndex(currentIndexRef.current - 1);
	}, [commitIndex]);

	const increment = useCallback(() => {
		commitIndex(currentIndexRef.current + 1);
	}, [commitIndex]);

	// #935 【設計】iOS/Android の adjustable ロール向け increment/decrement アクション
	const handleAccessibilityAction = useCallback(
		(event: { nativeEvent: { actionName: string } }) => {
			switch (event.nativeEvent.actionName) {
				case "increment":
					increment();
					break;
				case "decrement":
					decrement();
					break;
			}
		},
		[increment, decrement],
	);

	// #935 【修正】web は accessibilityActions が効かないため、矢印キーで同等の操作を行えるようにする。
	// react-native-web はこの View を最終的に div として描画し、未知の onKeyDown はそのまま
	// DOM イベントハンドラとして forward されるため native 側には影響しない
	const handleKeyDown = useCallback(
		(event: { key: string; preventDefault: () => void }) => {
			if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
				event.preventDefault();
				decrement();
			} else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
				event.preventDefault();
				increment();
			}
		},
		[increment, decrement],
	);

	const toggleEstimates = useCallback(() => {
		selectionChanged();
		setShowAllEstimates((current) => !current);
	}, [selectionChanged]);

	const currentOption = distanceOptions[currentIndex];
	const thumbCenter = trackWidth > 0 ? (currentIndex / (distanceOptions.length - 1)) * trackWidth : 0;
	const thumbPosition = thumbCenter - THUMB_SIZE / 2;

	return (
		<View style={styles.sliderContainer}>
			<View style={styles.sliderHeader}>
				<Text style={styles.sliderHint}>{i18n.t("Search.DistanceSlider.edgeEstimate")}</Text>
				<View style={styles.distanceBadge}>
					<Text style={styles.distanceValue}>{i18n.t(currentOption.label)}</Text>
				</View>
			</View>

			<View
				style={styles.sliderTrack}
				onLayout={handleTrackLayout}
				// #935 【修正】視覚上の高さ(6px)より広い範囲でタップ/ドラッグを受け付ける
				hitSlop={THUMB_HIT_SLOP}
				{...panResponder.panHandlers}
				// #935 【修正】ネイティブなセマンティクス(adjustable=スライダー)を付与
				accessibilityRole="adjustable"
				accessibilityLabel={i18n.t("Search.sections.distance")}
				accessibilityActions={[
					{ name: "increment", label: i18n.t("Search.DistanceSlider.far") },
					{ name: "decrement", label: i18n.t("Search.DistanceSlider.near") },
				]}
				onAccessibilityAction={handleAccessibilityAction}
				// [注意] react-native-web は accessibilityValue を DOM の aria-value* へ変換しないため
				// (#930/#934 と同種の既知の非対応)、native/web 両対応の aria-value* を直接指定する
				aria-valuemin={0}
				aria-valuemax={distanceOptions.length - 1}
				aria-valuenow={currentIndex}
				aria-valuetext={i18n.t(currentOption.label)}
				// #935 【修正】web でキーボードのタブ移動・矢印操作を受け付けられるようにする。
				// onKeyDown は RN の ViewProps 型には無い web専用の DOM イベントだが、
				// react-native-web は未知のプロパティをそのまま div へ forward するため実際には機能する
				focusable
				{...({ onKeyDown: handleKeyDown } as Record<string, unknown>)}
				testID="search-distance-slider">
				<View pointerEvents="none" style={[styles.sliderProgress, { width: thumbCenter }]} />
				{distanceOptions.map((option, index) => {
					const tickCenter = trackWidth > 0 ? (index / (distanceOptions.length - 1)) * trackWidth : 0;
					return (
						<View
							key={option.value}
							pointerEvents="none"
							style={[
								styles.sliderTick,
								index <= currentIndex && styles.activeSliderTick,
								{ left: tickCenter - TICK_SIZE / 2 },
							]}
						/>
					);
				})}
				<View pointerEvents="none" style={[styles.sliderThumb, { left: thumbPosition }]} />
				{/* #935 【設計】タップでのジャンプは PanResponder(移動確定時のみ奪う)では
				    受け取れないため、トラックと同じ矩形の Pressable が担う。移動を伴う操作は
				    親トラックの onMoveShouldSetPanResponder(横)か ScrollView(縦)が
				    この Pressable からレスポンダを引き継ぐため、役割が競合しない。
				    (装飾ではなく操作面のため pointerEvents は生かし、読み上げは親に集約する) */}
				<Pressable
					style={StyleSheet.absoluteFill}
					hitSlop={THUMB_HIT_SLOP}
					onPress={handleTrackPress}
					accessibilityElementsHidden
					importantForAccessibility="no"
				/>
			</View>

			{/* #989 【修正】accessibilityRole="list" は子に listitem を要求するため(axe:
			    aria-required-children critical)、チップ+ボタン混在のこの行には付与しない。
			    各チップは accessibilityLabel で個別に読み上げられるため list 化は不要 */}
			<View
				style={styles.estimateRow}
				accessibilityHint={i18n.t("Search.DistanceSlider.estimateHint")}
				testID="search-distance-recommended-estimates">
				{recommendedEstimates.map((estimate) => (
					<TravelEstimateChip key={estimate.mode} estimate={estimate} />
				))}
				{otherEstimates.length > 0 && (
					<TouchableOpacity
						style={styles.moreButton}
						onPress={toggleEstimates}
						accessibilityRole="button"
						accessibilityState={{ expanded: showAllEstimates }}
						testID="search-distance-estimates-toggle">
						<Text style={styles.moreButtonText}>
							{showAllEstimates ? i18n.t("Search.DistanceSlider.showLess") : i18n.t("Search.DistanceSlider.showMore")}
						</Text>
						{showAllEstimates ? (
							<ChevronUp size={14} color={colors.brand} />
						) : (
							<ChevronDown size={14} color={colors.brand} />
						)}
					</TouchableOpacity>
				)}
			</View>

			{showAllEstimates && (
				<View style={styles.estimateRow} testID="search-distance-other-estimates">
					{otherEstimates.map((estimate) => (
						<TravelEstimateChip key={estimate.mode} estimate={estimate} secondary />
					))}
				</View>
			)}
		</View>
	);
}

// #1509 【設計】テーマ依存のスタイルはファクトリで組む（`contexts/ThemeProvider.tsx` の useThemedStyles）。
// 値はすべて main のリテラルをそのまま `constants/Palette.ts` の light へ写したもので、ライトの見た目は変わらない。
const createStyles = (c: Palette) =>
	StyleSheet.create({
		sliderContainer: {
			width: "100%",
		},
		sliderHeader: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 12,
			marginBottom: 14,
		},
		sliderHint: {
			flex: 1,
			fontSize: 12,
			lineHeight: 18,
			color: c.textSecondary,
		},
		distanceBadge: {
			backgroundColor: c.brandTint,
			paddingHorizontal: 12,
			paddingVertical: 5,
			borderRadius: 14,
		},
		distanceValue: {
			fontSize: 16,
			fontWeight: "700",
			color: c.brand,
		},
		sliderTrack: {
			height: 6,
			backgroundColor: c.trackMuted,
			borderRadius: 3,
			position: "relative",
			marginHorizontal: THUMB_SIZE / 2,
			marginBottom: 18,
		},
		sliderProgress: {
			position: "absolute",
			left: 0,
			top: 0,
			height: 6,
			backgroundColor: c.brand,
			borderRadius: 3,
		},
		sliderTick: {
			position: "absolute",
			width: TICK_SIZE,
			height: TICK_SIZE,
			borderRadius: TICK_SIZE / 2,
			backgroundColor: c.trackMuted,
		},
		activeSliderTick: {
			backgroundColor: c.brand,
		},
		sliderThumb: {
			position: "absolute",
			width: THUMB_SIZE,
			height: THUMB_SIZE,
			backgroundColor: c.surface,
			borderRadius: THUMB_SIZE / 2,
			top: -11,
			borderWidth: 3,
			borderColor: c.brand,
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 2 },
			shadowOpacity: 0.12,
			shadowRadius: 4,
			elevation: 4,
		},
		estimateRow: {
			flexDirection: "row",
			alignItems: "center",
			flexWrap: "wrap",
			gap: 8,
		},
		estimateChip: {
			flexDirection: "row",
			alignItems: "center",
			gap: 5,
			backgroundColor: c.brandTintSoft,
			paddingHorizontal: 10,
			paddingVertical: 7,
			borderRadius: 16,
		},
		secondaryEstimateChip: {
			backgroundColor: c.surfaceSubtle,
		},
		estimateLabel: {
			fontSize: 12,
			fontWeight: "600",
			color: c.textPrimaryAlt,
		},
		estimateMinutes: {
			fontSize: 12,
			fontWeight: "700",
			color: c.brand,
		},
		secondaryEstimateMinutes: {
			color: c.textSecondaryAlt,
		},
		moreButton: {
			flexDirection: "row",
			alignItems: "center",
			gap: 2,
			minHeight: 44,
			paddingHorizontal: 4,
			paddingVertical: 7,
		},
		moreButtonText: {
			fontSize: 12,
			fontWeight: "600",
			color: c.brand,
		},
	});
