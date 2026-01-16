// app-expo/features/mapMarkers/components/AvatarBubbleMarker.tsx

import React, { useMemo, useState, useCallback } from "react";
import { View, Platform, StyleSheet } from "react-native";
import { Marker } from "@/components/MapView";
import { Image } from "expo-image";
import type { MapMarkerProps as RNMarkerProps } from "react-native-maps";
import { normalizeColor, ACTIVE_COLOR_HEX, INACTIVE_COLOR_HEX } from "./MarkerBitmapRendererProvider";

/**
 * #235 AvatarBubbleMarker（View Marker版）
 *
 * 🎯 目的
 * - Bitmap Marker 方式（view-shot + FileSystem）を廃止し、View Marker に移行
 * - Map画面の初回表示・マーカー表示を体感 1 秒未満にする
 * - iOS / Android でマーカーの崩れ・チラつきを最小化
 *
 * 🧠 設計方針
 * 1. Marker children に View を直接配置（Bitmap 生成なし）
 * 2. 画像キャッシュは expo-image に任せる
 * 3. tracksViewChanges は「ローディング中だけ true」（iOS 描画バグ対策）
 * 4. Web は従来どおり View Marker で問題なし
 */

type Props = RNMarkerProps & {
	uri?: string;
	size?: number;
	color?: string;
};

export function AvatarBubbleMarker({ uri, size = 48, color = "#FFFFFF", ...props }: Props) {
	const normalizedColor = useMemo(() => normalizeColor(color), [color]);
	const isActive = normalizedColor === ACTIVE_COLOR_HEX;

	// #235 【パフォーマンス】画像ロード状態で tracksViewChanges を制御（iOS ちらつき対策）
	const [tracksViewChanges, setTracksViewChanges] = useState(true);

	const handleLoadEnd = useCallback(() => {
		// #235 【パフォーマンス】少し余裕を持って false にする（iOS ちらつき対策）
		setTimeout(() => setTracksViewChanges(false), 200);
	}, []);

	const bubbleSize = size;
	const imageSize = size - 4; // 枠分少し小さく

	return (
		<Marker {...props} tracksViewChanges={tracksViewChanges} anchor={{ x: 0.5, y: 0.85 }}>
			<View style={[styles.container, { width: bubbleSize, height: bubbleSize + 4 }]}>
				{/* 吹き出し本体 */}
				<View
					style={[
						styles.bubble,
						{
							width: bubbleSize,
							height: bubbleSize,
							borderColor: isActive ? ACTIVE_COLOR_HEX : INACTIVE_COLOR_HEX,
						},
					]}>
					<Image
						style={[
							styles.image,
							{
								width: imageSize,
								height: imageSize,
							},
						]}
						source={uri ? { uri } : undefined}
						contentFit="cover"
						// #235 【設計】expo-image の機能で丸表示 + transition
						transition={100}
						onLoadEnd={handleLoadEnd}
					/>
				</View>
				{/* 吹き出しの尻尾 */}
				<View
					style={[
						styles.tail,
						{
							borderTopColor: isActive ? ACTIVE_COLOR_HEX : INACTIVE_COLOR_HEX,
						},
					]}
				/>
			</View>
		</Marker>
	);
}

const styles = StyleSheet.create({
	container: {
		alignItems: "center",
		justifyContent: "flex-start",
	},
	bubble: {
		borderWidth: 2,
		borderRadius: 9999,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#FFFFFF",
		overflow: "hidden",
	},
	image: {
		borderRadius: 9999,
	},
	tail: {
		width: 0,
		height: 0,
		borderTopWidth: 6,
		borderLeftWidth: 6,
		borderRightWidth: 6,
		borderLeftColor: "transparent",
		borderRightColor: "transparent",
		marginTop: -1,
	},
});
