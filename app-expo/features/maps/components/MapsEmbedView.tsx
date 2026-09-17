/*
#843 アプリ内地図（native, react-native-webview 入りビルド用）。

## WebView が居ないビルドへの縮退
`react-native-webview` は既にこのアプリの依存に入っており、実機の 1.14 ビルドにも
含まれている（`features/dishMedia/components/ExternalEmbedPlayer.tsx` と同じ前提）。
それでも "有無を確かめてから使う" probe パターンは踏襲する。古い OTA だけを受け取った
端末では該当ネイティブモジュールがまだ無いことがあるため。

## 読み込み失敗も «縮退» の対象にする
`GOOGLE_MAPS_EMBED_API_KEY` が未設定だと `GET /v1/maps/embed` は 503 を返す
（api/src/v1/maps/maps.controller.ts）。この状態で地図の中身だけが空のまま出るのは
ユーザーにとって「壊れている」にしか見えないため、`onHttpError` / `onError` を
拾って `fallback`（従来の外部ブラウザ導線）へ切り替える。
*/
import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, UIManager, View } from "react-native";

type WebViewComponent = React.ComponentType<Record<string, unknown>>;

let cachedWebView: WebViewComponent | null | undefined;
const probeNativeWebView = (): WebViewComponent | null => {
	if (cachedWebView !== undefined) return cachedWebView;
	try {
		const uiManager = UIManager as unknown as {
			hasViewManagerConfig?: (name: string) => boolean;
			getViewManagerConfig?: (name: string) => unknown;
		};
		const hasNative =
			uiManager.hasViewManagerConfig?.("RNCWebView") ?? uiManager.getViewManagerConfig?.("RNCWebView") != null;
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		cachedWebView = hasNative ? (require("react-native-webview").WebView as WebViewComponent) : null;
	} catch {
		cachedWebView = null;
	}
	return cachedWebView;
};

export type MapsEmbedViewProps = {
	/** `GET /v1/maps/embed` の URL（features/maps/embedUrl.ts の buildMapsEmbedUrlFromToken） */
	url: string;
	/** WebView が居ないビルド、または読み込みに失敗したときに描く代替 UI */
	fallback: React.ReactNode;
	/**
	 * #1810 PL レビュー 3番【設計】fallback へ切り替わった瞬間に呼ばれる。
	 * 呼び出し側（MapsEmbedModal）はこれを受けて、fallback の中と外で同じ
	 * 「Google マップで開く」ボタンを二重に出さないようにする。
	 */
	onFallback?: () => void;
	testID?: string;
};

export function MapsEmbedView({ url, fallback, onFallback, testID }: MapsEmbedViewProps) {
	const probeRef = useRef(probeNativeWebView());
	const NativeWebView = probeRef.current;
	const [failed, setFailed] = useState(false);
	const isFallback = !NativeWebView || failed;

	const handleLoadFailed = useCallback(() => setFailed(true), []);

	useEffect(() => {
		if (isFallback) onFallback?.();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isFallback]);

	if (isFallback) {
		return (
			<View style={styles.container} testID={testID ? `${testID}-fallback` : "maps-embed-fallback"}>
				{fallback}
			</View>
		);
	}

	return (
		<View style={styles.container} testID={testID ?? "maps-embed-webview"}>
			<NativeWebView
				source={{ uri: url }}
				style={StyleSheet.absoluteFill}
				onHttpError={handleLoadFailed}
				onError={handleLoadFailed}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
});
