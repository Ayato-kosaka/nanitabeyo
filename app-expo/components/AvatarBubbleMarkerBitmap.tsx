import React, { useEffect } from "react";
import { View, Platform } from "react-native";
import { Marker } from "./MapView";
import type { MapMarkerProps as RNMarkerProps } from "react-native-maps";
import { useMarkerBitmap } from "@/hooks/useMarkerBitmap";
import { BubblePinBitmap } from "./BubblePinBitmap";

type Props = RNMarkerProps & {
	uri: string | undefined;
	size?: number;
	color?: string;
};

/**
 * #235 【設計】bitmap icon 方式の Map ピンコンポーネント
 *
 * Android での円形崩れ・ちらつきを根治するため、Marker children（View Marker）を廃止し、
 * 事前生成した bitmap（PNG）を Marker icon として表示する。
 *
 * アクティブ/非アクティブ状態は color を切り替えて、対応する2種類の PNG を利用。
 */
export function AvatarBubbleMarkerBitmap({ uri, size = 48, color = "#FFF", ...props }: Props) {
	// #235 【設計】アクティブ（青枠）/非アクティブ（白枠）の2種類の bitmap を生成・管理
	const activeMarker = useMarkerBitmap({ uri, size, color: "rgb(52, 119, 248)" });
	const inactiveMarker = useMarkerBitmap({ uri, size, color: "#FFF" });

	// #235 【設計】現在の状態に応じた bitmap を選択
	const isActive = color === "rgb(52, 119, 248)";
	const currentMarker = isActive ? activeMarker : inactiveMarker;

	// #235 【設計】初回マウント時に両方の bitmap を生成開始
	useEffect(() => {
		// Web環境ではbitmapを生成しない（標準のView Markerを使用）
		if (Platform.OS === "web") return;

		activeMarker.generateIfNeeded();
		inactiveMarker.generateIfNeeded();
	}, [uri]); // #235 【設計】uri変更時のみ再生成

	// #235 【設計】Web環境では従来のView Marker方式を使用（bitmap生成不要）
	if (Platform.OS === "web") {
		return (
			<Marker {...props}>
				<View style={{ width: size, height: size + 4 }}>
					<BubblePinBitmap uri={uri} size={size} color={color} />
				</View>
			</Marker>
		);
	}

	return (
		<>
			{/* #235 【設計】オフスクリーン描画用の View（画面外に配置） */}
			<View style={{ position: "absolute", left: -9999, top: -9999 }}>
				<View ref={activeMarker.viewRef}>
					<BubblePinBitmap uri={uri} size={size} color="rgb(52, 119, 248)" />
				</View>
				<View ref={inactiveMarker.viewRef}>
					<BubblePinBitmap uri={uri} size={size} color="#FFF" />
				</View>
			</View>

			{/* #235 【設計】bitmap icon を使用した Marker（children なし） */}
			{currentMarker.isReady && currentMarker.iconUri && (
				<Marker
					{...props}
					icon={{ uri: currentMarker.iconUri }}
					tracksViewChanges={false} // #235 【設計】ちらつき防止（bitmap固定）
					anchor={{ x: 0.5, y: 0.5 }} // #235 【設計】中央アンカー
				/>
			)}
		</>
	);
}
