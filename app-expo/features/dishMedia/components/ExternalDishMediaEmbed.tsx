import React, { useMemo } from "react";
import { StyleSheet } from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { buildExternalEmbedDocument, isProviderNavigationUrl, type ExternalDishMediaEmbedProps } from "./externalEmbed";

/** iOS/Android: 公式embedをアプリ画面内の制限付きWebViewで表示する。 */
export const ExternalDishMediaEmbed = ({ embed, isActive }: ExternalDishMediaEmbedProps) => {
	const html = useMemo(() => buildExternalEmbedDocument(embed), [embed]);

	const allowNavigation = (request: WebViewNavigation) => {
		if (isProviderNavigationUrl(embed.provider, request.url)) return true;
		// provider外へのtop-level遷移はWebView内でもOS browserでも許さない。
		// 元投稿を開くUIを追加する場合は、検証済みcanonicalUrlだけを別ボタンで扱う。
		return false;
	};

	return (
		<WebView
			source={{ html, baseUrl: embed.canonicalUrl }}
			style={styles.webView}
			originWhitelist={["about:blank", "https://*"]}
			onShouldStartLoadWithRequest={allowNavigation}
			javaScriptEnabled
			domStorageEnabled={false}
			setSupportMultipleWindows={false}
			allowsInlineMediaPlayback
			mediaPlaybackRequiresUserAction={!isActive}
			mixedContentMode="never"
			pointerEvents={isActive ? "auto" : "none"}
		/>
	);
};

const styles = StyleSheet.create({
	webView: {
		...StyleSheet.absoluteFillObject,
		backgroundColor: "#000",
	},
});
