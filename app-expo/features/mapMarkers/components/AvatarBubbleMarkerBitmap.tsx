// app-expo/features/mapMarkers/components/AvatarBubbleMarkerBitmap.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image as RNImage, Platform, View } from "react-native";
import type { MapMarkerProps as RNMarkerProps } from "react-native-maps";
import { Marker } from "@/components/MapView";
import { useSkiaMarkerBitmap } from "../hooks/useSkiaMarkerBitmap";
import { BubblePinBitmap } from "./BubblePinBitmap";
import { normalizeColor, ACTIVE_COLOR_HEX, INACTIVE_COLOR_HEX } from "../utils/colorUtils";

/**
 * #235 AvatarBubbleMarkerBitmap（Skia版）
 *
 * 🎯 目的
 * - MapView 直下には **Marker しか置かない**
 * - Android の View Marker 崩れ / 画像欠け / ちらつきを根治
 * - iOS の「icon が更新されない / ピンが消える」問題を根治
 * - Skia ベースで高速なマーカー画像生成（view-shot / FileSystem 廃止）
 *
 * 🧠 設計方針（重要）
 * 1. Marker children（View Marker）は原則使わない
 *    → Skia で生成した bitmap（PNG）を icon / image として渡す
 *
 * 2. bitmap 未準備でも Marker は必ず表示する
 *    → 静的な placeholder PNG を使う（View fallback は使わない）
 *
 * 3. iOS は icon 更新が不安定なため icon prop を使用
 *    → さらに icon/image 更新直後だけ tracksViewChanges を true にする
 *
 * 4. Web は従来の View Marker を継続使用
 *    → Skia は iOS / Android のみ使用
 */

type Props = RNMarkerProps & {
	uri?: string;
	size?: number;
	color?: string;
};

// 静的プレースホルダ（bitmap未準備時の安全弁）
const PLACEHOLDER_IMAGE = require("../assets/marker-placeholder.png");

export function AvatarBubbleMarkerBitmap({ uri, size = 48, color = "#FFFFFF", ...props }: Props) {
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
	// iOS / Android は Skia 版
	// ----------------------------

	const key = {
		uri: uri ?? "", // 空文字でもOK（プレースホルダ扱い）
		size,
		color: isActive ? ACTIVE_COLOR_HEX : INACTIVE_COLOR_HEX,
	};

	const { source, isReady } = useSkiaMarkerBitmap(key);

	// 画像ソース（優先順位: Skia生成 → placeholder）
	const imageSource = source ?? PLACEHOLDER_SOURCE;

	// ----------------------------
	// icon/image 更新保証（iOS 対策）
	// ----------------------------

	/**
	 * iOS では icon prop の更新が不安定なため、
	 * - source が変わったとき
	 * の直後だけ tracksViewChanges=true にする
	 */
	const [tracksViewChanges, setTracksViewChanges] = useState(false);
	const lastIconUriRef = useRef<string | undefined>(undefined);

	useEffect(() => {
		const currentUri = source?.uri;
		if (currentUri && currentUri !== lastIconUriRef.current) {
			lastIconUriRef.current = currentUri;

			// 一時的に更新を許可
			setTracksViewChanges(true);

			// 少し待ってから false に戻す（ちらつき防止）
			const timer = setTimeout(() => {
				setTracksViewChanges(false);
			}, 250);

			return () => clearTimeout(timer);
		}
	}, [source?.uri]);

	// iOS は icon 更新が不安定なため、生成直後は tracksViewChanges を有効にする
	const shouldTrackViewChanges = Platform.OS === "ios" ? !isReady || tracksViewChanges : false;

	// ----------------------------
	// Marker 表示
	// ----------------------------

	return (
		<Marker
			{...props}
			icon={imageSource}
			tracksViewChanges={shouldTrackViewChanges}
			anchor={{ x: 0.5, y: 0.85 }} // tail を考慮して下寄せ
		/>
	);
}
