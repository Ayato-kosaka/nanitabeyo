// app-expo/app/[locale]/dev-tools/sns-embed-poc.tsx
//
// #1273 【設計】SNS dish_media 埋め込みPoC用の一時的なエンジニアリングQA画面。
// TikTok/X は公式oEmbedを実行時に取得してWebViewへ差し込み、YouTubeは公式iframeを
// 直接描画する。contribution-tasks/*.tsx（ユーザー投稿レビュー用）とは目的が異なるため
// dev-tools/ に分離している。通常のアプリ導線(タブ/ナビ)には接続しない。EAS Build
// Development で `/{locale}/dev-tools/sns-embed-poc` を直接開いて、実機でSNS埋め込みが
// 崩れずに表示されるかを目視確認するためだけの画面。
//
// #1273 【将来対応】ここで確認できたら、dish_media.render_type などの本番スキーマ変更や
// 本番コンポーネント化はissue本文の設計(#40)に沿って別issueで行う。このファイルはPoC限りで
// 本番機能ではない。

import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

type EmbedTarget = {
	provider: "tiktok" | "x" | "youtube";
	label: string;
	sourceUrl: string;
	// TikTok/Xは実行時にoEmbed APIを叩いてhtmlを取得する。YouTubeは公式iframeを直接組み立てられるため
	// oEmbed呼び出し自体が不要（#1273 REPORT.md「YouTube Data API v3」節を参照）。
	oembedEndpoint?: string;
	staticHtml?: string;
};

// #1273 【設計】REPORT.md の実測で oEmbed 成功(200 OK)を確認済みの公開投稿と同じURLを使う
// (fixtures/tiktok_sample_urls.txt, fixtures/x_sample_urls.txt と同一のURL)。
const TARGETS: EmbedTarget[] = [
	{
		provider: "tiktok",
		label: "TikTok oEmbed（島やんラーメン）",
		sourceUrl: "https://www.tiktok.com/@shimayan.ramen/video/7364606200605854992",
		oembedEndpoint:
			"https://www.tiktok.com/oembed?url=" +
			encodeURIComponent("https://www.tiktok.com/@shimayan.ramen/video/7364606200605854992"),
	},
	{
		provider: "x",
		label: "X oEmbed（かっぱ寿司【公式】）",
		sourceUrl: "https://x.com/kappasushi_jp/status/1658970659878502400",
		oembedEndpoint:
			"https://publish.x.com/oembed?url=" +
			encodeURIComponent("https://x.com/kappasushi_jp/status/1658970659878502400"),
	},
	{
		provider: "youtube",
		label: "YouTube 公式iframe",
		sourceUrl: "https://www.youtube.com/watch?v=HSY_cevheSo",
		// #1273 【仕様】YouTube公式ドキュメント記載の標準iframe埋め込み。sns_dish_media_poc.py の
		// youtube_iframe_embed_html() と同じ形（video_idはREPORT.mdの実測で採用された動画）。
		staticHtml:
			'<iframe width="100%" height="220" src="https://www.youtube.com/embed/HSY_cevheSo" ' +
			'frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" ' +
			"allowfullscreen></iframe>",
	},
];

function wrapEmbedHtml(bodyHtml: string): string {
	// #1273 【仕様】oEmbedのhtmlはscriptタグ込みで返る。そのままbodyへ差し込めばTikTok/Xの
	// 公式ウィジェットスクリプトがWebView内で読み込まれ、実際のembedが描画される。
	return (
		"<!doctype html><html><head>" +
		'<meta name="viewport" content="width=device-width, initial-scale=1">' +
		'</head><body style="margin:0;padding:0;background:#fff;">' +
		bodyHtml +
		"</body></html>"
	);
}

function EmbedCard({ target }: { target: EmbedTarget }) {
	const [html, setHtml] = useState<string | null>(target.staticHtml ?? null);
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState<boolean>(!!target.oembedEndpoint);

	useEffect(() => {
		if (!target.oembedEndpoint) return;
		let cancelled = false;

		// #1273 【設計】静的にhtmlを埋め込まず実行時取得にしているのは、oEmbedの失効
		// (投稿削除/非公開化)を実機でも再現・確認できるようにするため(REPORT.md 39項相当)。
		(async () => {
			try {
				const response = await fetch(target.oembedEndpoint as string);
				if (!response.ok) {
					throw new Error(`oEmbed HTTP ${response.status}`);
				}
				const payload = (await response.json()) as { html?: string };
				if (!cancelled) {
					setHtml(payload.html ?? null);
				}
			} catch (fetchError) {
				if (!cancelled) {
					setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
				}
			} finally {
				if (!cancelled) {
					setIsLoading(false);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [target.oembedEndpoint]);

	return (
		<View style={styles.card}>
			<Text style={styles.cardTitle}>{target.label}</Text>
			<Text style={styles.cardUrl} numberOfLines={1}>
				{target.sourceUrl}
			</Text>
			{isLoading && <ActivityIndicator style={styles.loader} />}
			{error && <Text style={styles.error}>oEmbed取得失敗: {error}</Text>}
			{html && (
				<WebView
					originWhitelist={["*"]}
					source={{ html: wrapEmbedHtml(html) }}
					style={styles.webview}
					javaScriptEnabled
					domStorageEnabled
					// [ベストプラクティス] Androidでの埋め込み崩れ防止(iOSは無視される)
					scalesPageToFit
				/>
			)}
		</View>
	);
}

export default function SnsEmbedPocScreen() {
	const insets = useSafeAreaInsets();

	return (
		<ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + 16 }]}>
			<Text style={styles.heading}>#1273 SNS埋め込みPoC</Text>
			<Text style={styles.subheading}>
				TikTok/Xは公式oEmbedを実行時取得、YouTubeは公式iframeを直接描画しています。EAS Build
				Developmentの実機/シミュレータで表示崩れ・読み込み速度・スクロール挙動を確認してください。
			</Text>
			{TARGETS.map((target) => (
				<EmbedCard key={target.provider} target={target} />
			))}
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	container: {
		padding: 16,
		paddingBottom: 48,
	},
	heading: {
		fontSize: 20,
		fontWeight: "700",
		marginBottom: 4,
		color: "#1A1A1A",
	},
	subheading: {
		fontSize: 13,
		color: "#666666",
		marginBottom: 20,
	},
	card: {
		marginBottom: 24,
		borderWidth: 1,
		borderColor: "#E5E7EB",
		borderRadius: 12,
		padding: 12,
		backgroundColor: "#FFFFFF",
	},
	cardTitle: {
		fontSize: 15,
		fontWeight: "600",
		marginBottom: 2,
		color: "#1A1A1A",
	},
	cardUrl: {
		fontSize: 11,
		color: "#9CA3AF",
		marginBottom: 8,
	},
	loader: {
		marginVertical: 16,
	},
	webview: {
		height: 480,
		width: "100%",
	},
	error: {
		color: "#DC2626",
		fontSize: 13,
	},
});
