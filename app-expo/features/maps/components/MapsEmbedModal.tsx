/*
#843 Google Places の呼び出し上限フォールバックをアプリ内地図で見せるモーダル本体。

`useMapsEmbedModal`（contexts/MapsEmbedModalProvider.tsx）から状態を渡されるだけの
表示コンポーネント。ロジックを持たないので、Provider 抜きに単体でテストできる。

## 「Google マップで開く」は消さない。ただし二重には出さない
埋め込み（`MapsEmbedView`）が使えない/失敗したとき、または #1810 で追加した
トークン取得自体に失敗したときは、fallback ブロックの中に導線を出す。
埋め込みが動いているときは、フッタの外部リンクを常に残す（オーナー確定仕様:
従来の外部ブラウザ導線は退避として残す）。
**ただし fallback ブロックが出ているときは、フッタの同じボタンを重ねて出さない**
（#1810 PL レビュー 3番: 縮退時に同じ操作のボタンが 2 つ並んでいた）。

## トークン取得の 2 段構成（#1810 PL レビュー 2番）
`GET /v1/maps/embed` に認証ガードを付けられない（WebView / iframe は Authorization
ヘッダを送れない）ため、代わりにこのコンポーネントが `POST /v1/maps/embed-token`
（認証必須）でトークンを取り、そのトークン入りの URL だけを `MapsEmbedView` へ渡す。
トークン取得に失敗したら、埋め込みを試さずそのまま fallback へ倒す。
*/
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { X } from "lucide-react-native";

import type { CreateMapsEmbedTokenDto } from "@shared/api/v1/dto";
import type { CreateMapsEmbedTokenResponse } from "@shared/api/v1/res";

import i18n from "@/lib/i18n";
import { useAPICall } from "@/hooks/useAPICall";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useSheetBottomPadding } from "@/hooks/useSheetBottomPadding";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { toErrorLogMessage } from "@/lib/errorMessage";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { buildMapsEmbedTokenRequestPayload, buildMapsEmbedUrlFromToken, type MapsEmbedMode } from "../embedUrl";
import { MapsEmbedView } from "./MapsEmbedView";

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

export type MapsEmbedModalProps = {
	/** null のとき閉じる */
	params: MapsEmbedModalParams | null;
	onClose: () => void;
};

/** トークン取得の状態。loading の間は埋め込みも fallback も出さない（スピナーのみ） */
type EmbedUrlState = { status: "loading" } | { status: "ready"; url: string } | { status: "failed" };

function embedParamsKey(params: MapsEmbedModalParams | null): string {
	if (!params) return "";
	return JSON.stringify({
		mode: params.mode,
		q: params.q,
		center: params.center,
		zoom: params.zoom,
		hl: params.hl,
	});
}

