/*
#1375 4 巡目実機確認: 取り込んだ SNS 投稿（render_type='external_embed'）の
«再生用» 埋め込み URL を組む純関数。

## なぜ canonicalUrl をそのまま使わないのか

canonicalUrl は投稿ページ（instagram.com/reel/... 等）で、iframe / WebView に
そのまま入れると X-Frame-Options で拒否されるか、フルサイトが出てしまう。
各 provider が公式に用意している «埋め込み専用 URL» を使う。

| provider | 埋め込み URL | 根拠 |
| --- | --- | --- |
| instagram | `https://www.instagram.com/p/{code}/embed/captioned/` | 公式 blockquote 埋め込みが最終的に描く iframe と同じ。reel のコードも `/p/{code}/` で解決される（サーバ側 sns-oembed.service.ts が resolve で実測済みの同じ経路） |
| tiktok | `https://www.tiktok.com/embed/v2/{videoId}` | 公式 embed v2。動画 ID だけで動く |
| youtube | `https://www.youtube.com/embed/{videoId}?playsinline=1` | 公式 iframe embed。playsinline はモバイルでフルスクリーンに奪われないため |

判定できない provider は null（呼び出し側は «外部で開く» へ縮退する）。
*/

export type EmbeddablePlayerSource = {
	/** iframe / WebView に入れる URL */
	embedUrl: string;
	/** 「◯◯で再生」の表示名。固有名詞なので翻訳しない（sns-import.tsx と同じ判断） */
	providerLabel: string;
};

export function buildExternalEmbedPlayerSource(
	provider: string,
	externalContentId: string,
): EmbeddablePlayerSource | null {
	if (!externalContentId) return null;
	const encodedId = encodeURIComponent(externalContentId);
	switch (provider) {
		case "instagram":
			return {
				embedUrl: `https://www.instagram.com/p/${encodedId}/embed/captioned/`,
				providerLabel: "Instagram",
			};
		case "tiktok":
			return {
				embedUrl: `https://www.tiktok.com/embed/v2/${encodedId}`,
				providerLabel: "TikTok",
			};
		case "youtube":
			return {
				embedUrl: `https://www.youtube.com/embed/${encodedId}?playsinline=1`,
				providerLabel: "YouTube",
			};
		default:
			return null;
	}
}
