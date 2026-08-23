/*
#1375 4 巡目: 外部埋め込み再生の web 実装（iframe）。

Metro はプラットフォーム拡張子でこちらを選ぶので、`react-native-webview` は
web バンドルに一切入らない（ネイティブ側 `ExternalEmbedPlayer.tsx` のヘッダ参照）。

iframe の許可属性は再生に必要な最小限（autoplay / encrypted-media / fullscreen /
picture-in-picture）。provider の埋め込みページ自身が再生 UI を持つ。
*/
import React from "react";
import { StyleSheet, View } from "react-native";

import { buildExternalEmbedPlayerSource } from "../embedUrl";
import type { ExternalEmbedPlayerProps } from "./ExternalEmbedPlayer";

export type { ExternalEmbedPlayerProps };

export function ExternalEmbedPlayer({ embed, isActive }: ExternalEmbedPlayerProps) {
	const source = buildExternalEmbedPlayerSource(embed.provider, embed.externalContentId);
	if (!isActive || source === null) return null;

	return (
		<View style={styles.container} testID="external-embed-webview">
			{React.createElement("iframe", {
				src: source.embedUrl,
				style: { border: 0, width: "100%", height: "100%", backgroundColor: "#000" },
				allow: "autoplay; encrypted-media; picture-in-picture",
				allowFullScreen: true,
				loading: "lazy",
				title: source.providerLabel,
			})}
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		...StyleSheet.absoluteFillObject,
		backgroundColor: "#000",
	},
});