export function MapsEmbedModal({ params, onClose }: MapsEmbedModalProps) {
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	// #940 対策: callBackend は毎レンダー参照が変わりうるため、effect の依存には入れず ref 経由で使う
	const callBackendRef = useRef(callBackend);
	callBackendRef.current = callBackend;
	// #1742 Modal はネイティブでは別ウィンドウで、画面側の safe area が届かない
	const paddingBottom = useSheetBottomPadding(16);

	const [embedUrlState, setEmbedUrlState] = useState<EmbedUrlState>({ status: "loading" });
	// MapsEmbedView 側（native の WebView 不在 / 読み込み失敗、web の fetch 事前チェック）が
	// fallback へ切り替わったことをここで受け取る
	const [nativeFallback, setNativeFallback] = useState(false);
	const handleNativeFallback = useCallback(() => setNativeFallback(true), []);

	const paramsKey = embedParamsKey(params);

	useEffect(() => {
		if (!params) return;
		let cancelled = false;
		setEmbedUrlState({ status: "loading" });
		setNativeFallback(false);

		const payload: CreateMapsEmbedTokenDto = buildMapsEmbedTokenRequestPayload({
			mode: params.mode,
			q: params.q,
			center: params.center,
			zoom: params.zoom,
			hl: params.hl,
		});

		callBackendRef
			.current<CreateMapsEmbedTokenDto, CreateMapsEmbedTokenResponse>("v1/maps/embed-token", {
				method: "POST",
				requestPayload: payload,
			})
			.then((res) => {
				if (cancelled) return;
				setEmbedUrlState({ status: "ready", url: buildMapsEmbedUrlFromToken(res.token) });
			})
			.catch((error) => {
				if (cancelled) return;
				setEmbedUrlState({ status: "failed" });
				logFrontendEvent({
					event_name: "maps_embed_token_fetch_failed",
					error_level: "warn",
					payload: { mode: params.mode, source: params.source, error: toErrorLogMessage(error) },
				});
			});

		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [paramsKey]);

	const handleOpenExternal = useCallback(() => {
		if (!params) return;
		lightImpact();
		logFrontendEvent({
			event_name: "maps_embed_external_link_opened",
			error_level: "log",
			payload: { mode: params.mode, source: params.source },
		});
		openExternalUrl(params.externalUrl).catch((error) => {
			logFrontendEvent({
				event_name: "maps_embed_external_link_open_failed",
				error_level: "error",
				payload: { mode: params.mode, source: params.source, error: toErrorLogMessage(error) },
			});
		});
	}, [params, lightImpact, logFrontendEvent]);

	if (!params) return null;

	// #1810 PL レビュー 3番: fallback ブロック（このボタンを含む）が出ているときは、
	// フッタの同じボタンを重ねて出さない
	const isFallbackShown = embedUrlState.status === "failed" || nativeFallback;

	const fallbackBlock = (
		<View style={styles.fallback}>
			<Text style={styles.fallbackText}>{i18n.t("MapsEmbed.unavailable")}</Text>
			<TouchableOpacity
				testID="maps-embed-modal-fallback-button"
				style={styles.fallbackButton}
				onPress={handleOpenExternal}
				accessibilityRole="button">
				<Text style={styles.fallbackButtonText}>{i18n.t("MapsEmbed.openExternal")}</Text>
			</TouchableOpacity>
		</View>
	);

	return (
		<Modal visible transparent animationType="slide" onRequestClose={onClose} testID="maps-embed-modal">
			<View style={styles.backdrop}>
				<View style={[styles.sheet, { paddingBottom }]}>
					<View style={styles.header}>
						<Text style={styles.title} numberOfLines={1}>
							{params.title || i18n.t("MapsEmbed.title")}
						</Text>
						<TouchableOpacity
							testID="maps-embed-modal-close"
							onPress={onClose}
							accessibilityRole="button"
							accessibilityLabel={i18n.t("Common.close")}>
							<X size={22} color={colors.textPrimaryAlt} />
						</TouchableOpacity>
					</View>

					<View style={styles.mapArea}>
						{embedUrlState.status === "loading" ? (
							<View style={styles.loading} testID="maps-embed-modal-loading">
								<ActivityIndicator size="small" color={colors.textSecondary} />
							</View>
						) : embedUrlState.status === "failed" ? (
							fallbackBlock
						) : (
							<MapsEmbedView
								url={embedUrlState.url}
								testID="maps-embed-modal-view"
								fallback={fallbackBlock}
								onFallback={handleNativeFallback}
							/>
						)}
					</View>

					{!isFallbackShown && (
						<TouchableOpacity
							testID="maps-embed-modal-external-link"
							style={styles.externalLink}
							onPress={handleOpenExternal}
							accessibilityRole="button">
							<Text style={styles.externalLinkText}>{i18n.t("MapsEmbed.openExternal")}</Text>
						</TouchableOpacity>
					)}
				</View>
			</View>
		</Modal>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		backdrop: {
			flex: 1,
			backgroundColor: "rgba(0,0,0,0.5)",
			justifyContent: "flex-end",
		},
		sheet: {
			height: "80%",
			backgroundColor: c.surface,
			borderTopLeftRadius: 16,
			borderTopRightRadius: 16,
			overflow: "hidden",
		},
		header: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			paddingHorizontal: 20,
			paddingTop: 16,
			paddingBottom: 12,
		},
		title: {
			flex: 1,
			marginRight: 12,
			fontSize: 18,
			fontWeight: "700",
			color: c.textPrimaryAlt,
		},
		mapArea: {
			flex: 1,
			backgroundColor: c.surfaceSubtle,
		},
		loading: {
			flex: 1,
			alignItems: "center",
			justifyContent: "center",
		},
		fallback: {
			flex: 1,
			alignItems: "center",
			justifyContent: "center",
			paddingHorizontal: 24,
			gap: 16,
		},
		fallbackText: {
			fontSize: 14,
			color: c.textSecondary,
			textAlign: "center",
		},
		fallbackButton: {
			backgroundColor: c.brand,
			borderRadius: 10,
			paddingVertical: 12,
			paddingHorizontal: 20,
		},
		fallbackButtonText: {
			color: FixedColors.onFilled,
			fontSize: 15,
			fontWeight: "700",
		},
		externalLink: {
			paddingVertical: 14,
			alignItems: "center",
		},
		externalLinkText: {
			fontSize: 14,
			fontWeight: "600",
			color: c.brand,
		},
	});
