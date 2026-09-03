/*
#843 Google Places の呼び出し上限フォールバックをアプリ内地図で見せるモーダル本体。

`useMapsEmbedModal`（contexts/MapsEmbedModalProvider.tsx）から状態を渡されるだけの
表示コンポーネント。ロジックを持たないので、Provider 抜きに単体でテストできる。

## 「Google マップで開く」は消さない
埋め込み（`MapsEmbedView`）が使えない/失敗したときは `fallback` の中で導線を出す
（`MapsEmbedView` 側の責務）。加えて、埋め込みが動いているときも常に外部リンクを
残す（オーナー確定仕様: 従来の外部ブラウザ導線は退避として残す）。
*/
import React, { useCallback } from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { X } from "lucide-react-native";

import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useSheetBottomPadding } from "@/hooks/useSheetBottomPadding";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { toErrorLogMessage } from "@/lib/errorMessage";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { buildMapsEmbedApiUrl, type MapsEmbedMode } from "../embedUrl";
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

export function MapsEmbedModal({ params, onClose }: MapsEmbedModalProps) {
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	// #1742 Modal はネイティブでは別ウィンドウで、画面側の safe area が届かない
	const paddingBottom = useSheetBottomPadding(16);

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

	const embedUrl = buildMapsEmbedApiUrl({
		mode: params.mode,
		q: params.q,
		center: params.center,
		zoom: params.zoom,
		hl: params.hl,
	});

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
						<MapsEmbedView
							url={embedUrl}
							testID="maps-embed-modal-view"
							fallback={
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
							}
						/>
					</View>

					<TouchableOpacity
						testID="maps-embed-modal-external-link"
						style={styles.externalLink}
						onPress={handleOpenExternal}
						accessibilityRole="button">
						<Text style={styles.externalLinkText}>{i18n.t("MapsEmbed.openExternal")}</Text>
					</TouchableOpacity>
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
