import React, { useCallback, useMemo, useRef, useState } from "react";
import { View, Text, PanResponder, StyleSheet, type LayoutChangeEvent } from "react-native";
import { distanceOptions } from "@/features/search/constants";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";

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
const THUMB_HIT_SLOP = { top: 16, bottom: 16, left: 16, right: 16 };
// ドラッグとして確定する最小水平移動量。ScrollView の縦スクロールと共存させるため、
// 「横方向の移動が縦方向より明確に大きい」場合のみこのスライダーがジェスチャーを奪う
const DRAG_ACTIVATION_THRESHOLD_PX = 4;

interface DistanceSliderProps {
	distance: number;
	setDistance: (value: number) => void;
}

export function DistanceSlider({ distance, setDistance }: DistanceSliderProps) {
	const { selectionChanged } = useHaptics();
	const [trackWidth, setTrackWidth] = useState(0);

	const currentIndex = useMemo(() => {
		const index = distanceOptions.findIndex((option) => option.value === distance);
		return index === -1 ? 0 : index;
	}, [distance]);

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
			if (width <= 0) return;
			const ratio = Math.max(0, Math.min(1, locationX / width));
			commitIndex(Math.round(ratio * (distanceOptions.length - 1)));
		},
		[commitIndex],
	);

	const panResponder = useRef(
		PanResponder.create({
			// #935 【修正】トラック全体をタップ対象にする(サム単体ではなくトラック View に付与)
			onStartShouldSetPanResponder: () => true,
			onMoveShouldSetPanResponder: (_evt, gestureState) =>
				Math.abs(gestureState.dx) > DRAG_ACTIVATION_THRESHOLD_PX &&
				Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
			// #935 【修正】タップした瞬間にその位置へジャンプする
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

	const currentOption = distanceOptions[currentIndex];
	const thumbPosition =
		trackWidth > 0 ? (currentIndex / (distanceOptions.length - 1)) * trackWidth - THUMB_SIZE / 2 : -THUMB_SIZE / 2;

	return (
		<View style={styles.sliderContainer}>
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
				<View style={[styles.sliderThumb, { left: thumbPosition }]} />
			</View>
			<View style={styles.sliderLabels}>
				<Text style={styles.sliderLabelLeft}>{i18n.t("Search.DistanceSlider.near")}</Text>
				<Text style={styles.sliderLabelRight}>{i18n.t("Search.DistanceSlider.far")}</Text>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	sliderContainer: {
		width: 300,
		justifyContent: "center",
	},
	sliderTrack: {
		height: 6,
		backgroundColor: "#C9C9C9",
		borderRadius: 3,
		position: "relative",
		marginHorizontal: 16,
	},
	sliderThumb: {
		position: "absolute",
		width: THUMB_SIZE,
		height: THUMB_SIZE,
		backgroundColor: "#FFFFFF",
		borderRadius: THUMB_SIZE / 2,
		top: -11,
		borderWidth: 3,
		borderColor: "#000000",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.15,
		shadowRadius: 8,
		elevation: 6,
	},
	sliderLabels: {
		flexDirection: "row",
		justifyContent: "space-between",
		marginTop: 12,
		paddingHorizontal: 16,
	},
	sliderLabelLeft: {
		fontSize: 13,
		color: "#000000",
		fontWeight: "600",
	},
	sliderLabelRight: {
		fontSize: 13,
		color: "#000000",
		fontWeight: "600",
	},
});
