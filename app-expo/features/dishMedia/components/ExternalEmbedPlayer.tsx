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

`isActive`（前面のセル）に加えて **アプリ状態**（`AppState`）を掛け、バックグラウンドでは
アンマウントする。Android の RNCWebView は `onHostPause` で何もしない ＝ 音が鳴り続けるため、
既存 `VideoPlayer`（shouldPlayInBackground: false）と挙動を揃えるにはアンマウントが要る。

画面フォーカス（別ルートへ push されたか）は `isScreenFocused` prop で受け取る。
**このコンポーネント自身が `useIsFocused()` を呼ぶと、Portal 配下（ナビゲータ外）で
描かれた瞬間にフックが例外を投げてアプリごと落ちる**（Detox run 32658978146 で実測）。
*/
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	AppState,
	type AppStateStatus,
	StyleSheet,
	Text,
	TouchableOpacity,
	UIManager,
	View,
	type LayoutChangeEvent,
} from "react-native";
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
// #1509 メディア（サムネイル）の上に重ねる再生 UI のため、テーマ非追従の FixedColors を使う
import { FixedColors } from "@/constants/Palette";
// #1375（案 A）Instagram の埋め込みから «写真だけ» を切り出すための寸法計算
import { computeEmbedCropLayout } from "../embedCrop";

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
	/**
	 * 呼び出し元の画面がフォーカスを持っているか（別ルートへ push されていないか）。
	 *
	 * ⚠️ **ここで `useIsFocused()` を呼んではいけない。** このコンポーネントは
	 * ActionSheet などの Portal 配下（`Portal.Host` は `<Stack>` を包んでいる = ナビゲータの外）
	 * でも描かれるため、ナビゲーションコンテキストが無い経路があり、
	 * フックが例外を投げてアプリごと落ちる（Detox run 32658978146 で実測）。
	 * 判定はナビゲータ内にいる呼び出し元が行い、props で渡す。未指定なら «フォーカスあり» 扱い
	 */
	isScreenFocused?: boolean;
};

