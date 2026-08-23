/*
#1375 外部埋め込み再生（ネイティブ・WebView 入りビルド用ブランチ）。

## このブランチの位置づけ

`react-native-webview` はネイティブモジュールで、追加には EAS Build（オーナー承認制）が
要る。CLAUDE.md の取り決めどおり、**ネイティブ差分はこのブランチに隔離**し、
検証は Detox（e2e-mobile CI はブランチのソースからネイティブごとビルドする）と
Playwright の録画で行う。OTA 側ブランチの実装は «再生ボタン → アプリ内ブラウザ» のみ。

## UX（オーナー合意: 既存 dish_media に可能な限り寄せる。2026-08-23 チャット）

- **YouTube / TikTok**: 埋め込みが無音自動再生する（embedUrl に autoplay+mute。
  ブラウザ/WebView は無音でないと自動再生を許可しない）。着地した瞬間から動く。
  タッチは既定で渡さない（縦フリックのフィード送りを守る）。中央ボタンのタップで
  操作モードへ入り、埋め込み側のコントロール（音量など）を直接触れる
- **Instagram**: 規約と技術の制約で mp4 が取得できず自動再生も不可（実測: embed SSR に
  mp4 は無い）。フィード内に実埋め込みカードを表示し、中央の再生ボタンで操作モードへ
  入る＋埋め込み中央へ合成クリックを注入してその場で再生を試みる（音あり・Instagram UI 内）

タッチを既定で渡さない（pointerEvents="none"）のは独立レビューの構造対策:
Android の WebView は縦ドラッグを自分で消費する（scrollEnabled は iOS 専用）ため、
渡すとフィード送りが死ぬ。操作モードはユーザーが自分で選んだときだけ。

- WebView が居ないビルド（現行 1.14 に OTA だけ届いた場合）は
  «再生ボタン → アプリ内ブラウザ» へ縮退する（OTA ブランチと同じ挙動）

## WebView 存在判定

require の成否だけでは足りない（JS 側は解決できてもネイティブ側が無いと描画時に落ちる）
ので、`UIManager` のビューマネージャ登録も確認する。module スコープで 1 回だけ実行して
例外を無言で握ると «一度こけたらセッション中ずっとフォールバック、しかも観測できない»
になる（独立レビュー指摘）ため、遅延評価にし、正常な結果だけキャッシュし、
例外は logFrontendEvent へ残して次のレンダで再判定する。
*/
import React, { useCallback, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, UIManager, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { GestureDetector, type GestureType } from "react-native-gesture-handler";
import { Play } from "lucide-react-native";

import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import type { DishMediaExternalEmbed } from "@shared/api/v1/res";
import { buildExternalEmbedPlayerSource, isAllowedEmbedNavigation, isEmbedEscapeUrl } from "../embedUrl";

type WebViewComponent = React.ComponentType<Record<string, unknown>>;
type ProbeResult = { WebView: WebViewComponent | null; error: string | null };

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
	 * WebView をフィードの全セルに立てない（メモリと帯域のため）
	 */
	isActive: boolean;
	/**
	 * #694 と同じ仕組み。親（DishMediaContent）の tapGesture はこの gesture の失敗を
	 * 待つので、再生ボタンのタップで ActionSheet が同時に開かない
	 */
	blockParentTapGesture?: GestureType;
};

export function ExternalEmbedPlayer({ embed, isActive, blockParentTapGesture }: ExternalEmbedPlayerProps) {
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const [interactive, setInteractive] = useState(false);

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

	// WebView 不在ビルド用: アプリ内ブラウザで開く（閉じればフィードへそのまま戻る）
	const handleOpenExternally = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "external_embed_open_browser",
			error_level: "log",
			payload: { provider: embed.provider },
		});
		WebBrowser.openBrowserAsync(embed.canonicalUrl).catch((error) => {
			logFrontendEvent({
				event_name: "external_embed_open_browser_failed",
				error_level: "error",
				payload: { provider: embed.provider, error: error instanceof Error ? error.message : String(error) },
			});
		});
	}, [embed.canonicalUrl, embed.provider, lightImpact, logFrontendEvent]);

	// WebView 在りビルド用: 操作モードへ入る（以降のタップは埋め込み側の再生 UI が受ける。
	// 合成クリックの注入は行わない: 中央は「Instagramで見る」リンクで、クリックすると
	// フルサイトへ遷移してしまう。Detox 実機でアプリのプロセスごと落ちるのを観測した）
	const handleActivate = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "external_embed_interactive",
			error_level: "log",
			payload: { provider: embed.provider },
		});
		setInteractive(true);
	}, [embed.provider, lightImpact, logFrontendEvent]);

	if (!isActive) return null;

	// 削除・非公開になった投稿（#1273 §39）。埋め込み/ブラウザどちらも provider の
	// «利用できません» 画面にしかならないので、開かせず文言で伝える
	if (embed.embedStatus === "unavailable") {
		return (
			<View style={styles.overlayContainer} pointerEvents="none" testID="external-embed-unavailable">
				<Text style={styles.playLabel}>{i18n.t("DishMediaContent.errors.mediaUnavailable")}</Text>
			</View>
		);
	}

	const inlineAvailable = source !== null && NativeWebView !== null;
	const playButton = (
		<TouchableOpacity
			testID="external-embed-open-browser"
			style={styles.playButton}
			onPress={inlineAvailable ? handleActivate : handleOpenExternally}
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
			{inlineAvailable && NativeWebView !== null && source !== null && (
				<View
					style={StyleSheet.absoluteFill}
					pointerEvents={interactive ? "auto" : "none"}
					testID="external-embed-webview">
					<NativeWebView
						source={{ uri: source.embedUrl }}
						style={styles.webView}
						allowsInlineMediaPlayback
						mediaPlaybackRequiresUserAction={false}
						// 埋め込み内部のナビゲーション（サブフレーム・302）は打ち切らない。
						// アプリ起動スキームは遮断し、「Instagramで見る」等の本体サイトへの脱出は
						// フィードのセル内で開かずアプリ内ブラウザへ逃がす。判定の理由は embedUrl.ts
						onShouldStartLoadWithRequest={(request: { url: string }) => {
							if (!isAllowedEmbedNavigation(request.url)) return false;
							if (isEmbedEscapeUrl(request.url)) {
								WebBrowser.openBrowserAsync(request.url).catch(() => {});
								return false;
							}
							return true;
						}}
					/>
				</View>
			)}
			{!interactive && (
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
			)}
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
