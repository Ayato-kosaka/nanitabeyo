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
*/
import React, { useCallback, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { Play } from "lucide-react-native";

import i18n from "@/lib/i18n";
import { buildExternalEmbedPlayerSource } from "../embedUrl";
import type { ExternalEmbedPlayerProps } from "./ExternalEmbedPlayer";

export type { ExternalEmbedPlayerProps };

export function ExternalEmbedPlayer({ embed, isActive, blockParentTapGesture }: ExternalEmbedPlayerProps) {
	const [interactive, setInteractive] = useState(false);
	const handleActivate = useCallback(() => setInteractive(true), []);

	const source = buildExternalEmbedPlayerSource(embed.provider, embed.externalContentId);
	if (!isActive || source === null) return null;

	if (embed.embedStatus === "unavailable") {
		return (
			<View style={styles.overlayContainer} pointerEvents="none" testID="external-embed-unavailable">
				<Text style={styles.playLabel}>{i18n.t("DishMediaContent.errors.mediaUnavailable")}</Text>
			</View>
		);
	}

	const playButton = (
		<TouchableOpacity
			testID="external-embed-open-browser"
			style={styles.playButton}
			onPress={handleActivate}
			accessibilityRole="button"
			accessibilityLabel={i18n.t("DishMediaContent.embed.play", { provider: source.providerLabel })}>
			<View style={styles.playCircle}>
				<Play size={30} color="#FFFFFF" fill="#FFFFFF" />
			</View>
			<Text style={styles.playLabel}>{i18n.t("DishMediaContent.embed.play", { provider: source.providerLabel })}</Text>
		</TouchableOpacity>
	);

	return (
		<>
			<View style={styles.container} pointerEvents={interactive ? "auto" : "none"} testID="external-embed-webview">
				{React.createElement("iframe", {
					src: source.embedUrl,
					style: { border: 0, width: "100%", height: "100%", backgroundColor: "#000" },
					allow: "autoplay; encrypted-media; picture-in-picture",
					allowFullScreen: true,
					loading: "lazy",
					title: source.providerLabel,
					sandbox: "allow-scripts allow-same-origin allow-popups allow-presentation",
					referrerPolicy: "strict-origin-when-cross-origin",
				})}
			</View>
			{!interactive && (
				<View style={styles.overlayContainer} pointerEvents="box-none" testID="external-embed-fallback">
					{blockParentTapGesture ? (
						<GestureDetector gesture={blockParentTapGesture}>
							<View collapsable={false}>{playButton}</View>
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
		backgroundColor: "#000",
	},
	overlayContainer: {
		...StyleSheet.absoluteFillObject,
		justifyContent: "center",
		alignItems: "center",
	},
	playButton: {
		alignItems: "center",
		gap: 10,
	},
	playCircle: {
		width: 72,
		height: 72,
		borderRadius: 36,
		backgroundColor: "rgba(0,0,0,0.55)",
		borderWidth: 2,
		borderColor: "rgba(255,255,255,0.9)",
		justifyContent: "center",
		alignItems: "center",
		paddingLeft: 4,
	},
	playLabel: {
		fontSize: 13,
		fontWeight: "700",
		color: "#FFFFFF",
		textShadowColor: "rgba(0,0,0,0.6)",
		textShadowRadius: 6,
	},
});
