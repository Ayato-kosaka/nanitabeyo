/*
#1375 外部埋め込み再生（ネイティブ・WebView 入りビルド用ブランチ）。

## このブランチの位置づけ

`react-native-webview` はネイティブモジュールで、追加には EAS Build（オーナー承認制）が
要る。CLAUDE.md の取り決めどおり、**ネイティブ差分はこのブランチに隔離**し、
検証は Detox（e2e-mobile CI はブランチのソースからネイティブごとビルドする）と
Playwright の録画で行う。OTA 側ブランチの実装は «再生ボタン → アプリ内ブラウザ» のみ。

## UX（#1641 で «既存の動画セルと同じ» へ作り替えた）

**WebView は常に表示専用**（`pointerEvents="none"`）。タッチを一切渡さないので、
縦スワイプでのフィード送りもタップでの ActionSheet も、既存の `VideoPlayer` と
完全に同じ経路で処理される（Android の WebView は縦ドラッグを自分で消費する。
`scrollEnabled` は iOS 専用プロップなので渡しても効かない）。

再生は**こちらから起こす**。埋め込みページは `<video autoplay>` ではないので放っておいても
絶対に動かない（実測は下の «自動再生» の節）。`injectedJavaScript` で `play()` を呼ぶ。

- 再生できている間は、こちらの UI を**何も重ねない**（既存の動画セルと同じ見え方）
- 権利ブロックで `<video>` が存在しない投稿だけ «Instagram で見る» の帯を出す
- WebView が居ないビルド（現行 1.14 に OTA だけ届いた場合）も同じ帯へ縮退する

**«操作モード» と «× ボタン» は廃止した**（#1641）。WebView へタッチが届かなくなったので、
«埋め込みが縦フリックを食ってセルから戻れない» という問題自体が消えた。

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
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
import { NavigationContext } from "@react-navigation/native";
import { Play } from "lucide-react-native";

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

/*
#1641【設計】**タップ無しで自動再生する注入スクリプト。**

## なぜ «注入» が要るのか

埋め込みページ（`https://www.instagram.com/p/{code}/embed/`）の実測（Chrome 152 / WebKit）:

| | 値 |
| --- | --- |
| `<video>` | 権利ブロックされていない投稿には **1 個ある**（`src` に実 MP4） |
| `video.autoplay` | **false** |
| `paused` / `readyState` | **true / 0** — 明示的に読みに行くまでロードもしない |

つまり **埋め込みページは自分からは絶対に再生しない**。`allow="autoplay"` を渡しても、
`mediaPlaybackRequiresUserAction={false}` を付けても、ページが `play()` を呼ばないので何も起きない。
**こちらから `play()` を撃つ**必要がある。WebView の中は同一オリジンなので注入がそれを行える
（web の `<iframe>` は instagram.com がクロスオリジンなので、これができない ＝ web だけ自動再生できない）。

## ⚠️ この文字列を描画のたびに作り直してはいけない

iOS の `injectedJavaScript` は `WKUserScript`（DocumentEnd）として `userContentController` へ
登録される（`RNCWebViewImpl.m` の `setInjectedJavaScript:` / `resetupScripts:`）。
**差し替えても次のナビゲーションからしか効かない。** だからモジュールレベルの定数にする。

## ⚠️ iOS は `onMessage` が無いと、このスクリプトが登録すらされない

`RNCWebViewImpl.m` の `resetupScripts:` は `atEndScript`（= `injectedJavaScript`）を
`if(_messagingEnabled)` の中でしか `addUserScript` しない。そして `WebView.ios.tsx` は
`messagingEnabled={typeof onMessage === "function"}`。**`onMessage` を外すと
Android だけ動いて iOS だけ無言で動かない**、という最悪の切り分けになる。

## ⚠️ `<video>` はロード完了時点ではまだ無いことがある

埋め込みは JS でも描き直される。`onLoadEnd` で 1 回撃つだけでは取りこぼすので、
現れるまで再試行する（MutationObserver ＋ interval の併用。Observer だけだと
«要素はそのままで src だけ差し替え» を拾えない）。

## ⚠️ 例外を外へ漏らさない

全体を try で包み、`play()` の Promise には必ず reject ハンドラを付ける
（付けないと unhandled rejection になる）。
*/
const AUTOPLAY_SCRIPT = `(function () {
  var W = window;
  if (W.__nbEmbedAutoplay) { W.__nbEmbedAutoplay.kick(); return; }

  // 切り取り（embedCrop.ts）は幾何学的な位置合わせなので、ページ自身がフォーカス移動や
  // アンカーで縦にずれると崩れる。タッチは届かないが、向こうが勝手に動く経路は塞いでおく
  try { document.documentElement.style.overflow = 'hidden'; } catch (e) {}

  var DEADLINE_MS = 12000, TICK_MS = 250;
  var timer = null, deadlineAt = 0, inFlight = false, sent = {}, lastError = null;

  function report(kind, detail) {
    if (sent[kind]) return;
    sent[kind] = true;
    try {
      W.ReactNativeWebView.postMessage(JSON.stringify({
        src: 'nb-embed-autoplay', kind: kind, detail: detail == null ? null : String(detail)
      }));
    } catch (e) {}
  }
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

  function prepare(v) {
    // 属性とプロパティの両方を立てる（Instagram 側の JS が属性を見て作り直すことがある）
    v.loop = true; v.setAttribute('loop', '');
    v.playsInline = true;
    v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
    if (v.__nbBound) return;
    v.__nbBound = true;
    v.addEventListener('playing', function () { stopTimer(); report('playing', v.muted ? 'muted' : 'audible'); }, false);
    v.addEventListener('ended', function () { try { v.currentTime = 0; } catch (e) {} kick(); }, false);
  }

  function attempt() {
    try {
      var v = document.querySelector('video');
      if (Date.now() > deadlineAt) {
        stopTimer();
        // <video> が最後まで現れない = 権利ブロックされた投稿（何をしても再生できない）
        report(v ? 'timeout' : 'no_video', lastError);
        return;
      }
      if (!v) return;
      prepare(v);
      if (!v.paused && v.currentTime > 0) {
        // 'playing' の購読より前に再生が始まっていた場合、イベントを取り逃す。
        // 見た目は正しい（帯を出さない）が «何割が再生できたか» の計測が欠けるので、ここでも報告する
        stopTimer(); report('playing', v.muted ? 'muted' : 'audible'); return;
      }
      if (inFlight) return;  // 前の play() が解決する前に撃つと AbortError を量産する

      var p;
      try { p = v.play(); } catch (e) { lastError = e && e.name; return; }
      if (!p || typeof p.then !== 'function') return;
      inFlight = true;
      p.then(function () { inFlight = false; }, function (err) {
        inFlight = false;
        var name = (err && err.name) || 'UnknownError';
        lastError = name;
        if (name === 'NotSupportedError') {
          // src が空 / デコーダが無い。何度撃っても同じなので即あきらめる
          stopTimer();
          report('not_supported', v.currentSrc || v.src || '(empty)');
          return;
        }
        // NotAllowedError: 自動再生ポリシーで蹴られた。既存の動画セルは音ありだが、
        // 鳴らないよりミュートで動かす方が «同じ感覚» に近い。落として次の tick で再試行
        if (name === 'NotAllowedError') { v.muted = true; v.defaultMuted = true; v.setAttribute('muted', ''); }
      });
    } catch (e) {}
  }

  function kick() {
    deadlineAt = Date.now() + DEADLINE_MS;
    if (!timer) timer = setInterval(attempt, TICK_MS);
    attempt();
  }

  try {
    var mo = new MutationObserver(function () { kick(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}

  W.__nbEmbedAutoplay = { kick: kick };
  kick();
})(); true;`;

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
	 * ナビゲータの外（Portal 配下）で描かれるときの既定値。
	 *
	 * ナビゲータ内にいる場合は `useIsScreenFocusedSafely` が実際のフォーカスを見るので、
	 * この prop は使われない。未指定なら «フォーカスあり» 扱い。
	 */
	isScreenFocused?: boolean;
};

