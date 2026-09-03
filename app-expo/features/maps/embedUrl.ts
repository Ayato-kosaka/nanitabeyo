// app-expo/features/maps/embedUrl.ts
//
// #843 【設計】Google Places の呼び出し上限に当たったときのフォールバックを、
// アプリ内地図（`GET /v1/maps/embed` が返す HTML）で表示するための URL 組み立て。
//
// ここでは API キーを一切扱わない。キーはサーバ（api/src/v1/maps）だけが知っていて、
// クライアントはこの URL を WebView（native）/ iframe（web）の src にそのまま渡すだけ。

import { Env } from "@/constants/Env";

export type MapsEmbedMode = "search" | "place";

export type MapsEmbedParams = {
	mode: MapsEmbedMode;
	/** search なら検索語、place なら `place_id:<google_place_id>` */
	q: string;
	center?: { latitude: number; longitude: number };
	zoom?: number;
	hl?: string;
};

/** `GET /v1/maps/embed` の URL を組み立てる */
export function buildMapsEmbedApiUrl({ mode, q, center, zoom, hl }: MapsEmbedParams): string {
	const params = new URLSearchParams({ mode, q });
	if (center) params.set("center", `${center.latitude},${center.longitude}`);
	if (zoom != null) params.set("zoom", String(zoom));
	if (hl) params.set("hl", hl);
	return `${Env.BACKEND_BASE_URL}/v1/maps/embed?${params.toString()}`;
}
