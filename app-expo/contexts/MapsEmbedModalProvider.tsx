/*
#843 【設計】Google Places の呼び出し上限フォールバックをアプリ内地図で見せるための Provider。

`DialogProvider`（contexts/DialogProvider.tsx）は文言 + OK/Cancel の固定レイアウトしか
持てず（`Dialog.Content` に任意コンポーネントを差し込む口が無い）、WebView/iframe の
ような大きなカスタムコンテンツは乗らない。そのため専用の軽量 Provider を用意し、
`SnackbarProvider` / `DialogProvider` と同じ位置（app/[locale]/_layout.tsx）へ
1 つだけ常設マウントする。

呼び出し側（`useGoogleMapsFallback` / `SelectedRestaurantDetails`）は
`showMapsEmbedModal(params)` を呼ぶだけでよく、モーダルの描画場所を自分の JSX
ツリーへ足す必要はない（`useDialog().showDialog` と同じ使い勝手）。

#1810 PL レビュー 3番【設計】`GOOGLE_MAPS_EMBED_API_KEY` が未設定の間、
`POST /v1/maps/embed-token` は 503 で必ず失敗する。以前はここでモーダルを即座に開き、
モーダルの中でトークン取得が失敗してから縮退表示に切り替えていたため、
«モーダルが開く → 「表示できません」→ もう一度ボタンを押す» という
**タップが 1 回増えるだけの無意味な往復**が挟まっていた（main はボタン 1 回で
外部ブラウザへ直行する）。

トークン取得を**モーダルを開く前**にここへ寄せ、成功したときだけモーダルを開く。
失敗したら（503 に限らず、どんなエラーでも）モーダルを一度も開かず、
従来どおり `externalUrl` を外部ブラウザで開く。呼び出し側の 2 か所
（`useGoogleMapsFallback` / `SelectedRestaurantDetails`）に同じ判定を書かないための
一元化でもある。
*/
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Portal } from "react-native-paper";

import type { CreateMapsEmbedTokenDto } from "@shared/api/v1/dto";
import type { CreateMapsEmbedTokenResponse } from "@shared/api/v1/res";

import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import { toErrorLogMessage } from "@/lib/errorMessage";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { buildMapsEmbedTokenRequestPayload, buildMapsEmbedUrlFromToken } from "@/features/maps/embedUrl";
import {
	MapsEmbedModal,
	type MapsEmbedModalParams,
	type ResolvedMapsEmbedModalParams,
} from "@/features/maps/components/MapsEmbedModal";

export type { MapsEmbedModalParams };

export type MapsEmbedModalContextType = {
	showMapsEmbedModal: (params: MapsEmbedModalParams) => void;
};

const MapsEmbedModalContext = createContext<MapsEmbedModalContextType | undefined>(undefined);

export function MapsEmbedModalProvider({ children }: { children: React.ReactNode }) {
	const [current, setCurrent] = useState<ResolvedMapsEmbedModalParams | null>(null);
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
					setCurrent({ ...params, embedUrl: buildMapsEmbedUrlFromToken(res.token) });
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
		[callBackend, logFrontendEvent],
	);

	const handleClose = useCallback(() => {
		setCurrent((prev) => {
			if (prev) {
				logFrontendEvent({
					event_name: "maps_embed_modal_closed",
					error_level: "log",
					payload: { mode: prev.mode, source: prev.source },
				});
			}
			return null;
		});
	}, [logFrontendEvent]);

	const contextValue = useMemo<MapsEmbedModalContextType>(() => ({ showMapsEmbedModal }), [showMapsEmbedModal]);

	return (
		<MapsEmbedModalContext.Provider value={contextValue}>
			{children}
			<Portal>
				<MapsEmbedModal params={current} onClose={handleClose} />
			</Portal>
		</MapsEmbedModalContext.Provider>
	);
}

export function useMapsEmbedModal(): MapsEmbedModalContextType {
	const context = useContext(MapsEmbedModalContext);
	if (!context) {
		throw new Error("[useMapsEmbedModal] This hook must be used within a <MapsEmbedModalProvider>.");
	}
	return context;
}
