// app-expo/features/mapMarkers/components/AvatarBubbleMarkerBitmap.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image as RNImage, Platform, View } from "react-native";
import type { MapMarkerProps as RNMarkerProps } from "react-native-maps";
import { Marker } from "@/components/MapView";
import {
	useMarkerBitmapRenderer,
	useMarkerBitmapState,
	normalizeColor,
	ACTIVE_COLOR_HEX,
	INACTIVE_COLOR_HEX,
} from "./MarkerBitmapRendererProvider";
import { BubblePinBitmap } from "./BubblePinBitmap";
import { FixedColors } from "@/constants/Palette";

/**
 * #235 AvatarBubbleMarkerBitmap
 *
 * @deprecated このコンポーネントは非推奨です。代わりに AvatarBubbleMarker を使用してください。
 * Bitmap Marker 方式（view-shot + FileSystem）はパフォーマンス問題（5秒以上の表示時間）があるため廃止されました。
 * View Marker 方式の AvatarBubbleMarker を使用することで、体感 1 秒未満の表示が可能になります。
 *
 * 🎯 目的
 * - MapView 直下には **Marker しか置かない**
 * - Android の View Marker 崩れ / 画像欠け / ちらつきを根治
 * - iOS の「icon が更新されない / ピンが消える」問題を根治
 *
 * 🧠 設計方針（重要）
 * 1. Marker children（View Marker）は原則使わない
 *    → bitmap（PNG）を icon / image として渡す
 *
 * 2. bitmap 未準備でも Marker は必ず表示する
 *    → 静的な placeholder PNG を使う（View fallback は使わない）
 *
 * 3. iOS は icon 更新が不安定なため image prop を優先
 *    → さらに icon/image 更新直後だけ tracksViewChanges を true にする
 *
 * 4. bitmap の生成状態は useSyncExternalStore で購読
 *    → React render 中の setState を完全排除
 */

type Props = RNMarkerProps & {
	uri?: string;
	size?: number;
	color?: string;
};

// 静的プレースホルダ（bitmap未準備時の安全弁）
// ※必ず存在するローカルアセットを使うこと
const PLACEHOLDER_IMAGE = require("../assets/marker-placeholder.png");

