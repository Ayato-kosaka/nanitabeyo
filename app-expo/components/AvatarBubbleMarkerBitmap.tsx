import React, { useEffect, useState } from "react";
import { View, Platform } from "react-native";
import { Marker } from "./MapView";
import type { MapMarkerProps as RNMarkerProps } from "react-native-maps";
import { useMarkerBitmapRenderer } from "./MarkerBitmapRenderer";
import { BubblePinBitmap } from "./BubblePinBitmap";

type Props = RNMarkerProps & {
	uri: string | undefined;
	size?: number;
	color?: string;
};

/**
 * #235 【設計】bitmap icon 方式の Map ピンコンポーネント（Renderer統合版）
 *
 * Android での円形崩れ・ちらつきを根治するため、Marker children（View Marker）を廃止し、
 * 事前生成した bitmap（PNG）を Marker icon として表示する。
 *
 * オフスクリーン描画は MarkerBitmapRenderer（MapView外）で一元管理し、
 * MapView 直下には Marker のみを配置する。
 *
 * アクティブ/非アクティブ状態は color を切り替えて、対応する2種類の PNG を利用。
 */
export function AvatarBubbleMarkerBitmap({ uri, size = 48, color = "#FFF", ...props }: Props) {
	const renderer = useMarkerBitmapRenderer();

	// #235 【設計】現在の状態に応じた bitmap を選択
	const isActive = color === "rgb(52, 119, 248)" || color === "#3477F8";
	const activeColor = "rgb(52, 119, 248)";
	const inactiveColor = "#FFF";

	// #235 【設計】アクティブ/非アクティブの状態を購読
	const [activeState, setActiveState] = useState(() => renderer.getState(uri ?? "", size, activeColor));
	const [inactiveState, setInactiveState] = useState(() => renderer.getState(uri ?? "", size, inactiveColor));

	// #235 【設計】初回マウント時に inactive を優先生成、active はオンデマンド
	useEffect(() => {
		if (!uri || Platform.OS === "web") return;

		// #235 【設計】inactive を優先生成（初回表示速度重視）
		renderer.requestBitmap({
			uri,
			size,
			color: inactiveColor,
			priority: "low", // #235 【設計】初回は低優先度で一括生成
		});

		// #235 【設計】active は購読のみ（オンデマンド生成）
		const unsubscribeActive = renderer.subscribe(uri, size, activeColor, setActiveState);
		const unsubscribeInactive = renderer.subscribe(uri, size, inactiveColor, setInactiveState);

		return () => {
			unsubscribeActive();
			unsubscribeInactive();
		};
	}, [uri, size, renderer]);

	// #235 【設計】アクティブ時にオンデマンド生成
	useEffect(() => {
		if (!uri || Platform.OS === "web") return;

		if (isActive && !activeState.isReady && !activeState.isGenerating) {
			renderer.requestBitmap({
				uri,
				size,
				color: activeColor,
				priority: "high", // #235 【設計】アクティブ時は高優先度
			});
		}
	}, [isActive, uri, size, activeState.isReady, activeState.isGenerating, renderer]);

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

	// #235 【設計】現在の状態に応じた bitmap を選択
	const currentState = isActive ? activeState : inactiveState;

	// #235 【設計】bitmap icon を使用した Marker（children なし）
	return currentState.isReady && currentState.iconUri ? (
		<Marker
			{...props}
			icon={{ uri: currentState.iconUri }}
			tracksViewChanges={false} // #235 【設計】ちらつき防止（bitmap固定）
			anchor={{ x: 0.5, y: 0.5 }} // #235 【設計】中央アンカー
		/>
	) : null;
}
