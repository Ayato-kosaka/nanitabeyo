// api/src/v1/maps/maps-embed.html.ts
//
// #843 【設計】Google Places の呼び出し上限に当たったときの逃げ道として、
// Maps Embed API（無料・上限なし・課金 SKU を消費しない）を iframe で埋め込む HTML を組み立てる。
//
// ## API キーをここでしか触らない
// `GOOGLE_MAPS_EMBED_API_KEY` はこのファイルが組み立てる iframe の `src` にだけ入る。
// レスポンス JSON・ログへ載せないことは呼び出し側（maps.controller.ts）の責務だが、
// この関数自身も「本文のどこか一箇所にしか現れない」形を保つ。
//
// ## エスケープをここへ閉じる
// 差し込む値は `q` / `center` / `hl`（すべて利用者由来になりうる）。
// URLSearchParams が `&` `<` `>` 等を percent-encode するので URL としては安全だが、
// その結果を HTML の属性値へ入れる際は `&` が区切り文字として残るため、
// 属性値としてのエスケープ（`escapeHtml`）を必ずもう一段かける。

import type { MapsEmbedMode } from "@shared/v1/dto";

/** HTML の特殊文字をエスケープする（属性値・テキストノードの両方に安全） */
export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

const MAPS_EMBED_BASE_URL = "https://www.google.com/maps/embed/v1";

export type BuildMapsEmbedSrcParams = {
	mode: MapsEmbedMode;
	q: string;
	center?: string;
	zoom?: number;
	hl?: string;
	apiKey: string;
};

/** Maps Embed API の iframe src を組み立てる。値は URLSearchParams が percent-encode する */
export function buildMapsEmbedSrc({ mode, q, center, zoom, hl, apiKey }: BuildMapsEmbedSrcParams): string {
	const url = new URL(`${MAPS_EMBED_BASE_URL}/${mode}`);
	url.searchParams.set("key", apiKey);
	url.searchParams.set("q", q);
	if (center) url.searchParams.set("center", center);
	if (zoom != null) url.searchParams.set("zoom", String(zoom));
	if (hl) url.searchParams.set("hl", hl);
	return url.toString();
}

/** `/v1/maps/embed` が返す HTML 本文。iframe 1 枚だけを画面いっぱいに敷く */
export function renderMapsEmbedPage(embedSrc: string): string {
	const src = escapeHtml(embedSrc);
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>html,body,iframe{margin:0;padding:0;width:100%;height:100%;border:0;display:block;}</style>
</head>
<body>
<iframe src="${src}" allowfullscreen loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
</body>
</html>`;
}
