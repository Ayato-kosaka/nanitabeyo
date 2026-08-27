/*
#1375 4 巡目: 外部埋め込み再生の web 実装（iframe）。

Metro はプラットフォーム拡張子でこちらを選ぶので、`react-native-webview` は
web バンドルに一切入らない（ネイティブ側 `ExternalEmbedPlayer.tsx` のヘッダ参照）。

独立レビュー反映:
- iframe は既定で pointerEvents="none"（表示専用）。全面を覆う iframe が
  ホイール／タッチを飲むと、フィード送り（FlatList スクロール）とカードタップが
  死ぬため。中央の再生ボタンを押した人にだけ操作を渡す（そこから先は埋め込み側の
  再生 UI を直接触ってもらう。スクロールを譲るのは本人が選んだ操作）
- sandbox: allow-top-navigation を含めない。埋め込み内の第三者スクリプトが
  `window.top.location` でアプリのタブごと乗っ取るのを構造的に禁止する
- referrerPolicy: どのページから開いたかを provider へ渡さない

## ⚠️ web は自動再生できない。ネイティブ側と作りが違うのは意図的である（#1641）

ネイティブ（`ExternalEmbedPlayer.tsx`）は #1641 で **タップ無しの自動再生**へ作り替え、
操作モードと × ボタンを廃止した。**web で同じことはできない。**

埋め込みページは `<video autoplay>` を出さないので、再生させるには外から `play()` を
撃つ必要がある。ネイティブの WebView は埋め込みページを **トップレベル文書**として開くので
`injectJavaScript` が同一オリジンの文脈で動くが、web の `<iframe>` の中は
**instagram.com のクロスオリジン**であり、こちらからは一切触れない。
`allow="autoplay"` を渡しても、ページ自身が `play()` を呼ばない以上は何も起きない。

したがって web は **«再生ボタン → 操作モード → 埋め込み側の再生 UI»** の 2 段のままにする。
ネイティブ側に合わせて操作モードを消すと、web だけ «永久に再生できない板» になる。
*/
import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View, type LayoutChangeEvent } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { Play } from "lucide-react-native";

import i18n from "@/lib/i18n";
import { buildExternalEmbedPlayerSource } from "../embedUrl";
import { computeEmbedCropLayout, isReelUrl } from "../embedCrop";
import type { ExternalEmbedPlayerProps } from "./ExternalEmbedPlayer";
// #1509 メディア埋め込みの黒背景・再生 UI はメディアを引き立てる固定色（テーマ非追従）
import { FixedColors } from "@/constants/Palette";

export type { ExternalEmbedPlayerProps };

