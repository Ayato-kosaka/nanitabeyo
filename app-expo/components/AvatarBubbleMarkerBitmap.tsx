import React, { useEffect } from "react";
import { View, Platform } from "react-native";
import { Marker } from "./MapView";
import type { MapMarkerProps as RNMarkerProps } from "react-native-maps";
import {
	useMarkerBitmapRenderer,
	useMarkerBitmapState,
	normalizeColor,
	ACTIVE_COLOR_HEX,
	INACTIVE_COLOR_HEX,
} from "./MarkerBitmapRenderer";
import { BubblePinBitmap } from "./BubblePinBitmap";

type Props = RNMarkerProps & {
	uri: string | undefined;
	size?: number;
	color?: string;
};

/**
 * #235 【設計】bitmap icon 方式の Map ピンコンポーネント（外部ストア統合版）
 *
 * Android での円形崩れ・ちらつきを根治するため、Marker children（View Marker）を廃止し、
 * 事前生成した bitmap（PNG）を Marker icon として表示する。
 *
 * オフスクリーン描画は MarkerBitmapRenderer（MapView外）で一元管理し、
 * MapView 直下には Marker のみを配置する。
 *
 * 購読は useSyncExternalStore で実現し、React の render 規約に準拠。
 */
export function AvatarBubbleMarkerBitmap({ uri, size = 48, color = "#FFF", ...props }: Props) {
	const store = useMarkerBitmapRenderer();

	// #235 【設計】色を正規化して判定
	const normalizedInputColor = normalizeColor(color);
	const isActive = normalizedInputColor === ACTIVE_COLOR_HEX;

	// #235 【設計】アクティブ/非アクティブの状態を購読（useSyncExternalStore）
	const activeState = useMarkerBitmapState(uri ?? "", size, ACTIVE_COLOR_HEX);
	const inactiveState = useMarkerBitmapState(uri ?? "", size, INACTIVE_COLOR_HEX);

	// #235 【設計】初回マウント時に inactive を優先生成、subscribe → request の順
	useEffect(() => {
		if (!uri || Platform.OS === "web") return;

		// #235 【設計】inactive を優先生成（初回表示速度重視）
		store.requestBitmap({
			uri,
			size,
			color: INACTIVE_COLOR_HEX,
			priority: "low", // #235 【設計】初回は低優先度で一括生成
		});
	}, [uri, size, store]);

	// #235 【設計】アクティブ時にオンデマンド生成
	useEffect(() => {
		if (!uri || Platform.OS === "web") return;

		if (isActive && !activeState.isReady && !activeState.isGenerating) {
			store.requestBitmap({
				uri,
				size,
				color: ACTIVE_COLOR_HEX,
				priority: "high", // #235 【設計】アクティブ時は高優先度
			});
		}
	}, [isActive, uri, size, activeState.isReady, activeState.isGenerating, store]);

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

	// #235 【UX改善】生成中/失敗時もMarkerを必ず表示（プレースホルダ使用）
	// bitmap が準備できている場合は bitmap icon を使用、そうでない場合は View Marker でfallback
	return currentState.isReady && currentState.iconUri ? (
		<Marker
			{...props}
			icon={{ uri: currentState.iconUri }}
			tracksViewChanges={false} // #235 【設計】ちらつき防止（bitmap固定）
			anchor={{ x: 0.5, y: 0.85 }} // #235 【設計】tail考慮でアンカー調整（下寄せ）
		/>
	) : (
		<Marker {...props} anchor={{ x: 0.5, y: 0.85 }}>
			<View style={{ width: size, height: size + 4 }}>
				<BubblePinBitmap uri={uri} size={size} color={normalizedInputColor} />
			</View>
		</Marker>
	);
}
