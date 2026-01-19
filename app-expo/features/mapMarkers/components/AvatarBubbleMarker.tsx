// app-expo/features/mapMarkers/components/AvatarBubbleMarker.tsx

import React from "react";
import { View, StyleSheet, Platform } from "react-native";
import { Marker } from "@/components/MapView";
import { Image } from "expo-image";
import type { MapMarkerProps as RNMarkerProps } from "react-native-maps";

/**
 * AvatarBubbleMarker（View Marker版）
 * ----------------------------------------------------------------------
 * 🎯 本コンポーネントの目的
 * - Bitmap Marker（view-shot + FileSystem）方式を廃止し、View Marker に統一
 * - Map描画を高速化し、初回描画を体感1秒未満にする
 * - iOS / Android / Web で UI 崩れを最小化
 *
 * 🔍 今回の調査でわかったこと（重要）
 * ----------------------------------------------------------------------
 * 1. Android の react-native-maps は Marker children を内部でビットマップ化して描画する
 * 2. そのビットマップには「描画可能領域の最大サイズ」が存在している
 * 3. 吹き出しの尻尾や余白で高さが増えると、その領域を超えた部分がクリップ（=扇形に欠ける）
 * 4. padding / overflow / collapsable=false / googleRenderer=LEGACY では領域拡大できない
 * 5. よって「領域内に収まるサイズ・形状にする」以外の解決策が存在しない
 *
 * 🎨 対策方針（最終決定）
 * ----------------------------------------------------------------------
 * - Android は「正円のみ」「小さめサイズ」「尻尾なし」にする（=領域内に収める）
 * - iOS / Web は従来どおり「吹き出し+尻尾」
 * - expo-image のキャッシュ機能で画像読み込みは軽量化
 *
 * 📐 最適化の結果
 * ----------------------------------------------------------------------
 * - Android は `size=37px` が最大の安定領域（これ以上は尻尾や枠の一部が欠損）
 * - iOS / Web は `size=48px` + tail でもクリッピングなし
 *
 * 参考：
 * Marker children を無理に大きくすると Android だけ「左・上は生きているが右・下が扇形に欠ける」
 * → これは内部ビットマップの下限領域を超えて破棄されている挙動に一致する。
 */

const BORDER_WIDTH = 2;
const IMAGE_SIZE_OFFSET = BORDER_WIDTH * 2;

type Props = RNMarkerProps & {
	uri?: string;
	size?: number;
	color?: string;
	isActive?: boolean;
};

export function AvatarBubbleMarker({
	uri,
	// iOS/Webは吹き出し想定で48
	size = 48,
	color = "#FFFFFF",
	isActive = false,
	...props
}: Props) {
	// Androidは領域制限のためsize=37が最も安定
	const bubbleSize = Platform.OS === "android" ? Math.min(size, 37) : size;
	const imageSize = bubbleSize - IMAGE_SIZE_OFFSET;

	return (
		<Marker
			{...props}
			// anchorは画像下寄せ。プラットフォームごとに値が異なる理由:
			// - iOS / Web: y=0.85 にすることで「吹き出し+尻尾」の先端が実座標に重なるように配置
			// - Android: Marker children が内部でビットマップ化され、下方向がクリップされやすいため
			//   ・尻尾を描かない前提で、円のやや上側を原点とする必要がある
			//   ・iOS / Web と同じ y=0.85 を使うと、クリッピングされたビットマップ基準でさらに下にずれて見える
			// → ビットマップの描画領域制限と視覚的な位置合わせを両立するため、Android だけ y=0.5 を使用する
			anchor={{ x: 0.5, y: Platform.OS === "android" ? 0.5 : 0.85 }}>
			<View style={[styles.container, { width: bubbleSize, height: bubbleSize + 4 }]}>
				{/* 吹き出し本体 */}
				<View
					style={[
						styles.bubble,
						{
							width: bubbleSize,
							height: bubbleSize,
							borderColor: color,
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
						transition={100}
					/>
				</View>

				{/* ⚠️ Androidは尻尾を描画しない理由
				 * ----------------------------------------------------------------
				 * - 尻尾分の高さがビットマップ領域外に押し出されクリッピングされる
				 * - 尻尾の三角形はborder系で描くため領域端に飛び出しやすい
				 * → Androidは尻尾を消して安定描画を優先
				 */}
				{Platform.OS !== "android" && (
					<View
						style={[
							styles.tail,
							{
								borderTopColor: color,
							},
						]}
					/>
				)}
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
		borderWidth: BORDER_WIDTH,
		borderRadius: 9999,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#FFFFFF",
		overflow: "hidden", // expo-imageの丸切り抜き維持
	},
	image: {
		borderRadius: 9999,
	},
	// iOS/Web専用の吹き出し尾
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