/**
 * この画面が前面か（別ルートへ push されていないか）を、**例外を投げずに**判定する。
 *
 * ⚠️ `useIsFocused()` は使えない。このコンポーネントは ActionSheet などの Portal 配下
 * （`Portal.Host` は `<Stack>` を包んでいる = ナビゲータの外）でも描かれるため、
 * ナビゲーションコンテキストが無い経路があり、フックが例外を投げてアプリごと落ちる
 * （Detox run 32658978146 で実測）。
 *
 * `NavigationContext` は**無ければ `undefined` を返すだけ**なので安全に読める。
 * hook の本数も常に固定になる（条件付き hook にならない）。
 *
 * #1641: 以前は `isScreenFocused` prop で呼び出し元から受け取る設計だったが、
 * **呼び出し元（`DishMediaContent`）が一度も渡していなかった**ため常に «フォーカスあり»
 * 扱いになり、別ルートへ push しても WebView が生き残って音が鳴り続けていた。
 * prop 経由だと «渡し忘れが無音で成立してしまう» ので、ここで自分で取る。
 */
function useIsScreenFocusedSafely(fallback: boolean): boolean {
	const navigation = useContext(NavigationContext);
	const [focused, setFocused] = useState(true);
	useEffect(() => {
		if (!navigation) return;
		setFocused(navigation.isFocused());
		const unsubscribeFocus = navigation.addListener("focus", () => setFocused(true));
		const unsubscribeBlur = navigation.addListener("blur", () => setFocused(false));
		return () => {
			unsubscribeFocus();
			unsubscribeBlur();
		};
	}, [navigation]);
	// ナビゲータの外（Portal 配下）では判定できない。呼び出し元の指定 → «前面» の順で倒す
	return navigation ? focused : fallback;
}

