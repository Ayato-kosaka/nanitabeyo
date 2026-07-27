import React, { useCallback, useMemo, useRef, useState } from "react";
import {
	View,
	Text,
	PanResponder,
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

// #935 【設計】距離スライダーの再実装。旧実装は以下の不具合を抱えていた:
//   1. gestureState.moveX のマジックナンバー補正で相対座標を誤変換していた
//   2. トラックタップ・十分なヒット領域・アクセシビリティ操作に対応していなかった
//   3. ScrollView の縦スクロールと競合し、PanResponder も毎レンダー生成していた
// 本実装は onLayout で実測したトラック幅と locationX を使い、端末サイズに依存しない。

const THUMB_SIZE = 28;
const TICK_SIZE = 6;
const THUMB_HIT_SLOP = { top: 16, bottom: 16, left: 16, right: 16 };
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
	const Icon = TRAVEL_MODE_ICONS[estimate.mode];
	const modeLabel = i18n.t(TRAVEL_MODE_LABEL_KEYS[estimate.mode]);
	const minutesLabel = i18n.t("Search.DistanceSlider.approxMinutes", { minutes: estimate.minutes });

	return (
		<View
			style={[styles.estimateChip, secondary && styles.secondaryEstimateChip]}
			accessibilityLabel={`${modeLabel} ${minutesLabel}`}
			testID={`search-distance-estimate-${estimate.mode}`}>
			<Icon size={16} color={secondary ? "#6B7280" : "#F05537"} />
			<Text style={styles.estimateLabel}>{modeLabel}</Text>
			<Text style={[styles.estimateMinutes, secondary && styles.secondaryEstimateMinutes]}>{minutesLabel}</Text>
		</View>
	);
}

export function DistanceSlider({ distance, setDistance }: DistanceSliderProps) {
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

	// #935 【設計】PanResponder は生成時のクロージャを使い続けるため、最新値を ref 経由で参照する
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
			if (width <= 0) return;
			const ratio = Math.max(0, Math.min(1, locationX / width));
			commitIndex(Math.round(ratio * (distanceOptions.length - 1)));
		},
		[commitIndex],
	);

	const panResponder = useRef(
		PanResponder.create({
			onStartShouldSetPanResponder: () => true,
			onMoveShouldSetPanResponder: (_evt, gestureState) =>
				Math.abs(gestureState.dx) > DRAG_ACTIVATION_THRESHOLD_PX &&
				Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
			onPanResponderGrant: (evt) => {
				updateFromLocationX(evt.nativeEvent.locationX);
			},
			onPanResponderMove: (evt) => {
				updateFromLocationX(evt.nativeEvent.locationX);
			},
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
				hitSlop={THUMB_HIT_SLOP}
				{...panResponder.panHandlers}
				accessibilityRole="adjustable"
				accessibilityLabel={i18n.t("Search.sections.distance")}
				accessibilityActions={[
					{ name: "increment", label: i18n.t("Search.DistanceSlider.far") },
					{ name: "decrement", label: i18n.t("Search.DistanceSlider.near") },
				]}
				onAccessibilityAction={handleAccessibilityAction}
				aria-valuemin={0}
				aria-valuemax={distanceOptions.length - 1}
				aria-valuenow={currentIndex}
				aria-valuetext={i18n.t(currentOption.label)}
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
			</View>

			<View
				style={styles.estimateRow}
				accessibilityRole="list"
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
							{i18n.t(showAllEstimates ? "Search.DistanceSlider.showLess" : "Search.DistanceSlider.showMore")}
						</Text>
						{showAllEstimates ? (
							<ChevronUp size={14} color="#F05537" />
						) : (
							<ChevronDown size={14} color="#F05537" />
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

const styles = StyleSheet.create({
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
		color: "#6B7280",
	},
	distanceBadge: {
		backgroundColor: "#FDEBE7",
		paddingHorizontal: 12,
		paddingVertical: 5,
		borderRadius: 14,
	},
	distanceValue: {
		fontSize: 16,
		fontWeight: "700",
		color: "#F05537",
	},
	sliderTrack: {
		height: 6,
		backgroundColor: "#D1D5DB",
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
		backgroundColor: "#F05537",
		borderRadius: 3,
	},
	sliderTick: {
		position: "absolute",
		width: TICK_SIZE,
		height: TICK_SIZE,
		borderRadius: TICK_SIZE / 2,
		backgroundColor: "#D1D5DB",
	},
	activeSliderTick: {
		backgroundColor: "#F05537",
	},
	sliderThumb: {
		position: "absolute",
		width: THUMB_SIZE,
		height: THUMB_SIZE,
		backgroundColor: "#FFFFFF",
		borderRadius: THUMB_SIZE / 2,
		top: -11,
		borderWidth: 3,
		borderColor: "#F05537",
		shadowColor: "#000000",
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
		backgroundColor: "#FFF7F5",
		paddingHorizontal: 10,
		paddingVertical: 7,
		borderRadius: 16,
	},
	secondaryEstimateChip: {
		backgroundColor: "#F3F4F6",
	},
	estimateLabel: {
		fontSize: 12,
		fontWeight: "600",
		color: "#111827",
	},
	estimateMinutes: {
		fontSize: 12,
		fontWeight: "700",
		color: "#F05537",
	},
	secondaryEstimateMinutes: {
		color: "#4B5563",
	},
	moreButton: {
		flexDirection: "row",
		alignItems: "center",
		gap: 2,
		paddingHorizontal: 4,
		paddingVertical: 7,
	},
	moreButtonText: {
		fontSize: 12,
		fontWeight: "600",
		color: "#F05537",
	},
});
