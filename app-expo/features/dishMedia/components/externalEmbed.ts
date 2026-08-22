import type { ExternalDishMediaEmbed } from "@shared/api/v1/res";

export type ExternalDishMediaEmbedProps = {
	embed: ExternalDishMediaEmbed;
	isActive: boolean;
};

/**
 * provider公式oEmbed HTMLを、そのままWebViewへ渡さずCSP付きdocumentへ閉じ込める。
 *
 * - 任意originのscript/frame/connectは禁止
 * - form送信、base URL差替え、親画面遷移は禁止
 * - provider embedが必要とする公式domainだけを許可
 *
 * oEmbed HTML自体の取得元検証はBigQuery loader/API側でも行う。ここは表示時の
 * defense-in-depthであり、未確認HTMLを安全にする万能sanitizerではない。
 */
export const buildExternalEmbedDocument = ({ provider, embedHtml }: ExternalDishMediaEmbed) => {
	const providerSources = {
		instagram: "https://instagram.com https://*.instagram.com https://*.cdninstagram.com",
		tiktok: "https://tiktok.com https://*.tiktok.com https://*.tiktokcdn.com https://*.byteoversea.com",
		x: "https://x.com https://*.x.com https://twitter.com https://*.twitter.com https://*.twimg.com",
		// #1273 youtube を追加（migration 20260814T0000）。①で確立した無料の発見手法は
		// YouTube 由来で、実測でも embeddable 98.8% / 生存率100% と土台が最も健全。
		// youtube-nocookie も許可するのは公式 iframe が privacy-enhanced mode を使う場合があるため。
		youtube:
			"https://youtube.com https://*.youtube.com https://youtube-nocookie.com https://*.youtube-nocookie.com https://*.ytimg.com https://*.googlevideo.com",
	}[provider];

	const contentSecurityPolicy = [
		"default-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
		`img-src data: blob: ${providerSources}`,
		`media-src blob: ${providerSources}`,
		`style-src 'unsafe-inline' ${providerSources}`,
		`script-src ${providerSources}`,
		`frame-src ${providerSources}`,
		`connect-src ${providerSources}`,
	].join("; ");

	return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}" />
    <style>
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
      body { display: flex; align-items: center; justify-content: center; }
      iframe, video, img { max-width: 100% !important; max-height: 100% !important; }
      blockquote { margin: 0 !important; min-width: 0 !important; width: 100% !important; }
    </style>
  </head>
  <body>${embedHtml}</body>
</html>`;
};

export const isProviderNavigationUrl = (provider: ExternalDishMediaEmbed["provider"], url: string) => {
	if (url === "about:blank") return true;
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "https:") return false;
		const hosts = {
			instagram: ["instagram.com"],
			tiktok: ["tiktok.com"],
			x: ["x.com", "twitter.com"],
			// #1273 youtube の埋め込みは youtube.com / youtube-nocookie.com へ遷移しうる
			youtube: ["youtube.com", "youtube-nocookie.com", "youtu.be"],
		}[provider];
		return hosts.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
	} catch {
		return false;
	}
};
