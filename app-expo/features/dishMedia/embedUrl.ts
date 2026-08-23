/*
#1375 4 巡目実機確認: 取り込んだ SNS 投稿（render_type='external_embed'）の
«再生用» 埋め込み URL を組む純関数。

## なぜ canonicalUrl をそのまま使わないのか

canonicalUrl は投稿ページ（instagram.com/reel/... 等）で、iframe / WebView に
そのまま入れると X-Frame-Options で拒否されるか、フルサイトが出てしまう。
各 provider が公式に用意している «埋め込み専用 URL» を使う。

| provider | 埋め込み URL | 根拠 |
| --- | --- | --- |
| instagram | `https://www.instagram.com/p/{code}/embed/` | 公式 blockquote 埋め込みが最終的に描く iframe と同じ。reel のコードも `/p/{code}/` で解決される（サーバ側 sns-oembed.service.ts が resolve で実測済みの同じ経路）。`/embed/captioned/` はヘッダ＋キャプションの白カードが付き全画面フィードで浮くため、映像本体だけの `/embed/` を使う（独立レビュー指摘） |
| tiktok | `https://www.tiktok.com/embed/v2/{videoId}` | 公式 embed v2。動画 ID だけで動く |
| youtube | `https://www.youtube.com/embed/{videoId}?playsinline=1&autoplay=1&mute=1` | 公式 iframe embed。playsinline はモバイルでフルスクリーンに奪われないため。autoplay+mute は既存 dish_media の «着地したら動く» に寄せるため（ブラウザは無音でないと自動再生を許可しない） |

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
				embedUrl: `https://www.instagram.com/p/${encodedId}/embed/`,
				providerLabel: "Instagram",
			};
		case "tiktok":
			return {
				embedUrl: `https://www.tiktok.com/embed/v2/${encodedId}`,
				providerLabel: "TikTok",
			};
		case "youtube":
			return {
				embedUrl: `https://www.youtube.com/embed/${encodedId}?playsinline=1&autoplay=1&mute=1`,
				providerLabel: "YouTube",
			};
		default:
			return null;
	}
}

/*
WebView 内ナビゲーションの許可判定。

独立レビュー指摘: onShouldStartLoadWithRequest は **サブフレーム（広告 iframe）や
302 リダイレクトでも呼ばれる**（iOS は isTopFrame をイベントに載せるだけで必ず呼ぶ /
Android は isForMainFrame を捨てて URL 版へ委譲する）。「embedUrl と不一致なら
外部ブラウザへ」という判定にすると、指を触れていないのに広告フレームの URL で
ブラウザが開いたり、埋め込み本体のリダイレクトが打ち切られて真っ黒になる。

この WebView は pointerEvents="none" の **表示専用**（タップは親の再生ボタンが受ける）
なので、中で起きるナビゲーションはすべて埋め込みページ自身の内部動作である。
外部ブラウザは一切開かず、http(s) と about: だけ通し、intent:// market:// 等の
アプリ起動スキームだけを黙って遮断する。
*/
export function isAllowedEmbedNavigation(url: string): boolean {
	return /^https?:\/\//.test(url) || url.startsWith("about:");
}
