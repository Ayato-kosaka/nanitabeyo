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

/** 店名の行の高さと最大行数。器の高さを式で決めるために定数にする */
const LABEL_LINE_HEIGHT = 12;
const LABEL_MAX_LINES = 2;
/** 丸と文字のあいだ */
const LABEL_MARGIN_TOP = 2;

/**
 * #1629 【バグ】**器の高さを固定する。**
 *
 * ## 何が起きるか
 * Android の `react-native-maps` は Marker の children を **ビットマップへ焼いて**地図に貼る。
 * ビットマップは «焼いた時点の測定サイズ» で確保されるので、**焼いたあとに中身が伸びると
 * はみ出した分は描かれない**（`AvatarBubbleMarker` の申し送りにある «右・下が扇形に欠ける» の正体）。
 *
 * このマーカーは `width` だけ固定で **高さを中身に任せていた**。高さを決めるのは
 * `<Text numberOfLines={2}>` で、店名が 1 行に収まるか 2 行になるかで **12px 変わる**。
 * さらに丸の中の写真は非同期に読み込まれる。つまり «最初の測定» と «最終的な見た目» の
 * 高さが食い違いうる状態だった。
 *
 * ## なぜ «2 行ぶんで固定» なのか
 * 常に最大（2 行）ぶんの高さを確保しておけば、店名が 1 行でも 2 行でも器は伸び縮みしない。
 * 1 行の店名では下に 12px の余白ができるが、透明なので見た目には出ない。
 *
 * ## anchor も一緒に安定する
 * `anchor` は **割合**で指定する。器の高さが変わると同じ 0.5 でもピクセル位置が変わるため、
 * «同じ縮尺なのにピンごとに座標からのずれ方が違う» ことになっていた。高さを固定すると
 * この割合も 1 通りに決まる。
 *
 * ⚠️ `LABEL_LINE_HEIGHT` / `LABEL_MAX_LINES` / `BUBBLE_SIZE` を変えたらこの式も追従すること。
 *    `RestaurantLabelMarker.test.tsx` が «器が高さを持っていること» を固定している。
 */
export const LABEL_MARKER_HEIGHT = BUBBLE_SIZE + LABEL_MARGIN_TOP + LABEL_LINE_HEIGHT * LABEL_MAX_LINES;

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
				<Text style={[styles.label, isActive && styles.labelActive]} numberOfLines={LABEL_MAX_LINES}>
					{name}
				</Text>
			</View>
		</Marker>
	);
}

const styles = StyleSheet.create({
	container: {
		width: LABEL_WIDTH,
		// #1629 高さを中身に任せない（上の設計コメント）。焼いたあとに伸びると欠ける
		height: LABEL_MARKER_HEIGHT,
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
		marginTop: LABEL_MARGIN_TOP,
		fontSize: 10,
		lineHeight: LABEL_LINE_HEIGHT,
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