/*
#1629 【設計】既定色をテーマで振らない理由は `BubblePinBitmap` と同じ。
生成物（PNG）が地図タイルの上に置かれ、タイルは常にライト配色だからである。
*/
export function AvatarBubbleMarkerBitmap({ uri, size = 48, color = FixedColors.mapMarkerSurface, ...props }: Props) {
	const store = useMarkerBitmapRenderer();

	// ----------------------------
	// プレースホルダ画像 URI 生成
	// ----------------------------

	const PLACEHOLDER_URI = useMemo(() => {
		if (Platform.OS === "web") return "";
		const resolved = RNImage.resolveAssetSource(PLACEHOLDER_IMAGE);
		return resolved?.uri ?? "";
	}, []);
	const PLACEHOLDER_SOURCE = useMemo(() => ({ uri: PLACEHOLDER_URI }), [PLACEHOLDER_URI]);

	// ----------------------------
	// 色判定（正規化必須）
	// ----------------------------

	const normalizedColor = useMemo(() => normalizeColor(color), [color]);
	const isActive = normalizedColor === ACTIVE_COLOR_HEX;

	// ----------------------------
	// bitmap 状態購読
	// ----------------------------

	const NO_URI = "__marker__://no-uri";
	const realKeyUri = uri ? uri : NO_URI;
	const activeState = useMarkerBitmapState(realKeyUri, size, ACTIVE_COLOR_HEX);
	const inactiveState = useMarkerBitmapState(realKeyUri, size, INACTIVE_COLOR_HEX);

	// ----------------------------
	// プレースホルダ状態購読
	// ----------------------------

	const activePlaceholderState = useMarkerBitmapState("", size, ACTIVE_COLOR_HEX);
	const inactivePlaceholderState = useMarkerBitmapState("", size, INACTIVE_COLOR_HEX);

	const currentState = isActive ? activeState : inactiveState;

	// ----------------------------
	// 初回マウント時の生成方針
	// ----------------------------

	useEffect(() => {
		if (!uri || Platform.OS === "web") return;

		// 🟢 初回は「非アクティブ」を低優先度で一括生成
		// → 初期表示速度重視
		store.requestBitmap({
			uri,
			size,
			color: INACTIVE_COLOR_HEX,
			priority: "low",
		});
		// inactive だけでなく active もlow でリクエストしておく
		store.requestBitmap({
			uri,
			size,
			color: ACTIVE_COLOR_HEX,
			priority: "low",
		});
	}, [uri, size, store]);

	// ----------------------------
	// アクティブ化時のオンデマンド生成
	// ----------------------------

	useEffect(() => {
		if (!uri || Platform.OS === "web") return;

		if (isActive && !activeState.isReady && !activeState.isGenerating) {
			// 🔴 アクティブ化されたものだけ高優先度で生成
			store.requestBitmap({
				uri,
				size,
				color: ACTIVE_COLOR_HEX,
				priority: "high",
			});
		}
	}, [uri, size, isActive, activeState.isReady, activeState.isGenerating, store]);

	// ----------------------------
	// icon/image 更新保証（iOS 対策）
	// ----------------------------

	/**
	 * iOS では icon/image prop の更新が不安定なため、
	 * - bitmap URI が変わったとき
	 * - placeholder から bitmap に切り替わったとき
	 * の直後だけ tracksViewChanges=true にする
	 */
	const [tracksViewChanges, setTracksViewChanges] = useState(false);
	const lastIconUriRef = useRef<string | undefined>(undefined);
	const isPlaceholder = !(currentState.isReady && currentState.iconUri);
	const shouldTrackViewChanges = Platform.OS === "ios" ? isPlaceholder || tracksViewChanges : tracksViewChanges;

	useEffect(() => {
		if (currentState.iconUri && currentState.iconUri !== lastIconUriRef.current) {
			lastIconUriRef.current = currentState.iconUri;

			// 一時的に更新を許可
			setTracksViewChanges(true);

			// 少し待ってから false に戻す（ちらつき防止）
			const timer = setTimeout(() => {
				setTracksViewChanges(false);
			}, 250);

			return () => clearTimeout(timer);
		}
	}, [currentState.iconUri]);

	// ----------------------------
	// Web は従来方式（View Marker）
	// ----------------------------

	if (Platform.OS === "web") {
		return (
			<Marker {...props}>
				<View style={{ width: size, height: size + 4 }}>
					<BubblePinBitmap uri={uri} size={size} color={color} />
				</View>
			</Marker>
		);
	}

	// ----------------------------
	// Marker 表示ロジック（最重要）
	// ----------------------------

	/**
	 * ❗️絶対ルール
	 * - Marker を null で返さない
	 * - bitmap 未準備でも必ず表示する
	 */

	// 表示する画像 URI（優先順位）
	// 1. 生成済み bitmap
	// 2. 静的 placeholder
	const realState = isActive ? activeState : inactiveState;
	const placeholderState = isActive ? activePlaceholderState : inactivePlaceholderState;
	// 表示優先順位：real → renderer placeholder → static placeholder(保険)
	const imageSource =
		realState.isReady && realState.iconUri
			? { uri: realState.iconUri }
			: placeholderState.isReady && placeholderState.iconUri
				? { uri: placeholderState.iconUri }
				: PLACEHOLDER_SOURCE;

	// iOS は image prop を優先（icon 更新不安定対策）
	const markerImageProps = { icon: imageSource };

	return (
		<Marker
			{...props}
			{...markerImageProps}
			tracksViewChanges={shouldTrackViewChanges}
			anchor={{ x: 0.5, y: 0.85 }} // tail を考慮して下寄せ
		/>
	);
}