export function ExternalEmbedPlayer({
	embed,
	isActive,
	blockParentTapGesture,
	isScreenFocused,
}: ExternalEmbedPlayerProps) {
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const [interactive, setInteractive] = useState(false);
	// WebView のレンダラが system に殺されたとき、黒いセルのまま放置しないための印
	const [renderProcessGone, setRenderProcessGone] = useState(false);
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

	/*
	#1375（案 A）Instagram の埋め込みが連れてくるヘッダ・いいね欄・白帯を切り取り、
	写真だけをセル全面に敷く。計算の根拠は ../embedCrop.ts のヘッダを参照。

	⚠️ **この 3 つの hook を下の early return より後ろへ置いてはいけない。**
	`isActive` / `appActive` / `isScreenFocused` はフィードを送るたびに切り替わるので、
	early return を挟むと «同じコンポーネントが呼ぶ hook の本数» が描画のたびに変わり、
	React が `Rendered fewer hooks than expected` で落ちる（= フィードを送っただけで
	クラッシュする）。実際に条件付き hook の状態で入っていたのを、eslint の
	react-hooks/rules-of-hooks が検出した
	*/
	const [cell, setCell] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
	const handleLayout = useCallback((event: LayoutChangeEvent) => {
		const { width, height } = event.nativeEvent.layout;
		setCell((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
	}, []);
	const crop = useMemo(() => computeEmbedCropLayout(cell), [cell]);

	// 画面が裏（アプリがバックグラウンド / 呼び出し元がフォーカスを失った）なら描かない
	// = 音もメモリも解放する
	if (!isActive || !appActive || isScreenFocused === false) return null;

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
			{/*
			#1375（オーナー指摘）**丸い再生ボタンを 2 つ出さない。**

			切り取り後は Instagram 自身の再生ボタンが写真の中央＝セルの中央に来る。そこへ
			こちらの丸を重ねると同じ場所に再生ボタンが 2 つ見える（実機の動画で指摘された）。
			丸は Instagram のものに任せ、こちらはセル全面の透明なタップ受けと、
			下寄せの小さな帯だけにする。役割（1 タップで操作モードへ入る）は変わらない。

			⚠️ 下端ぴったりに置くとフィードの絞り込みチップの裏へ隠れる（web で実測）。
			*/}
			<View style={styles.playHint}>
				<Play size={12} color={FixedColors.onMedia} fill={FixedColors.onMedia} />
				<Text style={styles.playLabel}>
					{i18n.t("DishMediaContent.embed.play", { provider: source?.providerLabel ?? embed.provider })}
				</Text>
			</View>
		</TouchableOpacity>
	);

	return (
		<>
			{inlineAvailable && NativeWebView !== null && source !== null && (
				<View
					style={styles.cropFrame}
					onLayout={handleLayout}
					pointerEvents={interactive ? "auto" : "none"}
					testID="external-embed-webview">
					{/* セルの寸法が確定するまで WebView を作らない。中途半端な幅で読み込ませると、
					    Instagram がその幅でレイアウトしてしまい切り取り位置がずれたまま残る */}
					{/* 写真の箱。ここを拡大してセル全面へ広げる。
					    ⚠️ WebView 本体は **素の幅のまま**にすること。大きな寸法を渡すと
					    Android が描画面を確保できずセルが真っ黒になる（../embedCrop.ts のヘッダ） */}
					{crop !== null && (
						<View
							style={{
								width: crop.frameWidth,
								height: crop.mediaHeight,
								overflow: "hidden",
								transform: [{ scale: crop.scale }],
							}}>
							<NativeWebView
								source={{ uri: source.embedUrl }}
								style={[
									styles.webView,
									{
										width: crop.frameWidth,
										height: crop.frameHeight,
										left: 0,
										// ヘッダ帯ぶん上へずらして箱の外へ追い出す
										top: crop.frameTop,
									},
								]}
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
							{/* collapsable=false: GestureDetector が実ビューを要求する。
							    ⚠️ absoluteFill も必須。素の View（高さ 0）を挟むと、中の絶対配置が
							    そこを基準にしてしまい «▶ の小さい帯が画面の中途半端な位置に浮く»
							    （実機 Detox / run 32724564583 で実測。web でも同じ症状が出た） */}
							<View style={StyleSheet.absoluteFill} collapsable={false}>
								{playButton}
							</View>
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
			{/* 写真の上に載る × なのでテーマ非追従の固定色 */}
			<X size={18} color={FixedColors.onMedia} />
		</TouchableOpacity>
	);
}

const styles = StyleSheet.create({
	// #1375（案 A）はみ出した Instagram の UI をここで捨てる。
	// これが無いと切り取りが成立せず、セルの外へ白帯が出る
	cropFrame: {
		...StyleSheet.absoluteFillObject,
		overflow: "hidden",
		backgroundColor: FixedColors.mediaBackground,
		// 写真の箱を中央へ置く（拡大は箱の中心を軸に効くので、これで «cover» になる）
		alignItems: "center",
		justifyContent: "center",
	},
	// 位置と寸法は computeEmbedCropLayout が決めるので、ここでは絶対配置だけ宣言する
	webView: {
		position: "absolute",
		backgroundColor: FixedColors.mediaBackground,
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
	// #1375: セル全面が «1 タップで操作モードへ» の受け。中央には何も描かない
	// （中央には Instagram 自身の再生ボタンが来るため。同じ場所に丸を 2 つ出さない）
	playButton: {
		...StyleSheet.absoluteFillObject,
		justifyContent: "flex-end",
		alignItems: "center",
		paddingBottom: 124,
	},
	// «押せば動く» ことだけ伝える小さな帯。丸い再生ボタンの代わり
	playHint: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		paddingHorizontal: 12,
		paddingVertical: 6,
		borderRadius: 16,
		backgroundColor: "rgba(0,0,0,0.55)",
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: "rgba(255,255,255,0.5)",
	},
	playLabel: {
		fontSize: 12,
		fontWeight: "700",
		color: FixedColors.onMedia,
		textShadowColor: "rgba(0,0,0,0.6)",
		textShadowRadius: 6,
	},
});
