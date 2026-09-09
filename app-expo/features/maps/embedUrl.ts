// app-expo/features/maps/embedUrl.ts
//
// #843 【設計】Google Places の呼び出し上限に当たったときのフォールバックを、
// アプリ内地図（`GET /v1/maps/embed` が返す HTML）で表示するための URL 組み立て。
//
// #1810 PL レビュー 2番【設計】GET /v1/maps/embed は認証ガードを持てない
// （WebView / iframe は Authorization ヘッダを送れない）。代わりに、認証必須の
// POST /v1/maps/embed-token（`MapsEmbedModalProvider` がモーダルを開く前に
// `useAPICall` 経由で叩く。#1810 PL レビュー 3番）が発行した短命トークンだけを受け取る。
// ここではキーもトークンの中身も一切扱わず、
// 「トークンを受け取って URL に埋め込む」「リクエストボディの形を整える」だけを行う。

import type { CreateMapsEmbedTokenDto } from "@shared/api/v1/dto";
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

/** POST /v1/maps/embed-token のリクエストボディを組み立てる（center を "<lat>,<lng>" へ変換） */
export function buildMapsEmbedTokenRequestPayload({
	mode,
	q,
	center,
	zoom,
	hl,
}: MapsEmbedParams): CreateMapsEmbedTokenDto {
	return {
		mode,
		q,
		center: center ? `${center.latitude},${center.longitude}` : undefined,
		zoom,
		hl,
	};
}

/** `GET /v1/maps/embed` の URL を、発行済みトークンから組み立てる */
export function buildMapsEmbedUrlFromToken(token: string): string {
	return `${Env.BACKEND_BASE_URL}/v1/maps/embed?token=${encodeURIComponent(token)}`;
}
