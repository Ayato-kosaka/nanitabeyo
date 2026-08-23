/*
#1375 4 巡目実機確認: 取り込んだ SNS 投稿（render_type='external_embed'）の再生。

## 実機報告「保存後にリールが再生されない」の真因

サーバは externalEmbed（provider / canonicalUrl / サムネイル）を返しているのに、
**それを描く provider 別コンポーネントがアプリに存在しなかった**。設計コメント
（#1273 §14 / #1399「表示は canonicalUrl から provider 別コンポーネントが行う」）が
実装されないまま取り込み機能だけが先行していた。ここがその実装である。

## ネイティブは «WebView が居れば inline、居なければアプリ内ブラウザ» の二段構え

`react-native-webview` は 1.14 ビルドに**入っていない**（ネイティブモジュールの追加は
EAS Build が必要で、ビルドはオーナー承認制）。OTA だけで再生を成立させるため:

- ネイティブモジュールが存在する（将来のビルド）→ WebView で inline 埋め込み
- 存在しない（現行 1.14）→ サムネイルの上に再生ボタンを重ね、タップで
  アプリ内ブラウザ（expo-web-browser。SFSafariViewController / Custom Tabs）で開く。
  リールはそこで再生される

存在判定は require の成否だけでは足りない（JS 側は解決できてもネイティブ側が無いと
描画時に落ちる）ので、`UIManager` のビューマネージャ登録も確認する。

web 版は `ExternalEmbedPlayer.web.tsx`（iframe）が Metro に選ばれる。
`react-native-webview` を web バンドルへ入れないための分割である。
*/
import React, { useCallback } from "react";
import { StyleSheet, Text, TouchableOpacity, UIManager, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { Play } from "lucide-react-native";

import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import type { DishMediaExternalEmbed } from "@shared/api/v1/res";
import { buildExternalEmbedPlayerSource } from "../embedUrl";

/**
 * WebView のネイティブ実装が現在のビルドに入っているかを 1 度だけ判定する。
 *
 * - require が失敗する（依存に無い / web）→ 使えない
 * - require は通るがビューマネージャ RNCWebView が未登録（JS だけ OTA で届いた）→ 使えない
 */
const resolveNativeWebView = (): React.ComponentType<Record<string, unknown>> | null => {
	try {
		const uiManager = UIManager as unknown as {
			hasViewManagerConfig?: (name: string) => boolean;
			getViewManagerConfig?: (name: string) => unknown;
		};
		const hasNative =
			uiManager.hasViewManagerConfig?.("RNCWebView") ?? uiManager.getViewManagerConfig?.("RNCWebView") != null;
		if (!hasNative) return null;
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		return require("react-native-webview").WebView as React.ComponentType<Record<string, unknown>>;
	} catch {
		return null;
	}
};
const NativeWebView = resolveNativeWebView();

export type ExternalEmbedPlayerProps = {
	embed: Pick<DishMediaExternalEmbed, "provider" | "externalContentId" | "canonicalUrl">;
	/**
	 * 前面のページだけ true。false の間は何も描かない（親のサムネイルが見えている）。
	 * WebView / iframe をフィードの全セルに立てない（メモリと帯域のため）
	 */
	isActive: boolean;
};

export function ExternalEmbedPlayer({ embed, isActive }: ExternalEmbedPlayerProps) {
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();

	const source = buildExternalEmbedPlayerSource(embed.provider, embed.externalContentId);

	const handleOpenExternally = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "external_embed_open_browser",
			error_level: "log",
			payload: { provider: embed.provider, inlineWebViewAvailable: NativeWebView !== null },
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

	// 埋め込み URL を組めない provider / WebView 不在ビルド → 再生ボタン（アプリ内ブラウザ）
	if (source === null || NativeWebView === null) {
		return (
			<View style={styles.fallbackContainer} pointerEvents="box-none" testID="external-embed-fallback">
				<TouchableOpacity
					testID="external-embed-open-browser"
					style={styles.playButton}
					onPress={handleOpenExternally}
					accessibilityRole="button"
					accessibilityLabel={i18n.t("DishMediaContent.embed.play", {
						provider: source?.providerLabel ?? embed.provider,
					})}>
					<View style={styles.playCircle}>
						<Play size={30} color="#FFFFFF" fill="#FFFFFF" />
					</View>
					<Text style={styles.playLabel}>
						{i18n.t("DishMediaContent.embed.play", { provider: source?.providerLabel ?? embed.provider })}
					</Text>
				</TouchableOpacity>
			</View>
		);
	}

	return (
		<View style={StyleSheet.absoluteFill} testID="external-embed-webview">
			<NativeWebView
				source={{ uri: source.embedUrl }}
				style={styles.webView}
				// 埋め込み側のスクロールは殺す。縦フリック（次の記録へ）を奪わせない
				scrollEnabled={false}
				allowsInlineMediaPlayback
				mediaPlaybackRequiresUserAction={false}
				// 埋め込みページからの外部遷移はアプリ内ブラウザへ逃がす（フィードを乗っ取らせない）
				onShouldStartLoadWithRequest={(request: { url: string }) => {
					if (request.url === source.embedUrl || request.url.startsWith("about:")) return true;
					WebBrowser.openBrowserAsync(request.url).catch(() => {});
					return false;
				}}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	webView: {
		...StyleSheet.absoluteFillObject,
		backgroundColor: "#000",
	},
	fallbackContainer: {
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
		color: "#FFFFFF",
		textShadowColor: "rgba(0,0,0,0.6)",
		textShadowRadius: 6,
	},
});
