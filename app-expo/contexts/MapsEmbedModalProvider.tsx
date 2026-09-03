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
*/
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Portal } from "react-native-paper";

import { useLogger } from "@/hooks/useLogger";
import { MapsEmbedModal, type MapsEmbedModalParams } from "@/features/maps/components/MapsEmbedModal";

export type { MapsEmbedModalParams };

export type MapsEmbedModalContextType = {
	showMapsEmbedModal: (params: MapsEmbedModalParams) => void;
};

const MapsEmbedModalContext = createContext<MapsEmbedModalContextType | undefined>(undefined);

export function MapsEmbedModalProvider({ children }: { children: React.ReactNode }) {
	const [current, setCurrent] = useState<MapsEmbedModalParams | null>(null);
	const { logFrontendEvent } = useLogger();

	const showMapsEmbedModal = useCallback(
		(params: MapsEmbedModalParams) => {
			logFrontendEvent({
				event_name: "maps_embed_modal_shown",
				error_level: "log",
				payload: { mode: params.mode, source: params.source },
			});
			setCurrent(params);
		},
		[logFrontendEvent],
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
