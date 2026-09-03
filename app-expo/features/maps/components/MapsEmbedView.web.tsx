/*
#843 アプリ内地図（web, iframe）。

Metro はプラットフォーム拡張子でこちらを選ぶので、`react-native-webview` は
web バンドルに一切入らない（native 側 `MapsEmbedView.tsx` のヘッダ参照）。

## なぜ `fetch` で先読みするのか
`GOOGLE_MAPS_EMBED_API_KEY` が未設定だと `GET /v1/maps/embed` は 503 を返す
（api/src/v1/maps/maps.controller.ts）。iframe の `onError` はネットワーク断でしか
発火せず、HTTP エラーステータス（503 等）は捕まえられない。地図の中身だけが
空のまま出るのは「壊れている」にしか見えないため、iframe を出す前に軽く 1 回
`fetch` して `res.ok` を確かめ、失敗していれば `fallback`（従来の外部ブラウザ導線）へ倒す。
*/
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { MapsEmbedViewProps } from "./MapsEmbedView";

export type { MapsEmbedViewProps };

export function MapsEmbedView({ url, fallback, testID }: MapsEmbedViewProps) {
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setFailed(false);
		fetch(url)
			.then((res) => {
				if (!cancelled && !res.ok) setFailed(true);
			})
			.catch(() => {
				if (!cancelled) setFailed(true);
			});
		return () => {
			cancelled = true;
		};
	}, [url]);

	if (failed) {
		return (
			<View style={styles.container} testID={testID ? `${testID}-fallback` : "maps-embed-fallback"}>
				{fallback}
			</View>
		);
	}

	return (
		<View style={styles.container} testID={testID ?? "maps-embed-webview"}>
			{React.createElement("iframe", {
				src: url,
				style: { border: 0, width: "100%", height: "100%" },
				loading: "lazy",
				title: "map",
				referrerPolicy: "no-referrer-when-downgrade",
			})}
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
});
