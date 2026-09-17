/*
#843 Google Places の呼び出し上限フォールバックをアプリ内地図で見せる画面本体。

`useMapsEmbedModal`（features/maps/hooks/useMapsEmbedModal.ts）が解決した params を、
呼び出し元のルート（`app/[locale]/maps-embed.tsx`）から渡されるだけの表示コンポーネント。
ロジックを持たないので、ルート抜きに単体でテストできる。

#1810 【設計】以前は react-native-paper の bare `<Portal>` 経由で `<Modal>` として
常設マウントしていたが、#1350 で全廃した公開アプリのオーバーレイ層を作り直すことになり
CI ガード（`assert-legacy-blur-modal-boundary.mjs`）に引っかかる。expo-router のルート
（`presentation: "modal"` の Stack.Screen）を画面そのものとして新設したため、
RN の `<Modal>` ラッパーは不要になった（ネイティブのモーダル表示は Stack.Screen 側が担う）。

## 「Google マップで開く」は消さない。ただし二重には出さない
埋め込み（`MapsEmbedView`）が使えない/失敗したときは、fallback ブロックの中に導線を出す。
埋め込みが動いているときは、フッタの外部リンクを常に残す（オーナー確定仕様:
従来の外部ブラウザ導線は退避として残す）。
**ただし fallback ブロックが出ているときは、フッタの同じボタンを重ねて出さない**
（#1810 PL レビュー 3番: 縮退時に同じ操作のボタンが 2 つ並んでいた）。

## トークン取得はこのコンポーネントの責務ではない（#1810 PL レビュー 3番）
`GET /v1/maps/embed` に認証ガードを付けられない（WebView / iframe は Authorization
ヘッダを送れない）ため、`POST /v1/maps/embed-token`（認証必須）でトークンを取ってから
埋め込み URL を組み立てる必要がある。この取得は **`useMapsEmbedModal` が画面へ遷移する
前に行う**（`showMapsEmbedModal` 参照）。遷移した後にトークンを取ると、
`GOOGLE_MAPS_EMBED_API_KEY` 未設定の間 «画面が開く → 表示できない → もう一度押す»
という無意味な往復になるため、このコンポーネントは常に解決済みの `embedUrl` を受け取る
前提にしてある（取得に失敗したときは、そもそもこの画面へ遷移しない）。
*/
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { X } from "lucide-react-native";

import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useSheetBottomPadding } from "@/hooks/useSheetBottomPadding";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { toErrorLogMessage } from "@/lib/errorMessage";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { type MapsEmbedMode } from "../embedUrl";
import { MapsEmbedView } from "./MapsEmbedView";

/** `useMapsEmbedModal` がトークン取得（`POST /v1/maps/embed-token`）に成功したときだけ
 *  組み立てる、この画面が実際に受け取る形（`app/[locale]/maps-embed.tsx` のクエリと対応）。
 *  q / center / zoom / hl はトークン発行の入力（`useMapsEmbedModal`）にしか使わないため、
 *  表示にしか関心の無いこの画面の型には含めない。 */
export type ResolvedMapsEmbedModalParams = {
	mode: MapsEmbedMode;
	/** ヘッダに出す店名・カテゴリ名など。未指定なら汎用の見出し */
	title?: string;
	/** 埋め込みが使えないときに開く従来の外部 URL */
	externalUrl: string;
	/** ログ用の文脈（どの画面から開いたか） */
	source: string;
	/** `GET /v1/maps/embed` の URL（features/maps/embedUrl.ts の buildMapsEmbedUrlFromToken） */
	embedUrl: string;
};

export type MapsEmbedModalProps = {
	/** null のとき閉じる */
	params: ResolvedMapsEmbedModalParams | null;
	onClose: () => void;
};

export function MapsEmbedModal({ params, onClose }: MapsEmbedModalProps) {
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	// #1742 画面下端に貼り付く要素（フッタの外部リンク）はナビゲーションバー等の
	// システム UI を自分で避ける必要がある（詳細は useSheetBottomPadding のコメント）
	const paddingBottom = useSheetBottomPadding(16);

	// MapsEmbedView 側（native の WebView 不在 / 読み込み失敗、web の fetch 事前チェック）が
	// fallback へ切り替わったことをここで受け取る
	const [nativeFallback, setNativeFallback] = useState(false);
	const handleNativeFallback = useCallback(() => setNativeFallback(true), []);

	// モーダルが閉じたら（params が null に戻ったら）、次回また新規に判定できるよう
	// 縮退状態を戻す。⚠️ params が非 null の間（= MapsEmbedView が既にマウントされている間）に
	// ここで setNativeFallback(false) を無条件に呼ぶと、MapsEmbedView 側の
	// 「fallback へ倒れたので onFallback を呼ぶ」effect（子）と、この effect（親）が
	// 同じコミットで競合し、子が立てた true をこの effect が上書きして消してしまう
	// （実測: 初回マウント時に子→親の順で effect が走るため、無条件リセットだと必ず負ける）
	useEffect(() => {
		if (!params) setNativeFallback(false);
	}, [params]);

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
	const isFallbackShown = nativeFallback;

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
		<View style={[styles.container, { paddingBottom }]} testID="maps-embed-modal">
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
				<MapsEmbedView
					url={params.embedUrl}
					testID="maps-embed-modal-view"
					fallback={fallbackBlock}
					onFallback={handleNativeFallback}
				/>
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
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			backgroundColor: c.surface,
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