export function ExternalEmbedPlayer({ embed, isActive, blockParentTapGesture }: ExternalEmbedPlayerProps) {
	const [interactive, setInteractive] = useState(false);
	const handleActivate = useCallback(() => setInteractive(true), []);

	// #1641 Instagram の埋め込みが連れてくるヘッダ帯・いいね欄・白帯を窓の外へ追い出し、
	// **映像を切らずに**最大の大きさで出す。計算の根拠は ../embedCrop.ts のヘッダを参照
	const [cell, setCell] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
	const handleLayout = useCallback((event: LayoutChangeEvent) => {
		const { width, height } = event.nativeEvent.layout;
		setCell((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
	}, []);
	// 縦長のリールだと分かっているときだけ «枠ごとの拡大» を許す（正方形の投稿を切らないため）
	const isReel = useMemo(() => isReelUrl(embed.canonicalUrl), [embed.canonicalUrl]);
	const crop = useMemo(() => computeEmbedCropLayout(cell, { isReel }), [cell, isReel]);

	const source = buildExternalEmbedPlayerSource(embed.provider, embed.externalContentId);
	if (!isActive || source === null) return null;

	if (embed.embedStatus === "unavailable") {
		return (
			<View style={styles.overlayContainer} pointerEvents="none" testID="external-embed-unavailable">
				<Text style={styles.playLabel}>{i18n.t("DishMediaContent.errors.mediaUnavailable")}</Text>
			</View>
		);
	}

	/*
	#1375（オーナー指摘）**丸い再生ボタンを 2 つ出さない。**

	切り取り後は Instagram 自身の再生ボタンが写真の中央＝セルの中央に来る。そこへ
	こちらの丸い再生ボタンを重ねると、**同じ場所に再生ボタンが 2 つ**見える（実機の動画で指摘）。

	丸は Instagram のものに任せ、こちらは «セル全面の透明なタップ受け» と
	画面下の小さな文言だけにする。役割（1 タップで操作モードへ入る）は変わらない。
	*/
	const playButton = (
		<TouchableOpacity
			testID="external-embed-open-browser"
			style={styles.playButton}
			onPress={handleActivate}
			accessibilityRole="button"
			accessibilityLabel={i18n.t("DishMediaContent.embed.play", { provider: source.providerLabel })}>
			{/* 中央には Instagram 自身の再生ボタンが来るので、そこを避けて下寄せにする。
			    ⚠️ 下端ぴったりに置くとフィードの絞り込みチップの裏へ隠れる（実測）。
			    中央からの相対位置にしないのは、**Instagram の再生ボタンの大きさが
			    こちらから測れない**ため。下端からの固定距離のほうが読みが外れない */}
			<View style={styles.playHint}>
				<Play size={12} color={FixedColors.onMedia} fill={FixedColors.onMedia} />
				<Text style={styles.playLabel}>
					{i18n.t("DishMediaContent.embed.play", { provider: source.providerLabel })}
				</Text>
			</View>
		</TouchableOpacity>
	);

	return (
		<>
			<View
				style={styles.container}
				onLayout={handleLayout}
				pointerEvents={interactive ? "auto" : "none"}
				testID="external-embed-webview">
				{/* セルの寸法が確定するまで iframe を作らない。中途半端な幅で読み込ませると、
				    Instagram がその幅でレイアウトしてしまい切り取り位置がずれたまま残る */}
				{/* メディア枠。**縦横比を保ったまま枠ごと拡大する**（引き延ばさない・切らない。
				    はみ出すのは Instagram が付けた左右の余白だけ。理由は ../embedCrop.ts のヘッダ） */}
				{crop !== null && (
					<View
						style={{
							width: crop.frameWidth,
							height: crop.mediaHeight,
							overflow: "hidden",
							transform: [{ scale: crop.scale }],
						}}>
						{React.createElement("iframe", {
							src: source.embedUrl,
							style: {
								border: 0,
								position: "absolute",
								left: 0,
								// ヘッダ帯ぶん上へずらして箱の外へ追い出す
								top: crop.frameTop,
								width: crop.frameWidth,
								height: crop.frameHeight,
								backgroundColor: FixedColors.mediaBackground,
							},
							allow: "autoplay; encrypted-media; picture-in-picture",
							allowFullScreen: true,
							loading: "lazy",
							title: source.providerLabel,
							sandbox: "allow-scripts allow-same-origin allow-popups allow-presentation",
							referrerPolicy: "strict-origin-when-cross-origin",
						})}
					</View>
				)}
			</View>
			{!interactive && (
				<View style={styles.overlayContainer} pointerEvents="box-none" testID="external-embed-fallback">
					{blockParentTapGesture ? (
						<GestureDetector gesture={blockParentTapGesture}>
							{/* ⚠️ この包みに absoluteFill を与えること。react-native-web は View を
							    `position: relative` で描くので、素の View（高さ 0）を挟むと
							    中の絶対配置がそこを基準にしてしまい、文言が画面の**上端**へ出る（実測） */}
							<View style={StyleSheet.absoluteFill} collapsable={false}>
								{playButton}
							</View>
						</GestureDetector>
					) : (
						playButton
					)}
				</View>
			)}
		</>
	);
}

const styles = StyleSheet.create({
	container: {
		...StyleSheet.absoluteFillObject,
		backgroundColor: FixedColors.mediaBackground,
		// メディア枠を中央へ置く（リールは 9:16 なので、上下にはアプリの地色が残る）
		alignItems: "center",
		justifyContent: "center",
		// #1641 はみ出した Instagram の UI（ヘッダ帯・いいね欄・左右の余白）をここで捨てる。
		// これが無いとセルの外へ白帯が出る
		overflow: "hidden",
	},
	overlayContainer: {
		...StyleSheet.absoluteFillObject,
	},
	// #1375: セル全面が «1 タップで操作モードへ» の受け。中央には何も描かない
	// （中央には Instagram 自身の再生ボタンが来るため。同じ場所に丸を 2 つ出さない）
	playButton: {
		...StyleSheet.absoluteFillObject,
		justifyContent: "flex-end",
		alignItems: "center",
		paddingBottom: 124,
	},
	// «押せば動く» ことだけ伝える小さな帯。丸い再生ボタンの代わり
	playHint: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		paddingHorizontal: 12,
		paddingVertical: 6,
		borderRadius: 16,
		backgroundColor: "rgba(0,0,0,0.55)",
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: "rgba(255,255,255,0.5)",
	},
	playLabel: {
		fontSize: 12,
		fontWeight: "700",
		color: FixedColors.onMedia,
		textShadowColor: "rgba(0,0,0,0.6)",
		textShadowRadius: 6,
	},
});
