/*
#1375 外部埋め込み再生（ネイティブ・WebView 入りビルド用ブランチ）。

## このブランチの位置づけ

`react-native-webview` はネイティブモジュールで、追加には EAS Build（オーナー承認制）が
要る。CLAUDE.md の取り決めどおり、**ネイティブ差分はこのブランチに隔離**し、
検証は Detox（e2e-mobile CI はブランチのソースからネイティブごとビルドする）と
Playwright の録画で行う。OTA 側ブランチの実装は «再生ボタン → アプリ内ブラウザ» のみ。

## UX

- 既定は **表示専用**（`pointerEvents="none"`）。Android の WebView は縦ドラッグを
  自分で消費する（`scrollEnabled` は iOS 専用プロップ）ため、渡すとフィード送りが死ぬ
- 中央の再生ボタンで **操作モード**へ入り、埋め込み側の再生 UI を直接触れる。
  操作モードは «閉じる» ボタンで抜けられる（抜けられないと、WebView が縦フリックを
  食っている間そのセルから戻れなくなる。独立レビュー指摘）
- WebView が居ないビルド（現行 1.14 に OTA だけ届いた場合）は
  «再生ボタン → アプリ内ブラウザ» へ縮退する

## 埋め込みからフルサイトへ «脱出» させない（実機クラッシュの真因だった）

run 32654704176 で、埋め込み中央の「Instagramで見る」を踏んだ直後にアプリの
プロセスごと落ちた。独立レビューで経路が 2 つあることが判明している。

1. **Android の `target=_blank`**: `setSupportMultipleWindows` の既定 true では
   `onCreateWindow` が **画面外に新しい WebView を生成して**フルサイトを読み、
   `onShouldStartLoadWithRequest` を一切通らない（＝ URL ガードが効かない）。
   不可視のまま常駐するので積み上がると OOM で殺される。
   → `setSupportMultipleWindows={false}` で `shouldOverrideUrlLoading` 経路へ落とし、
     `onOpenWindow` でも取りこぼしをアプリ内ブラウザへ逃がす（二重防御）
2. **トップフレームの遷移**: 許可リスト（embedUrl.ts の `isInlineEmbedUrl`）に
   一致しない URL はアプリ内ブラウザで開き、WebView には読ませない

⚠️ Android の `shouldOverrideUrlLoading` は JS の応答が間に合わないと
**fail-open（読み込みを許可）する**（RNCWebViewClient.java）。ガード «だけ» に
頼らない構成にしてあるのはそのためである。

## 音とメモリ

`isActive`（前面のセル）に加えて **画面フォーカスとアプリ状態**を掛け、
裏へ回ったらアンマウントする。Android の RNCWebView は `onHostPause` で何もしない
＝ 音が鳴り続けるため、既存 `VideoPlayer`（shouldPlayInBackground: false）と
挙動を揃えるにはアンマウントが要る。
*/
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus, StyleSheet, Text, TouchableOpacity, UIManager, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import * as WebBrowser from "expo-web-browser";
import { GestureDetector, type GestureType } from "react-native-gesture-handler";
import { Play, X } from "lucide-react-native";

import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import type { DishMediaExternalEmbed } from "@shared/api/v1/res";
import { buildExternalEmbedPlayerSource, isAllowedEmbedNavigation, isInlineEmbedUrl } from "../embedUrl";

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

export type ExternalEmbedPlayerProps = {
	embed: Pick<DishMediaExternalEmbed, "provider" | "externalContentId" | "canonicalUrl" | "embedStatus">;
	/**
	 * 前面のページだけ true。false の間は何も描かない（親のサムネイルが見えている）。
	 * WebView をフィードの全セルに立てない（メモリと帯域のため）
	 */
	isActive: boolean;
	/**
	 * #694 と同じ仕組み。親（DishMediaContent）の tapGesture はこの gesture の失敗を
	 * 待つので、埋め込みへのタップで ActionSheet が同時に開かない
	 */
	blockParentTapGesture?: GestureType;
};

