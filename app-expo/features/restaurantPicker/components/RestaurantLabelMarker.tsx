import React, { useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Marker } from "@/components/MapView";
import type { MapMarkerProps as RNMarkerProps } from "react-native-maps";
import { FixedColors } from "@/constants/Palette";
import { useMarkerViewTracking } from "@/features/mapMarkers/hooks/useMarkerViewTracking";
import { getCacheKeyForImage } from "@/lib/image";

/*
#1375（オーナー指示 8 巡目）**「お店を探す」画面のピンに店名を出す。**

## なぜ新しいマーカーを作るのか

`AvatarBubbleMarker`（丸い写真だけ）では «どの店か» が押すまで分からない。
この画面の目的は «探している店を見つける» ことなので、写真だけでは足りない。
丸の下に店名を 1〜2 行で出す。

## Android の描画面の制約に合わせる

Android は Marker の children をビットマップへ焼くため、
大きくしすぎると欠ける（`AvatarBubbleMarker` の申し送り参照）。
丸は 34px、文字は 2 行までに抑え、幅も固定する。

## 焼き直しを止める

`tracksViewChanges` を渡さないと、地図を動かすあいだ中マーカーを毎フレーム焼き直し、
重くなるうえネイティブヒープを食い潰して落ちる（#1375 で実際に踏んだ）。
規則は `features/mapMarkers/hooks/useMarkerViewTracking.ts` に 1 本化してある。
*/

const BUBBLE_SIZE = Platform.OS === "android" ? 34 : 40;
const LABEL_WIDTH = 96;

type Props = RNMarkerProps & {
	/** 店名。これを丸の下に出す */
	name: string;
	uri?: string | null;
	/** 選択中は色を変える */
	isActive?: boolean;
};

export function RestaurantLabelMarker({ name, uri, isActive = false, ...props }: Props) {
	const { tracksViewChanges, onContentReady } = useMarkerViewTracking(`${uri ?? ""}|${name}|${isActive}`);
	const source = useMemo(
		() => (uri ? { uri, cacheKey: getCacheKeyForImage(uri) } : undefined),
		[uri],
	);

	return (
		<Marker
			{...props}
			tracksViewChanges={tracksViewChanges}
			// 丸の下端が座標に来るようにする（文字は座標より下へ垂れる）
			anchor={{ x: 0.5, y: Platform.OS === "android" ? 0.5 : 0.72 }}>
			<View style={styles.container} onLayout={uri ? undefined : onContentReady}>
				<View style={[styles.bubble, isActive && styles.bubbleActive]}>
					{source ? (
						<Image
							style={styles.image}
							source={source}
							contentFit="cover"
							cachePolicy="memory-disk"
							transition={100}
							onLoadEnd={onContentReady}
						/>
					) : null}
				</View>
				{/* 地図の上に載るので、白フチで輪郭を保つ（バッジ類と同じ考え方） */}
				<Text style={[styles.label, isActive && styles.labelActive]} numberOfLines={2}>
					{name}
				</Text>
			</View>
		</Marker>
	);
}

const styles = StyleSheet.create({
	container: {
		width: LABEL_WIDTH,
		alignItems: "center",
	},
	bubble: {
		width: BUBBLE_SIZE,
		height: BUBBLE_SIZE,
		borderRadius: BUBBLE_SIZE / 2,
		borderWidth: 2,
		borderColor: FixedColors.mapMarkerSurface,
		backgroundColor: FixedColors.mapMarkerSurface,
		overflow: "hidden",
	},
	bubbleActive: {
		borderColor: FixedColors.onFilled,
	},
	image: {
		width: "100%",
		height: "100%",
	},
	label: {
		marginTop: 2,
		fontSize: 10,
		lineHeight: 12,
		fontWeight: "700",
		textAlign: "center",
		// 地図タイルは常にライト配色なので固定色でよい（FixedColors の申し送り参照）
		color: FixedColors.mapMarkerLabel,
		// 文字の周りを白く縁取って、地図の上でも読めるようにする
		textShadowColor: FixedColors.mapMarkerSurface,
		textShadowOffset: { width: 0, height: 0 },
		textShadowRadius: 3,
	},
	labelActive: {
		color: FixedColors.mapMarkerLabelActive,
	},
});
