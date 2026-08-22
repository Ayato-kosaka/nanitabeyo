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
		staticHtml: youtubeIframeHtml("HSY_cevheSo"),
	},
];

// #1273 【設計】①のクロールで実際に発見した dish_media 候補（restaurant × category × video）。
// 従来この画面は手で選んだ1本しか載せておらず、②の表示検証が「YouTubeのiframeは描画できる」
// までしか確かめられていなかった。①が 758ch / 12,557 pair まで到達したので、実発見データを
// そのまま流し込んで「発見したものが本当に出せるか」を確かめる形にする。
//
// 出典: scripts/20260808T0000_restaurant/1273_sns_dish_media_poc/out/embed_verification_sample.json
// （7,727件の dish_media 候補から、カテゴリが重複しないよう SHA-256 で決定的に12件を抽出）
//
// #1307 【仕様】ここに並ぶのは全て 16:9 の長尺動画である。実測で Shorts（60秒以下かつ縦）は
// 0/250 = 0.0% だった。フィードUXが短尺縦動画前提なら、この画面で見えるのは
// 「埋め込みは成立するが形式が合わない」という状態そのものである。
type DiscoveredDishMedia = {
	restaurantName: string;
	categoryJa: string;
	videoId: string;
	title: string;
};

const DISCOVERED_DISH_MEDIA: DiscoveredDishMedia[] = [
	{ restaurantName: "風らい路", categoryJa: "定食", videoId: "thM1JGHElI4", title: "山口県岩国市【風らい路】さん" },
	{ restaurantName: "タイヨーラーメン", categoryJa: "ラーメン", videoId: "5Oj2xzV83vo", title: "📍【タイヨーラーメン(大阪府堺市美原区)】" },
	{ restaurantName: "ふきや 博多店", categoryJa: "お好み焼き", videoId: "1zrXDdxLB8s", title: "【福岡市博多区ランチ・お好み焼き】ふきや 博多店" },
	{ restaurantName: "ほるたん屋美濃インター店", categoryJa: "焼肉", videoId: "zQWtAV4vvOU", title: "岐阜県美濃市ほるたん屋美濃インター店で焼き肉" },
	{ restaurantName: "手打ちうどん　ふじ樹", categoryJa: "うどん", videoId: "8El0vUxQoa8", title: "水戸市　手打ちうどん　ふじ樹" },
	{ restaurantName: "INOSHOW", categoryJa: "豚骨ラーメン", videoId: "7WGdBfoalck", title: "INOSHOW 保谷店@東京都西東京市東町" },
	{ restaurantName: "喫茶エイティ", categoryJa: "オムライス", videoId: "4wZh8ntFsi4", title: "曽於市「画廊喫茶エイティ」で昔ながらのオムライス" },
	{ restaurantName: "こつぶ庵", categoryJa: "そば", videoId: "zyCgCXsVrXg", title: "【高知県黒潮町】本格蕎麦屋「こつぶ庵」" },
	{ restaurantName: "Stellium Coffee", categoryJa: "カフェ", videoId: "U8OYQMXvZMw", title: "【大分市】STELLIUM COFFEE" },
	{ restaurantName: "味処 一路", categoryJa: "和食", videoId: "Rth40CGoM5Q", title: "【味処 一路・宇都宮市関堀町】絶品和食" },
	{ restaurantName: "炭火焼工房ハンバーグ・ステーキ 黒平", categoryJa: "ステーキ", videoId: "jiRo406FMyA", title: "いちき串木野市「炭火焼工房 黒平」" },
	{ restaurantName: "長浜ラーメン力", categoryJa: "チャーハン", videoId: "dIJ0rDboesA", title: "【福岡県・糸島市】長浜ラーメン力の焼き飯" },
];

const DISCOVERED_TARGETS: EmbedTarget[] = DISCOVERED_DISH_MEDIA.map((media) => ({
	provider: "youtube",
	label: `${media.categoryJa} / ${media.restaurantName}`,
	sourceUrl: `https://www.youtube.com/watch?v=${media.videoId}`,
	staticHtml: youtubeIframeHtml(media.videoId),
}));

function youtubeIframeHtml(videoId: string): string {
	return (
		`<iframe width="100%" height="220" src="https://www.youtube.com/embed/${videoId}" ` +
		'frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" ' +
		"allowfullscreen></iframe>"
	);
}

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

			<Text style={styles.sectionHeading}>①で実際に発見した dish_media（12件）</Text>
			<Text style={styles.subheading}>
				758チャンネルのクロールで発見した 12,557 件の dish_media 候補から、カテゴリが重複しないよう
				決定的に12件を抽出したものです。埋め込み可否は実測で 98.8%、生存率100%
				でしたが、いずれも16:9の長尺動画で Shorts は 0% でした（#1307）。
				フィードUXとして成立するかをこの画面で判断してください。
			</Text>
			{DISCOVERED_TARGETS.map((target) => (
				<EmbedCard key={target.sourceUrl} target={target} />
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
	sectionHeading: {
		fontSize: 17,
		fontWeight: "700",
		marginTop: 8,
		marginBottom: 6,
		color: "#1A1A1A",
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
