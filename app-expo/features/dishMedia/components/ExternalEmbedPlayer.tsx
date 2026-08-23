/*
#1375 4 巡目実機確認: 取り込んだ SNS 投稿（render_type='external_embed'）の再生。

## 実機報告「保存後にリールが再生されない」の真因

サーバは externalEmbed（provider / canonicalUrl / サムネイル）を返しているのに、
**それを描く provider 別コンポーネントがアプリに存在しなかった**。設計コメント
（#1273 §14 / #1399「表示は canonicalUrl から provider 別コンポーネントが行う」）が
実装されないまま取り込み機能だけが先行していた。ここがその実装である。

## 設計: «埋め込みは表示専用、操作は再生ボタンに集約»（独立レビュー反映）

`react-native-webview` は 1.14 ビルドに**入っていない**（ネイティブモジュールの追加は
EAS Build が必要で、ビルドはオーナー承認制）。OTA だけで再生を成立させるため:

- ネイティブモジュールが存在する（将来のビルド）→ WebView で埋め込みを**表示だけ**する
- 存在しない（現行 1.14）→ 親のサムネイルがそのまま見えている

どちらの場合も中央に再生ボタンを重ね、タップでアプリ内ブラウザ
（expo-web-browser。SFSafariViewController / Custom Tabs）を開いてそこで再生する。

WebView へタッチを渡さない（pointerEvents="none"）のは独立レビューの 3 指摘への
構造的な対策である:
- `scrollEnabled={false}` は iOS 専用プロップで、Android では WebView が縦フリック
  （次の投稿へ送る操作）を食ってしまう
- Instagram / YouTube の埋め込みはそもそも自動再生せず、タップ操作を許しても
  「もう 1 回押す」体験は消えない
- タッチを渡すと埋め込み内の広告・外部リンクの制御が provider の DOM 依存になる

存在判定は require の成否だけでは足りない（JS 側は解決できてもネイティブ側が無いと
描画時に落ちる）ので、`UIManager` のビューマネージャ登録も確認する。

web 版は `ExternalEmbedPlayer.web.tsx`（iframe）が Metro に選ばれる。
`react-native-webview` を web バンドルへ入れないための分割である。
*/
import React, { useCallback } from "react";
import { StyleSheet, Text, TouchableOpacity, UIManager, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { GestureDetector, type GestureType } from "react-native-gesture-handler";
import { Play } from "lucide-react-native";

import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import type { DishMediaExternalEmbed } from "@shared/api/v1/res";
import { buildExternalEmbedPlayerSource, isAllowedEmbedNavigation } from "../embedUrl";

type WebViewComponent = React.ComponentType<Record<string, unknown>>;
type ProbeResult = { WebView: WebViewComponent | null; error: string | null };

/*
WebView のネイティブ実装が現在のビルドに入っているかの判定。

- require が失敗する（依存に無い / web）→ 使えない
- require は通るがビューマネージャ RNCWebView が未登録（JS だけ OTA で届いた）→ 使えない

独立レビュー指摘: module スコープで 1 回だけ実行して例外を無言で握ると
«一度こけたらセッション中ずっとフォールバック、しかも観測できない» になる。
遅延評価にし、正常な結果（在る / 無い）だけをキャッシュして、例外は呼び出し側で
ログに残す（例外時はキャッシュせず次のレンダで再判定する）。
*/
let cachedProbe: ProbeResult | undefined;
const probeNativeWebView = (): ProbeResult => {
	if (cachedProbe) return cachedProbe;
	try {
		const uiManager = UIManager as unknown as {
			hasViewManagerConfig?: (name: string) => boolean;
			getViewManagerConfig?: (name: string) => unknown;
		};
		const hasNative =
			uiManager.hasViewManagerConfig?.("RNCWebView") ?? uiManager.getViewManagerConfig?.("RNCWebView") != null;
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		cachedProbe = {
			WebView: hasNative ? (require("react-native-webview").WebView as WebViewComponent) : null,
			error: null,
		};
		return cachedProbe;
	} catch (error) {
		return { WebView: null, error: error instanceof Error ? error.message : String(error) };
	}
};
let probeErrorLogged = false;

export type ExternalEmbedPlayerProps = {
	embed: Pick<DishMediaExternalEmbed, "provider" | "externalContentId" | "canonicalUrl" | "embedStatus">;
	/**
	 * 前面のページだけ true。false の間は何も描かない（親のサムネイルが見えている）。
	 * WebView / iframe をフィードの全セルに立てない（メモリと帯域のため）
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
	const probe = probeNativeWebView();
	if (probe.error && !probeErrorLogged) {
		probeErrorLogged = true;
		logFrontendEvent({
			event_name: "external_embed_webview_probe_failed",
			error_level: "warn",
			payload: { provider: embed.provider, error: probe.error },
		});
	}
	const NativeWebView = probe.WebView;

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
	}, [embed.canonicalUrl, embed.provider, lightImpact, logFrontendEvent, NativeWebView]);

	if (!isActive) return null;

	// 削除・非公開になった投稿（#1273 §39）。埋め込み/ブラウザどちらも provider の
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
				<Play size={30} color="#FFFFFF" fill="#FFFFFF" />
			</View>
			<Text style={styles.playLabel}>
				{i18n.t("DishMediaContent.embed.play", { provider: source?.providerLabel ?? embed.provider })}
			</Text>
		</TouchableOpacity>
	);

	return (
		<>
			{/* WebView が居るビルドでは埋め込みの実カードを «表示だけ» する（タッチは渡さない） */}
			{source !== null && NativeWebView !== null && (
				<View style={StyleSheet.absoluteFill} pointerEvents="none" testID="external-embed-webview">
					<NativeWebView
						source={{ uri: source.embedUrl }}
						style={styles.webView}
						allowsInlineMediaPlayback
						// 表示専用なのでナビゲーションは埋め込み内部の動作のみ。判定の理由は embedUrl.ts
						onShouldStartLoadWithRequest={(request: { url: string }) => isAllowedEmbedNavigation(request.url)}
					/>
				</View>
			)}
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
		</>
	);
}

const styles = StyleSheet.create({
	webView: {
		...StyleSheet.absoluteFillObject,
		backgroundColor: "#000",
	},
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
		color: "#FFFFFF",
		textShadowColor: "rgba(0,0,0,0.6)",
		textShadowRadius: 6,
	},
});
