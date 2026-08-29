// app-expo/features/mapMarkers/components/AvatarBubbleMarker.tsx

import React, { useMemo } from "react";
import { View, StyleSheet, Platform } from "react-native";
import { Marker } from "@/components/MapView";
import { useMarkerViewTracking } from "../hooks/useMarkerViewTracking";
import { getCacheKeyForImage } from "@/lib/image";
import { Image } from "expo-image";
import type { MapMarkerProps as RNMarkerProps } from "react-native-maps";
import { FixedColors } from "@/constants/Palette";

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
	/**
	 * #1513 吹き出しの中身を画像の代わりに差し替える。
	 *
	 * 渡されたときは `uri` を無視してこれを描く。my-dishes の Map が «自分の投稿が削除済み» の
	 * ピンへ墓標を出すために使う（`uri` を空にするだけでは白い丸になり、削除されたことが伝わらない）。
	 * 既定は undefined で、渡さなければ従来どおり画像を描く。
	 */
	bubbleContent?: React.ReactNode;
};

export function AvatarBubbleMarker({
	uri,
	// iOS/Webは吹き出し想定で48
	size = 48,
	/*
	#1629 【設計】このバブルは Google Map のタイルに直接載る。タイルはアプリのテーマに
	追従せず常にライト配色なので、地とふちの既定はテーマで振らず固定の白にする
	（ダークで暗くすると、明るい地図の上でバブルが読めなくなる）。
	呼び出し側もアクティブ時に `FixedColors.brandOnMap` 等の固定色を渡している。
	*/
	color = FixedColors.mapMarkerSurface,
	isActive = false,
	bubbleContent,
	...props
}: Props) {
	// Androidは領域制限のためsize=37が最も安定
	const bubbleSize = Platform.OS === "android" ? Math.min(size, 37) : size;
	const imageSize = bubbleSize - IMAGE_SIZE_OFFSET;

	/*
	#1375（実機: マップのクラッシュ / 性能劣化）**焼き直しを絵が変わる間だけに限る。**

	`tracksViewChanges` を渡さないと react-native-maps の既定 `true` が効き、
	Android は地図が動くあいだ中、**マーカー 1 個につき毎フレーム 1 枚**の
	ビットマップを作り直す。この地図は最大 300 ピン（`MY_DISH_MAP_PINS_LIMIT`）を
	置くので、pan が重くなるだけでなくネイティブヒープを食い潰して落ちる。
	理由の詳細は `hooks/useMarkerViewTracking.ts` を読むこと。

	⚠️ **`tracksViewChanges` を消さないこと。** 消すと «マップがすごく重い / 落ちる» が再発する。
	*/
	const { tracksViewChanges, onContentReady } = useMarkerViewTracking(`${uri ?? ""}|${color}|${isActive}`);

	/*
	#1375（実機: マップの重さ）**`cacheKey` を必ず付ける。**

	サムネイルは署名付きの CDN URL で、署名部分は定期的に回る。URL 文字列をそのまま
	キーにすると **同じ写真なのに毎回キャッシュミス**になり、地図を開くたびに最大 300 枚を
	取り直す。`getCacheKeyForImage` はクエリを落とした部分をキーにするので当たる。

	アプリ内の画像消費側（一覧 / Calendar / カード / 下部シート / 通知）は全部これを
	通しており、**このマーカーだけが例外だった**。下部シートは同じ写真を正しいキーで
	読んでいたため、1 枚の写真が二重にデコードされてもいた。

	`useMemo` にしてあるのは、インラインで組むと毎レンダー新しいオブジェクトが
	`expo-image` へ渡るため。
	*/
	const source = useMemo(() => (uri ? { uri, cacheKey: getCacheKeyForImage(uri) } : undefined), [uri]);

	return (
		<Marker
			{...props}
			tracksViewChanges={tracksViewChanges}
			// anchorは画像下寄せ。プラットフォームごとに値が異なる理由:
			// - iOS / Web: y=0.85 にすることで「吹き出し+尻尾」の先端が実座標に重なるように配置
			// - Android: Marker children が内部でビットマップ化され、下方向がクリップされやすいため
			//   ・尻尾を描かない前提で、円のやや上側を原点とする必要がある
			//   ・iOS / Web と同じ y=0.85 を使うと、クリッピングされたビットマップ基準でさらに下にずれて見える
			// → ビットマップの描画領域制限と視覚的な位置合わせを両立するため、Android だけ y=0.5 を使用する
			anchor={{ x: 0.5, y: Platform.OS === "android" ? 0.5 : 0.85 }}>
			<View
				style={[styles.container, { width: bubbleSize, height: bubbleSize + 4 }]}
				/*
				画像が無いマーカーはここで «絵が出揃った» と判断する（読み込み完了が来ないため）。

				#1513 `bubbleContent`（墓標）を渡したときは `uri` があっても <Image> を描かないので、
				`onLoadEnd` は永久に来ない。ここを `uri ?` だけで見ると `tracksViewChanges` が
				true のまま張り付き、#1375 で潰したはずの «毎フレーム焼き直し» が復活する。
				今の呼び出し元は墓標のとき uri を undefined にしているので現に踏んではいないが、
				その約束を component の外へ預けない。
				*/
				onLayout={uri && !bubbleContent ? undefined : onContentReady}>
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
					{bubbleContent ? (
						// #1513 画像の代わりの中身（墓標など）。丸マスクの中いっぱいに置く
						<View style={[styles.image, { width: imageSize, height: imageSize, overflow: "hidden" }]}>
							{bubbleContent}
						</View>
					) : (
						<Image
							style={[
								styles.image,
								{
									width: imageSize,
									height: imageSize,
								},
							]}
							source={source}
							contentFit="cover"
							transition={100}
							cachePolicy="memory-disk" // #785 DishMediaContent と同一ポリシーにすることで iOS SDWebImage のパイプライン競合を防止
							// #1375 成否どちらでも呼ばれる。ここで初めて «この絵で確定» になる
							onLoadEnd={onContentReady}
						/>
					)}
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
		// #1629 上と同じ理由（地図タイルが常にライトなので、バブルの地は固定の白）
		backgroundColor: FixedColors.mapMarkerSurface,
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
