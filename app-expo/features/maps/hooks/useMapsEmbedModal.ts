/*
#843 / #1810 【設計】Google Places の呼び出し上限フォールバックをアプリ内地図で見せる hook。

以前は react-native-paper の bare `<Portal>` で全画面オーバーレイとして常設マウントしていたが、
#1350 で全廃した公開アプリのオーバーレイ層を作り直すことになり、CI ガード
（`assert-legacy-blur-modal-boundary.mjs`）が禁止している。地図のような全画面表示は
expo-router のルート（`app/[locale]/maps-embed.tsx`）へ切り出した。

呼び出し側（`useGoogleMapsFallback` / `SelectedRestaurantDetails`）は
`showMapsEmbedModal(params)` を呼ぶだけでよく、Provider で包む必要も無くなった
（状態を持つのは行き先のルートだけで、この hook 自身は状態を持たない）。

#1810 PL レビュー 3番【設計】`GOOGLE_MAPS_EMBED_API_KEY` が未設定の間、
`POST /v1/maps/embed-token` は 503 で必ず失敗する。画面へ遷移してからトークン取得に
失敗すると「画面が開く → 表示できません → もう一度押す」という無意味な往復になるため、
トークン取得を**画面へ遷移する前**に行い、成功したときだけ遷移する。失敗したら
（503 に限らず、どんなエラーでも）画面を一度も開かず、従来どおり `externalUrl` を
外部ブラウザで開く。
*/
import { useCallback } from "react";
import { useRouter } from "expo-router";

import type { CreateMapsEmbedTokenDto } from "@shared/api/v1/dto";
import type { CreateMapsEmbedTokenResponse } from "@shared/api/v1/res";

import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import { useLocale } from "@/hooks/useLocale";
import { toErrorLogMessage } from "@/lib/errorMessage";
import { openExternalUrl } from "@/lib/openExternalUrl";
import {
	buildMapsEmbedTokenRequestPayload,
	buildMapsEmbedUrlFromToken,
	type MapsEmbedMode,
} from "@/features/maps/embedUrl";

export type MapsEmbedModalParams = {
	mode: MapsEmbedMode;
	q: string;
	center?: { latitude: number; longitude: number };
	zoom?: number;
	hl?: string;
	/** ヘッダに出す店名・カテゴリ名など。未指定なら汎用の見出し */
	title?: string;
	/** 埋め込みが使えないときに開く従来の外部 URL */
	externalUrl: string;
	/** ログ用の文脈（どの画面から開いたか） */
	source: string;
};

export type UseMapsEmbedModalResult = {
	showMapsEmbedModal: (params: MapsEmbedModalParams) => void;
};

export function useMapsEmbedModal(): UseMapsEmbedModalResult {
	const router = useRouter();
	const { locale } = useLocale();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();

	const showMapsEmbedModal = useCallback(
		(params: MapsEmbedModalParams) => {
			const payload: CreateMapsEmbedTokenDto = buildMapsEmbedTokenRequestPayload({
				mode: params.mode,
				q: params.q,
				center: params.center,
				zoom: params.zoom,
				hl: params.hl,
			});

			callBackend<CreateMapsEmbedTokenDto, CreateMapsEmbedTokenResponse>("v1/maps/embed-token", {
				method: "POST",
				requestPayload: payload,
			})
				.then((res) => {
					logFrontendEvent({
						event_name: "maps_embed_modal_shown",
						error_level: "log",
						payload: { mode: params.mode, source: params.source },
					});
					router.push({
						pathname: "/[locale]/maps-embed",
						params: {
							locale,
							mode: params.mode,
							...(params.title ? { title: params.title } : {}),
							externalUrl: params.externalUrl,
							source: params.source,
							embedUrl: buildMapsEmbedUrlFromToken(res.token),
						},
					});
				})
				.catch((error) => {
					logFrontendEvent({
						event_name: "maps_embed_token_fetch_failed",
						error_level: "warn",
						payload: { mode: params.mode, source: params.source, error: toErrorLogMessage(error) },
					});
					return openExternalUrl(params.externalUrl).catch((openError) => {
						logFrontendEvent({
							event_name: "maps_embed_external_link_open_failed",
							error_level: "error",
							payload: { mode: params.mode, source: params.source, error: toErrorLogMessage(openError) },
						});
					});
				});
		},
		[callBackend, locale, logFrontendEvent, router],
	);

	return { showMapsEmbedModal };
}