export function ExternalEmbedPlayer({ embed, isActive, blockParentTapGesture }: ExternalEmbedPlayerProps) {
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const [interactive, setInteractive] = useState(false);
	// WebView のレンダラが system に殺されたとき、黒いセルのまま放置しないための印
	const [renderProcessGone, setRenderProcessGone] = useState(false);
	const isFocused = useIsFocused();
	// jest やテスト環境では currentState が "unknown" になり得る。
	// «明示的に裏へ回っているか» で判定し、判らないときは前面扱いにする
	const isForeground = (state: AppStateStatus | null | undefined) => state !== "background" && state !== "inactive";
	const [appActive, setAppActive] = useState(() => isForeground(AppState.currentState));
	const probeRef = useRef(probeNativeWebView());

	useEffect(() => {
		const subscription = AppState.addEventListener("change", (next: AppStateStatus) => {
			setAppActive(next !== "background" && next !== "inactive");
		});
		return () => subscription.remove();
	}, []);

	// 判定に失敗したときだけ 1 度ログを残す（render 中に副作用を持たない）
	useEffect(() => {
		if (!probeRef.current.error) return;
		logFrontendEvent({
			event_name: "external_embed_webview_probe_failed",
			error_level: "warn",
			payload: { provider: embed.provider, error: probeRef.current.error },
		});
	}, [embed.provider, logFrontendEvent]);

	// セルが前面から外れたら操作モードも畳む（次に来たとき表示専用から始める）
	useEffect(() => {
		if (!isActive) {
			setInteractive(false);
			setRenderProcessGone(false);
		}
	}, [isActive]);

	const source = buildExternalEmbedPlayerSource(embed.provider, embed.externalContentId);
	const NativeWebView = probeRef.current.WebView;

	const openInAppBrowser = useCallback(
		(url: string, reason: string) => {
			logFrontendEvent({
				event_name: "external_embed_open_browser",
				error_level: "log",
				payload: { provider: embed.provider, reason, inlineWebViewAvailable: NativeWebView !== null },
			});
			WebBrowser.openBrowserAsync(url).catch((error) => {
				logFrontendEvent({
					event_name: "external_embed_open_browser_failed",
					error_level: "error",
					payload: { provider: embed.provider, error: error instanceof Error ? error.message : String(error) },
				});
			});
		},
		[embed.provider, logFrontendEvent, NativeWebView],
	);

	// WebView 不在ビルド用: 投稿そのものをアプリ内ブラウザで開く
	const handleOpenExternally = useCallback(() => {
		lightImpact();
		openInAppBrowser(embed.canonicalUrl, "fallback_play_button");
	}, [embed.canonicalUrl, lightImpact, openInAppBrowser]);

	// WebView 在りビルド用: 操作モードへ入る（以降のタップは埋め込み側の再生 UI が受ける）
	const handleActivate = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "external_embed_interactive",
			error_level: "log",
			payload: { provider: embed.provider },
		});
		setInteractive(true);
	}, [embed.provider, lightImpact, logFrontendEvent]);

	const handleExitInteractive = useCallback(() => {
		lightImpact();
		setInteractive(false);
	}, [lightImpact]);

	/**
	 * トップフレームの遷移だけを判定する。
	 *
	 * - サブフレーム（広告 iframe 等）は素通し。iOS は `isTopFrame` を載せてくるが
	 *   Android は常に true なので、`=== false` のときだけ «サブフレーム» と断定する
	 * - 埋め込みページの形（許可リスト）なら inline 継続
	 * - それ以外は **操作モードのときだけ**アプリ内ブラウザで開く。
	 *   眺めているだけのユーザーの前でブラウザが勝手に開かないようにする
	 *   （ログイン必須の投稿が 302 で /accounts/login へ飛ぶケースが実在する）
	 */
	const handleShouldStartLoad = useCallback(
		(request: { url: string; isTopFrame?: boolean; navigationType?: string }) => {
			if (!isAllowedEmbedNavigation(request.url)) return false;
			if (request.isTopFrame === false) return true;
			if (isInlineEmbedUrl(request.url) || request.url === source?.embedUrl) return true;
			if (interactive) openInAppBrowser(request.url, "escape_top_frame");
			return false;
		},
		[interactive, openInAppBrowser, source?.embedUrl],
	);

	// 画面が裏（別ルートへ push / アプリがバックグラウンド）なら描かない = 音もメモリも解放する
	if (!isActive || !isFocused || !appActive) return null;

	// 削除・非公開になった投稿（#1273 §39）
	if (embed.embedStatus === "unavailable") {
		return (
			<View style={styles.overlayContainer} pointerEvents="none" testID="external-embed-unavailable">
				<Text style={styles.playLabel}>{i18n.t("DishMediaContent.errors.mediaUnavailable")}</Text>
			</View>
		);
	}

	const inlineAvailable = source !== null && NativeWebView !== null && !renderProcessGone;
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
						// Android: target=_blank で «画面外の新しい WebView» を作らせない（ヘッダ参照）
						setSupportMultipleWindows={false}
						onOpenWindow={(event: { nativeEvent: { targetUrl: string } }) =>
							openInAppBrowser(event.nativeEvent.targetUrl, "open_window")
						}
						onShouldStartLoadWithRequest={handleShouldStartLoad}
						// レンダラが殺されたら黒いセルで放置せず、再生ボタン（ブラウザ縮退）へ戻す
						onRenderProcessGone={() => {
							logFrontendEvent({
								event_name: "external_embed_render_process_gone",
								error_level: "warn",
								payload: { provider: embed.provider, platform: "android" },
							});
							setRenderProcessGone(true);
							setInteractive(false);
						}}
						onContentProcessDidTerminate={() => {
							logFrontendEvent({
								event_name: "external_embed_render_process_gone",
								error_level: "warn",
								payload: { provider: embed.provider, platform: "ios" },
							});
							setRenderProcessGone(true);
							setInteractive(false);
						}}
					/>
				</View>
			)}
			{interactive ? (
				// 操作モードを抜ける口。これが無いと、WebView が縦フリックを食っている間
				// そのセルから戻れなくなる（独立レビュー指摘）
				<View style={styles.exitContainer} pointerEvents="box-none" testID="external-embed-interactive">
					{blockParentTapGesture ? (
						<GestureDetector gesture={blockParentTapGesture}>
							<View collapsable={false}>
								<ExitButton onPress={handleExitInteractive} />
							</View>
						</GestureDetector>
					) : (
						<ExitButton onPress={handleExitInteractive} />
					)}
				</View>
			) : (
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

function ExitButton({ onPress }: { onPress: () => void }) {
	return (
		<TouchableOpacity
			testID="external-embed-exit-interactive"
			style={styles.exitButton}
			onPress={onPress}
			accessibilityRole="button"
			accessibilityLabel={i18n.t("DishMediaContent.embed.exitInteractive")}>
			<X size={18} color="#FFFFFF" />
		</TouchableOpacity>
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
	// 操作モード中は中央を埋め込みへ明け渡し、抜ける口だけ左上に浮かせる
	exitContainer: {
		...StyleSheet.absoluteFillObject,
		alignItems: "flex-start",
		justifyContent: "flex-start",
		paddingTop: 12,
		paddingLeft: 12,
	},
	exitButton: {
		width: 36,
		height: 36,
		borderRadius: 18,
		backgroundColor: "rgba(0,0,0,0.55)",
		borderWidth: 1,
		borderColor: "rgba(255,255,255,0.8)",
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