export function ExternalEmbedPlayer({
	embed,
	isActive,
	blockParentTapGesture,
	isScreenFocused,
}: ExternalEmbedPlayerProps) {
	const screenFocused = useIsScreenFocusedSafely(isScreenFocused !== false);
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
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

	// セルが前面から外れたら «再生できたか» の判定もやり直す（次に来たとき最初から測る）
	useEffect(() => {
		if (!isActive) {
			setRenderProcessGone(false);
			setPlayback("unknown");
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

	/**
	 * 埋め込みの中で実際に何が起きたか。**推測しない。**
	 * ページ内のエージェントが「本当に `currentTime` が進んだ」と言ったときだけ `playing` になる。
	 */
	const [playback, setPlayback] = useState<"unknown" | "playing" | "unplayable">("unknown");
	const webViewRef = useRef<{ injectJavaScript: (script: string) => void } | null>(null);

	const handleMessage = useCallback(
		(event: { nativeEvent: { data: string } }) => {
			let parsed: { src?: string; kind?: string; detail?: string | null } = {};
			try {
				parsed = JSON.parse(event.nativeEvent.data);
			} catch {
				return; // 埋め込み側が勝手に postMessage してくる分は捨てる
			}
			if (parsed.src !== "nb-embed-autoplay") return;
			if (parsed.kind === "playing") {
				setPlayback("playing");
				logFrontendEvent({
					event_name: "external_embed_autoplay_started",
					error_level: "log",
					payload: { provider: embed.provider, audio: parsed.detail ?? null },
				});
				return;
			}
			// no_video（権利ブロック）/ not_supported（デコーダ無し）/ timeout
			setPlayback("unplayable");
			logFrontendEvent({
				event_name: "external_embed_unplayable",
				error_level: "warn",
				payload: { provider: embed.provider, kind: parsed.kind ?? null, detail: parsed.detail ?? null },
			});
		},
		[embed.provider, logFrontendEvent],
	);

	// WebView 不在ビルド用: 投稿そのものをアプリ内ブラウザで開く
	const handleOpenExternally = useCallback(() => {
		lightImpact();
		openInAppBrowser(embed.canonicalUrl, "fallback_play_button");
	}, [embed.canonicalUrl, lightImpact, openInAppBrowser]);

	/**
	 * トップフレームの遷移だけを判定する。
	 *
	 * - サブフレーム（広告 iframe 等）は素通し。iOS は `isTopFrame` を載せてくるが
	 *   Android は常に true なので、`=== false` のときだけ «サブフレーム» と断定する
	 * - 埋め込みページの形（許可リスト）なら inline 継続
	 * - それ以外は **黙って止める**。#1641 で操作モードを廃止したので WebView へは
	 *   タッチが一切届かず、トップフレームの遷移はページ側の勝手な動きしかありえない。
	 *   眺めているだけのユーザーの前でブラウザが勝手に開かないようにする
	 *   （ログイン必須の投稿が 302 で /accounts/login へ飛ぶケースが実在する）
	 */
	const handleShouldStartLoad = useCallback(
		(request: { url: string; isTopFrame?: boolean; navigationType?: string }) => {
			if (!isAllowedEmbedNavigation(request.url)) return false;
			if (request.isTopFrame === false) return true;
			if (isInlineEmbedUrl(request.url) || request.url === source?.embedUrl) return true;
			return false;
		},
		[source?.embedUrl],
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
	if (!isActive || !appActive || !screenFocused) return null;

	// 削除・非公開になった投稿（#1273 §39）
	if (embed.embedStatus === "unavailable") {
		return (
			<View style={styles.overlayContainer} pointerEvents="none" testID="external-embed-unavailable">
				<Text style={styles.playLabel}>{i18n.t("DishMediaContent.errors.mediaUnavailable")}</Text>
			</View>
		);
	}

	const inlineAvailable = source !== null && NativeWebView !== null && !renderProcessGone;
	/*
	#1641【設計】**再生できているセルには、こちらの UI を何も出さない。**

	既存の動画セル（`VideoPlayer`）は自動再生するだけで、上に «▶ 再生» の帯を出していない。
	同じ感覚にするため、埋め込みも自動再生が始まったら何も重ねない。

	帯を出すのは次の 2 つだけ:
	- WebView が居ないビルド（OTA だけ届いた 1.14 など）→ タップでアプリ内ブラウザ
	- ページ内エージェントが «この投稿には `<video>` が無い» と報告した
	  （= 権利ブロック。#1641 の実測どおり、何をしても再生できない）→ タップで Instagram
	*/
	const showFallbackCta = !inlineAvailable || playback === "unplayable";
	const playButton = (
		<TouchableOpacity
			testID="external-embed-open-browser"
			style={styles.playButton}
			onPress={handleOpenExternally}
			accessibilityRole="button"
			accessibilityLabel={i18n.t("DishMediaContent.embed.openExternally", {
				provider: source?.providerLabel ?? embed.provider,
			})}>
			{/*
			#1375（オーナー指摘）**丸い再生ボタンを 2 つ出さない。**

			切り取り後は Instagram 自身の再生ボタンが写真の中央＝セルの中央に来る。そこへ
			こちらの丸を重ねると同じ場所に再生ボタンが 2 つ見える（実機の動画で指摘された）。
			丸は Instagram のものに任せ、こちらはセル全面の透明なタップ受けと、
			下寄せの小さな帯だけにする。役割は «この投稿は Instagram でしか見られない» の導線。

			⚠️ 下端ぴったりに置くとフィードの絞り込みチップの裏へ隠れる（web で実測）。
			*/}
			<View style={styles.playHint}>
				<Play size={12} color={FixedColors.onMedia} fill={FixedColors.onMedia} />
				<Text style={styles.playLabel}>
					{/* #1641 «再生» ではなく «見る»。この帯が出るのは、アプリ内では再生できない
					    投稿（権利ブロック）と WebView 不在ビルドだけで、押すと Instagram が開く。
					    «再生» のままだと文言が嘘になる */}
					{i18n.t("DishMediaContent.embed.openExternally", {
						provider: source?.providerLabel ?? embed.provider,
					})}
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
					/* #1641 **常に表示専用**。タッチを一切渡さないので、縦スワイプでのフィード送りも
					   タップでの ActionSheet も、既存の動画セルと完全に同じ経路で処理される
					   （Android の RNCWebView は縦ドラッグを自分で消費するため、渡すと送りが死ぬ） */
					pointerEvents="none"
					testID="external-embed-webview">
					{/* セルの寸法が確定するまで WebView を作らない。中途半端な幅で読み込ませると、
					    Instagram がその幅でレイアウトしてしまい切り取り位置がずれたまま残る */}
					{/* 写真の箱。**等倍で中央へ置く**（拡大しない。理由は ../embedCrop.ts のヘッダ）。
					    ⚠️ WebView 本体は **素の幅のまま**にすること。大きな寸法を渡すと
					    Android が描画面を確保できずセルが真っ黒になる（../embedCrop.ts のヘッダ） */}
					{crop !== null && (
						<View
							style={{
								width: crop.frameWidth,
								height: crop.mediaHeight,
								overflow: "hidden",
							}}>
							<NativeWebView
								ref={webViewRef}
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
								// 表示専用なので、ユーザーの意図なく PiP へ持って行かれる余地を潰す
								allowsPictureInPictureMediaPlayback={false}
								/* #1641 ページ読み込みごとに自動再生エージェントを仕込む。
								   `<video>` が現れるまで再試行し、結果を postMessage で返す */
								injectedJavaScript={AUTOPLAY_SCRIPT}
								onMessage={handleMessage}
								/* 埋め込みが JS で描き直したとき（初回の onLoadEnd で video が
								   まだ無いケース）に、もう一度エージェントを起こす */
								onLoadEnd={() => webViewRef.current?.injectJavaScript(AUTOPLAY_SCRIPT)}
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
								}}
								onContentProcessDidTerminate={() => {
									logFrontendEvent({
										event_name: "external_embed_render_process_gone",
										error_level: "warn",
										payload: { provider: embed.provider, platform: "ios" },
									});
									setRenderProcessGone(true);
								}}
							/>
						</View>
					)}
				</View>
			)}
			{/*
			#1641【テスト容易性】**«再生できた» を機械で確かめられるようにする。**

			`showFallbackCta` が false であることは «再生できた» の根拠にならない。
			読み込み中（`playback === "unknown"`）でも false になるので、**何も再生していなくても
			Detox が緑になる**（＝ 偽の «直った»）。ページ内エージェントが «本当に currentTime が
			進んだ» と報告したときだけ現れる印を置き、spec はこれを待つ。

			見た目には影響しない（寸法ゼロ・タッチも受けない）
			*/}
			{playback === "playing" && (
				<View style={styles.playingMarker} pointerEvents="none" testID="external-embed-playing" />
			)}
			{showFallbackCta && (
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

const styles = StyleSheet.create({
	// #1375（案 A）はみ出した Instagram の UI をここで捨てる。
	// これが無いと切り取りが成立せず、セルの外へ白帯が出る
	cropFrame: {
		...StyleSheet.absoluteFillObject,
		overflow: "hidden",
		backgroundColor: FixedColors.mediaBackground,
		// 写真の箱を中央へ置く（等倍なので、上下にはアプリの地色が残る）
		alignItems: "center",
		justifyContent: "center",
	},
	// 位置と寸法は computeEmbedCropLayout が決めるので、ここでは絶対配置だけ宣言する
	webView: {
		position: "absolute",
		backgroundColor: FixedColors.mediaBackground,
	},
	// #1641 «再生できた» の機械可読な印。見た目には出さない
	playingMarker: {
		position: "absolute",
		width: 1,
		height: 1,
		opacity: 0,
	},
	overlayContainer: {
		...StyleSheet.absoluteFillObject,
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
