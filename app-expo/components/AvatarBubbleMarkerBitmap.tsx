// app-expo/components/AvatarBubbleMarkerBitmap.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import type { MapMarkerProps as RNMarkerProps } from "react-native-maps";
import { Marker } from "./MapView";
import {
	useMarkerBitmapRenderer,
	useMarkerBitmapState,
	normalizeColor,
	ACTIVE_COLOR_HEX,
	INACTIVE_COLOR_HEX,
} from "./MarkerBitmapRenderer";

/**
 * #235 AvatarBubbleMarkerBitmap
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
 *    → 生成中は default marker (react-native-maps の既定アイコン) を使う
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

export function AvatarBubbleMarkerBitmap({ uri, size = 48, color = "#FFFFFF", ...props }: Props) {
	const store = useMarkerBitmapRenderer();

	// ----------------------------
	// 色判定（正規化必須）
	// ----------------------------

	const normalizedColor = useMemo(() => normalizeColor(color), [color]);
	const isActive = normalizedColor === ACTIVE_COLOR_HEX;

	// ----------------------------
	// bitmap 状態購読
	// ----------------------------

	const activeState = useMarkerBitmapState(uri ?? "", size, ACTIVE_COLOR_HEX);

	const inactiveState = useMarkerBitmapState(uri ?? "", size, INACTIVE_COLOR_HEX);

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
	 * iOS では Marker の icon / image 更新が
	 * 反映されないことがあるため、
	 * bitmap 更新直後だけ tracksViewChanges を true にする。
	 */
	const [tracksViewChanges, setTracksViewChanges] = useState(false);
	const lastIconUriRef = useRef<string | undefined>(undefined);

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
		return <Marker {...props}>{/* Web は bitmap 生成不要。従来の View Marker を使う */}</Marker>;
	}

	// ----------------------------
	// Marker 表示ロジック（最重要）
	// ----------------------------

	/**
	 * ❗️絶対ルール
	 * - Marker を null で返さない
	 * - bitmap 未準備でも必ず表示する
	 *
	 * #235 【UX改善】bitmap 未準備時は react-native-maps のデフォルトマーカーを使用
	 * - 静的アセット不要（ビルド/デプロイ簡素化）
	 * - Android の View Marker 問題を回避（children を使わない）
	 */

	// bitmap 準備済みの場合のみ icon/image を指定
	const markerImageProps =
		currentState.isReady && currentState.iconUri
			? Platform.OS === "ios"
				? { image: { uri: currentState.iconUri } }
				: { icon: { uri: currentState.iconUri } }
			: {}; // 未準備時は props 空 = デフォルトマーカー

	return (
		<Marker
			{...props}
			{...markerImageProps}
			tracksViewChanges={tracksViewChanges}
			anchor={{ x: 0.5, y: 0.85 }} // tail を考慮して下寄せ
		/>
	);
}
