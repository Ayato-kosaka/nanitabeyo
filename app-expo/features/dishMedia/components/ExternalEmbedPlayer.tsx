/*
#1375 4 巡目実機確認: 取り込んだ SNS 投稿（render_type='external_embed'）の再生（ネイティブ）。

## 実機報告「保存後にリールが再生されない」の真因

サーバは externalEmbed（provider / canonicalUrl / サムネイル）を返しているのに、
**それを描く provider 別コンポーネントがアプリに存在しなかった**。設計コメント
（#1273 §14 / #1399「表示は canonicalUrl から provider 別コンポーネントが行う」）が
実装されないまま取り込み機能だけが先行していた。ここがその実装である。

## このブランチ（OTA 配信）では «再生ボタン → アプリ内ブラウザ» のみ

`react-native-webview` は現行 1.14 ビルドに入っておらず、ネイティブモジュールの
追加は EAS Build（オーナー承認制）が要る。CLAUDE.md の取り決めどおり、
**WebView によるフィード内埋め込み表示はネイティブ専用ブランチへ切り出した**。
ここに require("react-native-webview") を書くと依存が無い状態で Metro の
バンドルが解決できず落ちるので、このファイルに WebView のコードは置かない。

現行の動作: 親のサムネイルの上に再生ボタンを重ね、タップでアプリ内ブラウザ
（expo-web-browser。SFSafariViewController / Custom Tabs）を開いてそこで再生する。

web 版は `ExternalEmbedPlayer.web.tsx`（iframe）が Metro に選ばれる。
*/
import React, { useCallback } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { GestureDetector, type GestureType } from "react-native-gesture-handler";
import { Play } from "lucide-react-native";

import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import type { DishMediaExternalEmbed } from "@shared/api/v1/res";
import { buildExternalEmbedPlayerSource } from "../embedUrl";
// #1509 メディア（サムネイル）の上に重ねる再生 UI のため、テーマ非追従の FixedColors を使う
import { FixedColors } from "@/constants/Palette";

export type ExternalEmbedPlayerProps = {
	embed: Pick<DishMediaExternalEmbed, "provider" | "externalContentId" | "canonicalUrl" | "embedStatus">;
	/**
	 * 前面のページだけ true。false の間は何も描かない（親のサムネイルが見えている）。
	 * 埋め込みをフィードの全セルに立てない（メモリと帯域のため）
	 */
	isActive: boolean;
	/**
	 * #694 と同じ仕組み。親（DishMediaContent）の tapGesture はこの gesture の失敗を
	 * 待つので、再生ボタンのタップで ActionSheet が同時に開かない（独立レビュー指摘）。
	 * 1 つの gesture は 1 つの GestureDetector にしか付けられないため、
	 * ActionButtons の buttonsGesture とは別のインスタンスを親が作って渡す
	 */
	blockParentTapGesture?: GestureType;
};

export function ExternalEmbedPlayer({ embed, isActive, blockParentTapGesture }: ExternalEmbedPlayerProps) {
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();

	const source = buildExternalEmbedPlayerSource(embed.provider, embed.externalContentId);

	const handleOpenExternally = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "external_embed_open_browser",
			error_level: "log",
			payload: { provider: embed.provider },
		});
		// アプリ内ブラウザ（閉じればフィードへそのまま戻る）。失敗は握り潰さずログだけ残す
		WebBrowser.openBrowserAsync(embed.canonicalUrl).catch((error) => {
			logFrontendEvent({
				event_name: "external_embed_open_browser_failed",
				error_level: "error",
				payload: { provider: embed.provider, error: error instanceof Error ? error.message : String(error) },
			});
		});
	}, [embed.canonicalUrl, embed.provider, lightImpact, logFrontendEvent]);

	if (!isActive) return null;

	// 削除・非公開になった投稿（#1273 §39）。ブラウザで開いても provider の
	// «利用できません» 画面にしかならないので、開かせず文言で伝える（独立レビュー指摘）
	if (embed.embedStatus === "unavailable") {
		return (
			<View style={styles.overlayContainer} pointerEvents="none" testID="external-embed-unavailable">
				<Text style={styles.playLabel}>{i18n.t("DishMediaContent.errors.mediaUnavailable")}</Text>
			</View>
		);
	}

	const playButton = (
		<TouchableOpacity
			testID="external-embed-open-browser"
			style={styles.playButton}
			onPress={handleOpenExternally}
			accessibilityRole="button"
			accessibilityLabel={i18n.t("DishMediaContent.embed.play", {
				provider: source?.providerLabel ?? embed.provider,
			})}>
			<View style={styles.playCircle}>
				<Play size={30} color={FixedColors.onMedia} fill={FixedColors.onMedia} />
			</View>
			<Text style={styles.playLabel}>
				{i18n.t("DishMediaContent.embed.play", { provider: source?.providerLabel ?? embed.provider })}
			</Text>
		</TouchableOpacity>
	);

	return (
		<View style={styles.overlayContainer} pointerEvents="box-none" testID="external-embed-fallback">
			{blockParentTapGesture ? (
				<GestureDetector gesture={blockParentTapGesture}>
					{/* collapsable=false: GestureDetector が実ビューを要求する */}
					<View collapsable={false}>{playButton}</View>
				</GestureDetector>
			) : (
				playButton
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	overlayContainer: {
		...StyleSheet.absoluteFillObject,
		justifyContent: "center",
		alignItems: "center",
	},
	playButton: {
		alignItems: "center",
		gap: 10,
	},
	playCircle: {
		width: 72,
		height: 72,
		borderRadius: 36,
		backgroundColor: "rgba(0,0,0,0.55)",
		borderWidth: 2,
		borderColor: "rgba(255,255,255,0.9)",
		justifyContent: "center",
		alignItems: "center",
		// 再生アイコンは光学的に僅かに右へ寄せると中心に見える
		paddingLeft: 4,
	},
	playLabel: {
		fontSize: 13,
		fontWeight: "700",
		color: FixedColors.onMedia,
		textShadowColor: "rgba(0,0,0,0.6)",
		textShadowRadius: 6,
	},
});
