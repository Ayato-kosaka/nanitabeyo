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

**見せ方も注入で決める。** 同じスクリプトが `<video>` を WebView いっぱい（`object-fit: contain`）へ
広げるので、Instagram のヘッダ帯・いいね欄・白帯が消え、**リールだけ**がセルに出る。
WebView 自体は素のセル寸法のままなので、拡大による粗さも Android の
«大きな描画面が確保できず真っ黒» も起きない。

⚠️ **切り取らない。** リール（9:16）とセル（9:19.5 前後）は縦横比が違うので、上下には
こちらの地色が残る。cover で埋めると左右が約 18% 切れ、fill だと縦横比が壊れる。
どちらも投稿された映像を勝手に変えることになる（オーナー判断 2026-08-27）。

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
import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
	ActivityIndicator,
	AppState,
	type AppStateStatus,
	StyleSheet,
	Text,
	TouchableOpacity,
	UIManager,
	View,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { GestureDetector, type GestureType } from "react-native-gesture-handler";
import { NavigationContext } from "@react-navigation/native";
import { Play, Volume2 } from "lucide-react-native";

import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import type { DishMediaExternalEmbed } from "@shared/api/v1/res";
import {
	EMBED_IFRAME_BASE_URL,
	buildEmbedIframeHtml,
	buildExternalEmbedPlayerSource,
	isAllowedEmbedNavigation,
	isInlineEmbedUrl,
} from "../embedUrl";

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
  /*
   * #1641 **ページが組み上がるまでの猶予。**
   *
   * 実測（run 33249617397 / iOS）: TikTok の埋め込みだけ document.readyState が
   * 'loading' のまま 18 秒経っても変わらない。Instagram は boot から 1 秒で
   * 'interactive' になる。つまり «読み込みが終わらない» ページが実在する。
   *
   * この間は締め切りを数えない（数えると «映像が無い» と誤って結論する）。
   * ただし無制限には待たない。ここを過ぎたら «時間切れ» として導線へ縮退させ、
   * **黒いセルのまま放置しない**。
   */
  var LOADING_GRACE_MS = 15000;
  var installedAt = Date.now();
  var toldDom = false;
  /*
   * #1641 ページの読み込みが終わってなお <video> が無ければ、**権利ブロックされた投稿**である。
   * 12 秒の締め切りを待たずにここで見切る（待たせても結論は変わらない）。
   *
   * 実測（Chrome 152）: 再生できる投稿は <video> が **t=750ms** に現れる。読み込み完了から
   * さらに 2 秒待つので、遅い回線で «まだ描かれていないだけ» を取り違える余地はまず無い。
   */
  /*
   * #1641 ⚠️ **«読み込み完了なのに映像が無い» を急いで結論しない。**
   *
   * 実機の iOS で TikTok が 5 回中 2 回だけ no_video になった（BigQuery 実測）。
   * 同じ投稿が直前・直後に再生できているので **誤判定**である。
   * 原因は待ち時間が短すぎたこと: TikTok の <video> は **ページの JS が後から作る**ので、
   * 'complete' の 2 秒後にはまだ無いことがある（再生できた回は 4 秒時点で video=2）。
   *
   * ⚠️ 短くし直さないこと。«本当に映像が無い投稿» は取り込みのときにサーバが判定して
   * not_playable を持っており、そのセルは **WebView を 1 つも作らない**（高速パス）。
   * つまりここへ来る時点で «映像がある見込み» のほうが高い。急ぐ理由はもう無い。
   */
  var NO_VIDEO_GRACE_MS = 6000;
  var completeSince = 0;
  var timer = null, observer = null, deadlineAt = 0, inFlight = false, sent = {}, lastError = null;
  // 自動再生ポリシーで «音あり» を蹴られたか。蹴られた後は二度と音を戻さない
  var mutedByPolicy = false;
  var fillTicks = 0, poster = null, hidden = [];
  // #1641 読み込み中の tick 数。安い経路と高い経路の間引きに使う
  var loadTicks = 0;
  /*
   * #1641【観測】**組み上がらないページの «中身» を数えて送る。**
   *
   * iOS の実機で TikTok が readyState = 'loading' のまま 17 秒動かない（BigQuery 実測）。
   * ローカルの WebKit では 2 秒で interactive になるので、**環境の差**である。
   * «読めていないのか / 読めているのに readyState が上がらないのか» を分けないと
   * 直す先が決まらないので、止まっている間の DOM の育ち方を送る。
   * ⚠️ 送るのは**数だけ**。ページの中身（本文・URL のクエリ）は載せない。
   */
  var stallAt = [4000, 9000, 14000];

  /*
   * #1641【観測】**エージェントが走ったこと自体を 1 回知らせる。**
   * これが無いと «走ったが結論が出ない» と «一度も走っていない» を区別できず、
   * iOS の TikTok（無言）の原因に辿り着けなかった。
   */
  function report(kind, detail) {
    if (sent[kind]) return;
    /*
     * #1641 ⚠️ **一度 «再生できた» と言ったセルを、後から «再生できない» へ落とさない。**
     *
     * 実測（run 33168644022 / Android）: TikTok が
     *
     *     12:06:36  playing / audible
     *     12:06:37  not_supported / (期限切れの CDN URL)
     *
     * と 0.8 秒差で 2 回報告していた。呼び出し側は後者で unplayable へ倒すので、
     * **再生中の映像の上に «TikTok で見る» の帯が出る**。ユーザーから見れば «急に止まった»。
     *
     * 原因は loop の保険（ended で start() を撃ち直す）から入る再試行で、
     * そのとき currentSrc が期限切れだと NotSupportedError になる。
     * ⚠️ この注釈にバッククォートを書かないこと。ここはテンプレートリテラルの内側で、
     *    書いた時点で文字列が終わる（実際にこの修正で 1 度壊した）。
     * 映像は動き続けているので、**結論を覆す理由が無い**。
     */
    if (sent.playing && kind !== 'playing') return;
    sent[kind] = true;
    try {
      W.ReactNativeWebView.postMessage(JSON.stringify({
        src: 'nb-embed-autoplay', kind: kind, detail: detail == null ? null : String(detail)
      }));
    } catch (e) {}
  }

  /*
   * 仕事を «畳む» のはここだけ。結論が出たら interval も MutationObserver も必ず止める。
   *
   * ⚠️ 止め忘れると、Instagram の埋め込みのように **常時 DOM が変わるページ**で
   * 監視と再試行が延々と走り続け、WebView のメインスレッドを食い潰す。
   */
  function settle(kind, detail) {
    if (timer) { clearInterval(timer); timer = null; }
    if (observer) { try { observer.disconnect(); } catch (e) {} observer = null; }
    if (kind) report(kind, detail);
  }

  /*
   * #1641 **音を鳴らす。provider が最初からミュートで置いていることがある。**
   *
   * 実測（実機 Android / run 33149302351 の構造化ログ）:
   *
   *     instagram … audio=audible  （向こうの <video> がミュートでない）
   *     tiktok    … audio=muted    （向こうが muted で置いている）
   *
   * 旧版は «向こうが置いたまま» 再生していたので、**TikTok は永久に無音**だった。
   * WebView は mediaPlaybackRequiresUserAction={false} で開いており、Instagram が
   * 音付きで鳴っている以上、**端末側の制限ではない**。こちらから muted を外して撃つ。
   *
   * ⚠️ NotAllowedError で蹴られた後は二度と外さない。外すと再生そのものが止まり、
   *    «無音でも動く» すら失う（無音で動く方が、鳴らないより既存の料理動画セルに近い）。
   */
  function tryUnmute(v) {
    if (mutedByPolicy) return;
    try {
      if (!v.muted && !v.defaultMuted && v.volume > 0) return;
      v.muted = false;
      v.defaultMuted = false;
      v.removeAttribute('muted');
      if (!(v.volume > 0)) v.volume = 1;
    } catch (e) {}
  }

  /*
   * 再生開始の報告。**監視は即止め、音の有無だけ少し待ってから読む。**
   *
   * unmute の直後に v.muted を読むと、向こうの JS が書き戻す前の値を見て
   * «音あり» と誤報しうる。報告は 1 kind につき 1 回なので、遅らせても二重にならない。
   */
  function settlePlaying(v) {
    settle(null);
    tryUnmute(v);
    setTimeout(function () {
      try { report('playing', v.muted ? 'muted' : 'audible'); } catch (e) { report('playing', null); }
    }, 600);
  }

  /*
   * <video> を **WebView の表示領域いっぱい**へ広げ、Instagram の UI を背後へ隠す。
   *
   * ⚠️ クラス名に一切依存しないこと。«video タグが 1 つある» ことしか前提にしない。
   *    向こうの DOM 構造が変わっても壊れないのが、この書き方を選んでいる理由である。
   */
  function stretch(el, z) {
    var st = el.style;
    st.setProperty('position', 'fixed', 'important');
    st.setProperty('inset', '0', 'important');
    st.setProperty('width', '100vw', 'important');
    st.setProperty('height', '100vh', 'important');
    st.setProperty('max-width', 'none', 'important');
    st.setProperty('max-height', 'none', 'important');
    /*
     * ⚠️ **cover（切り取り）にしてはいけない。** オーナー指摘 2026-08-27:
     * 「全画面表示というのはクロップじゃないですよ？ 引き延ばしは除外で判断したはずです」。
     *
     * リールは 9:16、端末のセルは 9:19.5 前後なので、cover にすると左右が約 18% 切れる。
     * fill は縦横比が壊れる。**どちらも投稿された映像を勝手に変えている**ので使わない。
     * contain なら、リールの全体が入る最大の大きさで出る（余りはこちらの地色）。
     */
    st.setProperty('object-fit', 'contain', 'important');
    /*
     * ⚠️ **自分で地色を持つこと。** contain は縦横比が合わない分を «透明» のまま残すので、
     *    後ろにある provider の要素が透けて見える（TikTok で灰色の帯が出た）。
     */
    st.setProperty('background', '${FixedColors.mediaBackground}', 'important');
    st.setProperty('z-index', String(z), 'important');
  }

  /*
   * 地色。**<video> を待たずに、スクリプトが走った瞬間に敷く。**
   *
   * 埋め込みページの body は白なので、敷かないと «アプリの黒 → 一瞬の白 → 映像» と
   * 明滅する。セルの見た目を既存の料理動画セルへ揃えるための下地でもある。
   *
   * ⚠️ **重ねる div ではなく、html / body の背景色にする。**
   *    div を body へ足す方式は TikTok で映像を覆い隠した（下の isolate を参照）。
   */
  function ensureBackdrop() {
    /*
     * ⚠️ **«一度塗ったら終わり» にしてはいけない。** #1641 で実測（WebKit / TikTok）:
     *
     *     0.6s  エージェント起動。まだ <body> が無い
     *     1.0s  <body> が現れる … 埋め込みページ自身の **白**
     *     3.5s  isolate() が祖先を透明にして、ようやく白が消える
     *
     * 済み印を立てる方式だと、印を立てた後に向こうの JS が背景を書き戻したときに
     * 直せず、**«アプリの黒 → 白 → 映像» の明滅**が残る（document-start から
     * 走らせるようにして表面化した）。setProperty 2 回は 250ms ごとに回しても
     * ただ同然なので、毎 tick 塗り直す。
     *
     * ⚠️ **重ねる div ではなく html / body の背景色にする。**
     *    div を body へ足す方式は TikTok で映像を覆い隠した（下の isolate を参照）。
     */
    if (!document.documentElement) return;
    try {
      document.documentElement.style.setProperty('background', '${FixedColors.mediaBackground}', 'important');
      if (document.body) document.body.style.setProperty('background', '${FixedColors.mediaBackground}', 'important');
    } catch (e) {}
  }

  /*
   * #1641【設計】**映像を «祖先ごと» 前面へ出す。z-index に頼らない。**
   *
   * ## なぜ z-index では駄目だったか
   *
   * 当初は «黒い div を body へ足し、<video> に最大の z-index を振る» 方式だった。
   * Instagram では動いたが、**TikTok では画面が真っ黒のまま**になった
   * （report は playing、currentTime も 13 秒台まで進んでいるのに絵が出ない）。
   *
   * 原因は CSS の重なり文脈である。祖先に transform / filter があると
   *
   *   - position: fixed の基準がその祖先になる
   *   - z-index の比較もその部分木の中だけの話になる
   *
   * ので、body 直下へ足した黒い div のほうが前に出る。**provider の DOM 次第で
   * 勝ったり負けたりする**ので、この方式自体が危うい。
   *
   * ## 代わりに «映像の道» だけを残す
   *
   * <video> から body までの道のりで、**兄弟を消し、祖先の変形と切り取りを解除する**。
   * 重なりの勝負をしないので、向こうの DOM がどう組まれていても結果が変わらない。
   */
  function isolate(target) {
    /*
     * ⚠️ **前に隠したものを必ず戻してから隠し直す。**
     *    1 コマ目の画像を隠していた状態から <video> へ切り替えるとき、戻さないと
     *    «映像そのものを隠したまま» になりうる（両者は兄弟であることが多い）。
     */
    for (var h = 0; h < hidden.length; h++) {
      try { hidden[h].style.removeProperty('visibility'); } catch (e) {}
    }
    hidden = [];

    var el = target;
    var guard = 0;
    while (el && el.parentElement && guard++ < 30) {
      var parent = el.parentElement;
      for (var i = 0; i < parent.children.length; i++) {
        var sibling = parent.children[i];
        if (sibling !== el) {
          /*
           * display ではなく visibility を使う。display:none は要素をレイアウトから
           * 外すので、向こうのスクリプトが寸法を測って作り直す経路を刺激しうる。
           */
          try {
            sibling.style.setProperty('visibility', 'hidden', 'important');
            hidden.push(sibling);
          } catch (e) {}
        }
      }
      try {
        // これらが残っていると position:fixed の基準がここになる
        parent.style.setProperty('transform', 'none', 'important');
        parent.style.setProperty('filter', 'none', 'important');
        parent.style.setProperty('perspective', 'none', 'important');
        parent.style.setProperty('overflow', 'visible', 'important');
        parent.style.setProperty('background', 'transparent', 'important');
      } catch (e) {}
      if (parent === document.body) break;
      el = parent;
    }
  }

  /*
   * #1641【設計】**再生が始まるまでのつなぎに、リールの 1 コマ目（poster）を全面へ出す。**
   *
   * 実測（Chrome 152 / 埋め込みページの計時）:
   *
   *     t=500ms  1 コマ目の <img>（360x639）が出る
   *     t=1750ms ようやく <video> の currentTime が進み始める
   *
   * この差ぶん、何もしないとセルは **真っ黒のまま**になる（Detox run 33065565293 の
   * コマ 00 / 01 で実測。実機ではおよそ 2 秒）。既存の料理動画セルはその間
   * サムネイルが出ているので、揃えるにはここを埋める必要がある。
   *
   * ⚠️ 取り込み時のサムネイル（dish_media.thumbnailImageUrl）では埋められない。
   *    Instagram は複製が規約で禁じられており、**この provider では常に null** である
   *    （api/src/v1/dish-media/dish-media.assembler.ts）。埋め込みページ自身が持つ
   *    画像を使うのが、規約の中で 1 コマ目を出せる唯一の経路である。
   *
   * ⚠️ 大きい <img> «だけ» を拾う。プロフィール写真（150x150）を全面に出さないため。
   */
  function fillPoster() {
    if (poster && poster.isConnected) return;
    var imgs = document.querySelectorAll('img');
    var best = null;
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (!img.complete || img.naturalWidth < 200) continue;
      if (!best || img.naturalWidth * img.naturalHeight > best.naturalWidth * best.naturalHeight) best = img;
    }
    if (!best) return;
    poster = best;
    /*
     * #1641【観測 + 表示】**«画面に出せるものが載った» を 1 回だけ知らせる。**
     *
     * 呼び出し側はこれを合図に WebView を見せる。それまでは透明にしておき、
     * アプリが持っているサムネイルを見せる（オーナー報告「ロード完了から 3 秒黒い」）。
     */
    report('poster', null);
    // 映像がまだ無い間は、1 コマ目の画像を «前面へ出す» 対象にする
    // （これをしないと Instagram のヘッダ帯が画像の上に残る）
    isolate(poster);
    stretch(poster, 2147483646);
  }

  function fill(v) {
    ensureBackdrop();
    isolate(v);
    stretch(v, 2147483647);
  }

  function prepare(v) {
    fill(v);
    // 属性とプロパティの両方を立てる（Instagram 側の JS が属性を見て作り直すことがある）
    v.loop = true; v.setAttribute('loop', '');
    v.playsInline = true;
    v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
    if (v.__nbBound) return;
    v.__nbBound = true;
    v.addEventListener('playing', function () { fill(v); settlePlaying(v); }, false);
    /*
     * 再生開始で本体の仕事は畳むが、Instagram 側の JS が後から style を書き戻す可能性がある。
     * **上限つき**（15 回 = 約 15 秒）で全面化だけ貼り直す。無制限に回さないこと。
     */
    var refill = setInterval(function () {
      try { fill(v); } catch (e) {}
      if (++fillTicks >= 15) clearInterval(refill);
    }, 1000);
    // loop を向こうの JS に潰された場合の保険。ここだけは畳んだ後でも起こし直す
    v.addEventListener('ended', function () { try { v.currentTime = 0; } catch (e) {} start(); }, false);
  }

  /*
   * #1641【観測】いま DOM がどこまで育ったか。**数だけ**を返す（ページの中身は載せない）。
   *
   * 実測（iOS シミュレータ / TikTok, run 33269838360）:
   *
   *     4000ms ready=loading nodes=12 script=6 iframe=0 video=0 img=0 body=no res=7
   *
   * TikTok の埋め込みは <head> に *.tiktokcdn-us.com からの同期スクリプトを 4 本持つ。
   * それが返らない間はパースが <head> で止まり、<body> すら作られない。
   */
  function snapshot() {
    try {
      return 'ready=' + document.readyState
        + ' nodes=' + document.querySelectorAll('*').length
        + ' script=' + document.querySelectorAll('script').length
        + ' iframe=' + document.querySelectorAll('iframe').length
        + ' video=' + document.querySelectorAll('video').length
        + ' img=' + document.querySelectorAll('img').length
        + ' body=' + (document.body ? 'yes' : 'no')
        // 資源が 1 つも来ていないのか、来ているのに parse が止まっているのかを分ける
        + ' res=' + ((window.performance && performance.getEntriesByType)
            ? performance.getEntriesByType('resource').length : -1);
    } catch (e) {
      return 'snapshot-error';
    }
  }

  function attempt() {
    try {
      /*
       * #1641 **読み込み中は «安い経路» だけ回す。**
       *
       * document-start から回すので、ページの読み込みと自分の仕事が重なる。
       * fillPoster() は毎 tick すべての img を舐めるので、読み込み中は **1 秒に 1 回**へ間引く。
       *
       * ⚠️ **止めてしまってはいけない。** 1 コマ目を全面へ出すのがこの関数の仕事で、
       *    止めると «映像が出るまでの数秒が真っ黒» が戻る（一度そう書いて回帰テストで捕まえた）。
       *
       * **映像を探して撃つ経路は間引かない。** そこが本題である
       * — 実測（WebKit / TikTok）: 映像は readyState が loading の
       * **3.6 秒**で現れ、DocumentEnd（10.3 秒）を待つと間に合わない。
       */
      var loading = document.readyState === 'loading';
      ensureBackdrop();
      if (!loading || (loadTicks++ % 4) === 0) fillPoster();
      var v = document.querySelector('video');
      /*
       * #1641 **ページが組み上がっていない間は締め切りを数えない。**
       * 数えると «読み込みが遅いだけ» を «映像が無い（権利ブロック）» と取り違える。
       * 猶予を過ぎたら «時間切れ» として畳み、黒いセルのまま放置しない。
       */
      if (document.readyState === 'loading') {
        if (Date.now() - installedAt < LOADING_GRACE_MS) {
          deadlineAt = Date.now() + DEADLINE_MS;
        } else {
          // #1641 «諦めた瞬間» の DOM も載せる。4 秒時点と比べれば «伸びているのか止まっているのか» が分かる
          settle('timeout', 'still_loading ' + snapshot());
          return;
        }
      } else if (!toldDom) {
        toldDom = true;
        report('dom', document.readyState);
      }
      /*
       * #1641【観測】組み上がるまでの DOM の育ち方を、決めた時刻に 3 回だけ送る。
       * ⚠️ **kind を時刻ごとに変える。** report() は kind ごとに 1 回しか送らないので、
       *    同じ kind にすると 1 回目しか届かない（実際に 4 秒の 1 本しか取れなかった）。
       */
      if (stallAt.length && Date.now() - installedAt > stallAt[0]) {
        var elapsed = stallAt.shift();
        report('stall' + elapsed, snapshot());
      }
      if (Date.now() > deadlineAt) {
        settle(v ? 'timeout' : 'no_video', lastError);
        return;
      }
      if (!v) {
        // 読み込みが終わっているのに <video> が無い = 権利ブロック。締め切りを待たない
        if (document.readyState === 'complete') {
          if (!completeSince) completeSince = Date.now();
          else if (Date.now() - completeSince > NO_VIDEO_GRACE_MS) settle('no_video', 'load_complete ' + snapshot());
        }
        return;
      }
      prepare(v);
      // 撃つ前に毎回ミュートを外す（向こうの JS が書き戻すため 1 回では足りない）
      tryUnmute(v);
      if (!v.paused && v.currentTime > 0) {
        // 'playing' の購読より前に再生が始まっていた場合、イベントを取り逃す。
        // 見た目は正しい（帯を出さない）が «何割が再生できたか» の計測が欠けるので、ここでも報告する
        settlePlaying(v);
        return;
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
          settle('not_supported', v.currentSrc || v.src || '(empty)');
          return;
        }
        // NotAllowedError: 自動再生ポリシーで蹴られた。既存の動画セルは音ありだが、
        // 鳴らないよりミュートで動かす方が «同じ感覚» に近い。落として次の tick で再試行
        if (name === 'NotAllowedError') { mutedByPolicy = true; v.muted = true; v.defaultMuted = true; v.setAttribute('muted', ''); }
      });
    } catch (e) {}
  }

  /*
   * 監視を始める。**締め切りはここでしか延ばさない。**
   *
   * ⚠️ MutationObserver のコールバックから締め切りを延ばしたり attempt() を直接呼んだりしない。
   *    埋め込みは再生中も DOM を書き換え続けるので、そうすると
   *    (1) 締め切りが永久に来ず (2) 変更のたびに querySelector と play() が走る、という
   *    二重の暴走になる。Observer は «止まっている interval を起こし直す» だけにする。
   */
  function start() {
    deadlineAt = Date.now() + DEADLINE_MS;
    if (!timer) timer = setInterval(attempt, TICK_MS);
    if (!observer) {
      try {
        observer = new MutationObserver(function () { if (!timer) timer = setInterval(attempt, TICK_MS); });
        observer.observe(document.documentElement, { childList: true, subtree: true });
      } catch (e) {}
    }
    attempt();
  }

  W.__nbEmbedAutoplay = { kick: start };
  report('boot', document.readyState);
  start();
})(); true;`;

export type ExternalEmbedPlayerProps = {
	/*
	#1641 `playbackStatus` を受け取る。**«再生できない» はサーバが取り込みのときに
	判定済み**で、ここではそれを見るだけである（読み込んでから畳む、をやめた）。
	*/
	embed: Pick<
		DishMediaExternalEmbed,
		"provider" | "externalContentId" | "canonicalUrl" | "embedStatus" | "playbackStatus"
	>;
	/**
	 * #1641 **ページ内エージェントが «この投稿は再生できない» と結論したときに 1 度だけ呼ぶ。**
	 *
	 * ⚠️ 呼び出し側はサーバへ «確かめ直して» と頼むだけにすること。端末が再生できない理由は
	 *    投稿の側とは限らない（機内モード・WebView が殺された直後）。判定はサーバがやり直す。
	 *
	 * サーバが既に `not_playable` と知っている投稿では呼ばない（頼む意味が無い）。
	 */
	onUnplayable?: () => void;
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
	onUnplayable,
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
	/*
	#1641 «なぜ再生できなかったか»。**畳むかどうかの判断に使う**（下の `collapsedAfterFailure`）。
	`timeout` は «ページが 1 つも組み上がらなかった» ＝ WebView に見せるものが何も無い、を意味する。
	*/
	const [unplayableKind, setUnplayableKind] = useState<string | null>(null);
	/*
	#1641 ⚠️ **一度 «再生できた» セルを、後から «再生できない» へ落とさない。**

	実測（run 33168644022 / Android）: TikTok が playing の 0.8 秒後に not_supported を
	報告していた（loop の保険から入る再試行が、期限切れの CDN URL に当たった）。
	落とすと **再生中の映像の上に «TikTok で見る» の帯が出る**。ユーザーには «急に止まった» に見える。

	注入スクリプト側でも同じ守りを入れてあるが、**受け取る側でも塞ぐ**。
	スクリプトは再注入されうるし、そのとき送信済みの記録は失われる。
	*/
	const hasPlayedRef = useRef(false);
	/*
	#1641【観測】WebView が «この URL を読んでよいか» を聞いてきた回数と、このセルが立った時刻。
	iOS はサブフレームでもここへ聞きに来て、返事が来るまで待つ（下の `handleShouldStartLoad`）。
	*/
	const navDecisionsRef = useRef(0);
	const mountedAtRef = useRef(Date.now());
	/*
	#1641 **«再生できなかった» を 1 度だけサーバへ知らせる。**

	定期的な死活監視は無い（このリポジトリに cron は 1 本も無い）。取り込んだ後で
	権利ブロックが入った投稿は、**実際に踏んだ端末が知らせない限り誰も気づけない**。

	⚠️ **判定を送らない・保存させない。** 送るのは «確かめ直して» という合図だけで、
	   判定はサーバが取り込みのときと同じ経路でやり直す（`reportUnplayable`）。
	   端末の言い分をそのまま保存すると、電波の悪い 1 台のせいで投稿が全員の検索から消える。
	⚠️ サーバが既に `not_playable` と知っているなら送らない（頼む意味が無い）。
	*/
	const reportedRef = useRef(false);
	// «再生できなかった» の報告（上の reportedRef のコメント参照）
	useEffect(() => {
		if (playback !== "unplayable") return;
		if (embed.playbackStatus === "not_playable") return;
		if (reportedRef.current) return;
		reportedRef.current = true;
		onUnplayable?.();
	}, [playback, embed.playbackStatus, onUnplayable]);
	/*
	#1641 **音が出ているか。** YouTube だけ自動では戻せなかったので、
	«無音で再生中» のときだけタップで解除する口を出す（オーナー指示 2026-08-28）。
	*/
	const [audio, setAudio] = useState<string | null>(null);
	/*
	#1641【設計】**WebView は «見せられる状態» になるまで透明にしておく。**

	オーナー報告 2026-08-30:「どの PF もロード完了してから、動画流れるまで 3 秒くらい黒い画面になる」。

	原因は **こちらが黒く塗っていたこと**だった。アプリは既に料理のサムネイルを WebView の下へ
	敷いている（`DishMediaContent` の背景 Image）のに、その上に載せた WebView の html/body を
	地色（黒）で塗るので、**下のサムネイルが隠れる**。埋め込みページ側に出せる絵が無い間
	（TikTok は `img=0` ＝ 画像を 1 つも持たない）、そこは本当に何も無い。

	そこで «向こうに絵が載った» まで WebView を透明にし、下のサムネイルを見せる。
	載った合図は 2 つ:

	- `poster` … ページ内エージェントが 1 コマ目の画像を全面へ広げた
	- `playing` … 映像が動き出した（`poster` が来ない provider でもここで必ず見える）

	⚠️ **アンマウントではなく透明**にすること。読み込みを進めるために描画は続ける必要がある。
	*/
	const [webViewReadyToShow, setWebViewReadyToShow] = useState(false);
	const webViewRef = useRef<{ injectJavaScript: (script: string) => void } | null>(null);

	/*
	#1641 WebView の中の包みへ «音を出して» と頼む。`__nbEmbedUnmute` は
	`buildEmbedIframeHtml` が置いている（結果は `unmute_result` で返ってくる）。
	*/
	const handleUnmute = useCallback(() => {
		lightImpact();
		webViewRef.current?.injectJavaScript("window.__nbEmbedUnmute && window.__nbEmbedUnmute(); true;");
	}, [lightImpact]);

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
				hasPlayedRef.current = true;
				setPlayback("playing");
				setWebViewReadyToShow(true);
				setAudio(parsed.detail ?? null);
				logFrontendEvent({
					event_name: "external_embed_autoplay_started",
					error_level: "log",
					payload: { provider: embed.provider, audio: parsed.detail ?? null },
				});
				return;
			}
			/*
			#1641 タップで音を出せたかどうかの答え。**効いたと思い込まず、報告で判定する。**
			ここが `audible` にならないなら «タップでも音は出せない» が確定する。
			*/
			if (parsed.kind === "unmute_result") {
				setAudio(parsed.detail ?? null);
				logFrontendEvent({
					event_name: "external_embed_unmute_tapped",
					error_level: "log",
					payload: { provider: embed.provider, audio: parsed.detail ?? null },
				});
				return;
			}
			/*
			#1641【観測】`boot` / `dom` は **結論ではない**。ここで落とさずに返さないと、
			エージェントが起動しただけで «再生できない» へ倒れる。
			*/
			// #1641 `stall` は時刻ごとに kind が違う（stall4000 / stall9000 …）ので前方一致で見る
			// #1641 «向こうに絵が載った»。WebView を見せてよい合図（結論ではない）
			if (parsed.kind === "poster") {
				setWebViewReadyToShow(true);
				return;
			}
			if (parsed.kind === "boot" || parsed.kind === "dom" || parsed.kind?.startsWith("stall")) {
				logFrontendEvent({
					event_name: "external_embed_agent_boot",
					error_level: "log",
					payload: { provider: embed.provider, phase: parsed.kind, readyState: parsed.detail ?? null },
				});
				return;
			}
			// 再生が始まったセルは、後から何を言われても縮退させない（上の hasPlayedRef の説明）
			if (hasPlayedRef.current) return;
			// no_video（権利ブロック）/ not_supported（デコーダ無し）/ timeout
			setPlayback("unplayable");
			setUnplayableKind(parsed.kind ?? null);
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
			/*
			#1641【観測】**iOS がここで待つ回数と時刻を記録する。**

			iOS の `onShouldStartLoadWithRequest` は **サブフレームでも必ず呼ばれ、
			WebKit 側は JS の返事が来るまで待つ**（Android は返事が間に合わないと
			fail-open で先へ進む。この差は本ファイル冒頭の注記のとおり）。
			TikTok が iOS でだけ `readyState = 'loading'` のまま止まるので、
			**待たせている回数**を «原因の候補» として数える。数と時刻だけを残す
			（URL はホストと «トップフレームか» だけ。クエリは載せない）。
			*/
			if (navDecisionsRef.current < 12) {
				navDecisionsRef.current += 1;
				let host = "(parse-error)";
				try {
					host = new URL(request.url).hostname;
				} catch {
					host = request.url.slice(0, 24);
				}
				logFrontendEvent({
					event_name: "external_embed_nav_decision",
					error_level: "log",
					payload: {
						provider: embed.provider,
						host,
						isTopFrame: request.isTopFrame ?? null,
						nth: navDecisionsRef.current,
						sinceMountMs: Date.now() - mountedAtRef.current,
					},
				});
			}
			if (!isAllowedEmbedNavigation(request.url)) return false;
			if (request.isTopFrame === false) return true;
			if (isInlineEmbedUrl(request.url) || request.url === source?.embedUrl) return true;
			/*
			#1641 **包みのページ自身を止めない。**

			`mode: "iframe"` では WebView へ HTML を直接渡すので、**トップフレームの URL は
			`baseUrl`（= 自分たちのドメイン）になる**。これを許可リストへ入れ忘れると、
			読み込もうとした瞬間に自分で自分を止めることになる。
			中の YouTube はサブフレームなので `isTopFrame === false` の側で通る。
			*/
			if (source?.mode === "iframe" && request.url.startsWith(EMBED_IFRAME_BASE_URL)) return true;
			return false;
		},
		[embed.provider, logFrontendEvent, source?.embedUrl, source?.mode],
	);

	/*
	#1641 切り取り（embedCrop.ts）はネイティブでは不要になった。
	`<video>` を注入した CSS で WebView いっぱいへ広げるので、外から位置を測る必要が無い。
	**web（`.web.tsx`）は iframe へ注入できないので、あちらは引き続き embedCrop.ts を使う。**
	*/
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

	/*
	#1641【設計】**サーバが «再生できない» と判定済みなら、WebView を 1 つも作らない。**

	オーナー指摘 2026-08-28:「今は、埋め込み時に分岐しているんですね。それって処理重く
	なりますよね？そこを修正して欲しい」。

	従来はどのセルもいったん WebView を立ててページを読み、ページ内のエージェントが
	«この投稿には映像が無い» と報告してから畳んでいた。**再生できないと分かっている投稿でも
	毎回 260KiB のページと Chromium のレンダラを 1 つ起こしていた**（Android では
	これが積み上がって `lowmemorykiller` に殺された run が実際にある）。

	判定は取り込みのときにサーバが済ませて `playbackStatus` に持っている。ここでは
	それを見るだけで、**読み込みも計測もしない**。

	⚠️ **`unknown` を `not_playable` と同じに扱わない。** TikTok は判定材料が無く常に
	   `unknown` で、`playable` 以外を弾くと **TikTok が 1 本も再生されなくなる**。
	   弾くのは «再生できないと確定した» ものだけである。
	*/
	const knownNotPlayable = embed.playbackStatus === "not_playable";
	/*
	#1641【設計】**この場で «再生できない» と分かったら、WebView を畳んでサムネイルを見せる。**

	以前は地色で «覆って» いた。iframe（YouTube）の中は別オリジンなので、再生できないとき
	そのまま置くと YouTube 自身のページ（「ログインして bot ではないことを確認してください」）が
	出てしまい、こちらのスクリプトでは隠せないためである（run 33170443855 で実測）。

	ところが覆いは **料理の写真ごと隠す**。実機のコマ（run 33225189456 の autoplay-08）では、
	12 秒眺めた末に **真っ黒なセル＋「YouTube で見る」の帯**になっていた。
	覆う代わりに畳めば、向こうのページは同じように消えたうえで、**アプリが持っている
	サムネイル（＝料理の写真）が見える**。オーナー指摘 ④「サムネ画像を出す以外に選択肢はある？」。

	⚠️ `document` モード（Instagram / TikTok）は**原則畳まない**。あちらは 1 コマ目の写真を
	   全面に出しており、それ自体が «その投稿の絵» として正しい。

	**例外は `timeout`（ページが 1 つも組み上がらなかった）である。**
	そのときは中に写真も何も無く、WebView は **ただの黒い板**になってサムネイルを隠す。
	実機で実測した（[run 33265424032] の iOS `feed-02`: TikTok のセルが
	真っ黒＋「TikTok で見る」の帯だけ。中身は空のまま `still_loading` で時間切れ）。
	畳めばアプリが持っているサムネイル（＝料理の写真）が見える。

	⚠️ セルを離れると `playback` は `unknown` へ戻るので、次に来たときは 1 度だけ再挑戦する。
	*/
	const collapsedAfterFailure =
		playback === "unplayable" && (source?.mode === "iframe" || unplayableKind === "timeout");
	const inlineAvailable =
		source !== null && NativeWebView !== null && !renderProcessGone && !knownNotPlayable && !collapsedAfterFailure;
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
	/*
	#1641【設計】**タップ受けはこの帯だけにする。セル全面に広げない。**

	#1375 の頃はセル全面が «1 タップで操作モードへ入る» の受けだった。#1641 で操作モードを
	廃止したので、全面で受ける理由はもう無い。むしろ実害が 2 つある。

	1. **縦スワイプを食ってフィードを送れなくなる。** Detox（run 33135234690 / Android）で、
	   権利ブロックされたセルに着いたあと **8 回スワイプしても同じセルから動かなかった**
	   （コマの時計だけが進み、絵は同じ）。その先にある Instagram / TikTok のセルへ
	   永久に到達できない
	2. セルのどこを触っても外部ブラウザが開く。眺めているだけのつもりの指が当たっただけで
	   アプリの外へ連れて行かれる

	帯そのものは十分な大きさがあり、押したい人はそこを押す。
	*/
	const playButton = (
		<TouchableOpacity
			testID="external-embed-open-browser"
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
				/*
				#1641【設計】**WebView をセル全面に置き、中身の全面化はページの中でやる。**

				以前は «外から位置と拡大率だけで切り取る»（embedCrop.ts）方式だった。中の DOM を
				触れないことが前提だったからである。**自動再生の注入を入れた時点でその前提は消えた。**

				外から切り取る方式には実害があった。

				| | 症状 |
				| --- | --- |
				| 等倍で中央に置く | 映像がセルの一部にしか出ず、上下に黒帯が残る（オーナー指摘） |
				| 拡大して埋める | Android が大きな描画面を確保できずセルが真っ黒になる |

				いまは注入した CSS が `<video>` 自身を WebView いっぱい（`object-fit: contain`）へ
				広げるので、**WebView は素のセル寸法のままでよい**。拡大しないので粗くならず、
				Instagram のヘッダ帯・いいね欄は背後へ隠れるため切り取りも要らない。

				⚠️ web（`.web.tsx`）は iframe の中へ注入できないので、**embedCrop.ts の切り取りを使い続ける**。
				*/
				<View
					/*
					#1641 **向こうに絵が載るまで透明にしておく**（上の `webViewReadyToShow` を参照）。
					下にはアプリのサムネイルが敷いてあるので、黒ではなく料理の写真が見える。
					⚠️ 透明にするだけで、**アンマウントはしない**。読み込みを進めるため描画は続ける。
					*/
					style={[styles.cell, { opacity: webViewReadyToShow ? 1 : 0 }]}
					/* #1641 **常に表示専用**。タッチを一切渡さないので、縦スワイプでのフィード送りも
					   タップでの ActionSheet も、既存の動画セルと完全に同じ経路で処理される
					   （Android の RNCWebView は縦ドラッグを自分で消費するため、渡すと送りが死ぬ） */
					pointerEvents="none"
					testID="external-embed-webview">
					<NativeWebView
						ref={webViewRef}
						/*
						#1641【設計】**読み込み方は provider によって違う。**

						| mode | 読み込み方 | 再生のさせ方 |
						| --- | --- | --- |
						| `document`（Instagram / TikTok） | 埋め込み URL を直接読む | 同一オリジンなので `<video>` を注入して `play()` |
						| `iframe`（YouTube） | こちらの HTML を `baseUrl` 付きで読み、中に iframe を置く | 別オリジンなので触れない。YouTube 公式の IFrame API と postMessage でやり取りする |

						YouTube を直接読むと **必ずエラー 153** になる（`embedUrl.ts` の実測表）。
						これがオーナー報告「YouTube shorts がアプリ内再生できない」の真因だった。
						*/
						source={
							source.mode === "iframe"
								? { html: buildEmbedIframeHtml(source.embedUrl), baseUrl: EMBED_IFRAME_BASE_URL }
								: { uri: source.embedUrl }
						}
						style={styles.webView}
						allowsInlineMediaPlayback
						mediaPlaybackRequiresUserAction={false}
						// 表示専用なので、ユーザーの意図なく PiP へ持って行かれる余地を潰す
						allowsPictureInPictureMediaPlayback={false}
						/*
						#1641 ページ読み込みごとに自動再生エージェントを仕込む。
						`<video>` が現れるまで再試行し、結果を postMessage で返す。

						⚠️ **`iframe` モードへは注入しない。** 包みのページには `<video>` が無いので、
						   エージェントは «映像が無い» と判断して黒い地色だけを敷き、
						   **YouTube のプレイヤーを真っ黒に覆い隠す**（実測でそうなった）。
						   あちらの再生報告は包みの HTML 側のスクリプトが行う。
						*/
						injectedJavaScript={source.mode === "iframe" ? undefined : AUTOPLAY_SCRIPT}
						/*
						#1641 **エージェントを document-start から走らせる。**

						iOS の `injectedJavaScript` は WKUserScript の DocumentEnd で、
						そこまで待つと **TikTok に間に合わない**。WebKit（＝ WKWebView と
						同じエンジン）でローカル実測した数字:

						| 時刻 | 状態 |
						| --- | --- |
						| 3.6s | `<video>` が現れる（readyState はまだ 'loading'） |
						| 10.3s | 'interactive' ＝ **DocumentEnd の注入はここまで来ない** |
						| 14.3s | 'complete' |

						document-start から撃つと **4.7 秒で再生した**（同実測）。

						⚠️ 二重に走っても安全である。スクリプト先頭の
						   `if (W.__nbEmbedAutoplay) { kick(); return; }` が吸収し、
						   2 回目以降は締め切りを延ばすだけになる。
						⚠️ 読み込み中は `attempt()` が **安い経路だけ**を回す（`fillPoster` を止める）。
						*/
						injectedJavaScriptBeforeContentLoaded={source.mode === "iframe" ? undefined : AUTOPLAY_SCRIPT}
						onMessage={handleMessage}
						/* 埋め込みが JS で描き直したとき（初回の onLoadEnd で video が
						   まだ無いケース）に、もう一度エージェントを起こす */
						onLoadEnd={
							source.mode === "iframe" ? undefined : () => webViewRef.current?.injectJavaScript(AUTOPLAY_SCRIPT)
						}
						// Android: target=_blank で «画面外の新しい WebView» を作らせない（ヘッダ参照）
						setSupportMultipleWindows={false}
						onOpenWindow={(event: { nativeEvent: { targetUrl: string } }) =>
							openInAppBrowser(event.nativeEvent.targetUrl, "open_window")
						}
						onShouldStartLoadWithRequest={handleShouldStartLoad}
						// レンダラが殺されたら黒いセルで放置せず、«Instagram で見る» へ戻す
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
			{/*
			#1641 **«このセルに着いた» 印。** 再生の印とは別に要る。

			run 33138096398 では «instagram と tiktok が再生できなかった» としか分からず、
			**そのセルへ一度も着けていなかったのか / 着いたが再生しなかったのか**を
			コマを目視するまで切り分けられなかった（実際は権利ブロックのセルで送りが
			止まっており、その先へ着けていなかった）。両方を印にすれば失敗文だけで分かる。
			*/}
			{/* ⚠️ **`inlineAvailable` で括らない。** これは «再生できる構成か» ではなく
			    «このセルに着いたか» の印である。再生できないセル（権利ブロック・
			    埋め込み不可）で消えると、Detox から «着けなかった» と区別できなくなる。 */}
			<View style={styles.playingMarker} pointerEvents="none" testID={`external-embed-cell-${embed.provider}`} />
			{/* #1641 サーバの判定で WebView を作らずに済んだ印。Detox から
			    «高速パスが効いたか» を直接見るために出す（見た目には何も足さない） */}
			{knownNotPlayable && (
				<View
					style={styles.playingMarker}
					pointerEvents="none"
					testID={`external-embed-known-not-playable-${embed.provider}`}
				/>
			)}
			{playback === "playing" && (
				/* #1641 provider ごとに分けて出す。«どの provider が再生できたか» を
				   Detox から 1 つずつ判定できるようにするため（YouTube だけ落ちる、が拾える） */
				<View style={styles.playingMarker} pointerEvents="none" testID={`external-embed-playing-${embed.provider}`} />
			)}
			{/*
			#1641 **読み込み中はローディングを出す。**（オーナー指示 2026-08-30
			「せめてローディング出して欲しい」）

			下にはアプリのサムネイルが見えている状態なので、ここは «あと少し待てば動く» を
			伝えるだけでよい。控えめな白のインジケータ 1 つに留める
			（デザイン規約 §1: 赤は主 CTA と FAB だけ。ここは CTA ではない）。

			⚠️ 出す条件は «WebView をまだ見せていない» かつ «結論が出ていない»。
			   縮退したセルには導線の帯が出るので、そちらと二重に出さない。
			*/}
			{inlineAvailable && !webViewReadyToShow && playback === "unknown" && (
				<View style={styles.loadingOverlay} pointerEvents="none" testID="external-embed-loading">
					<ActivityIndicator size="small" color={FixedColors.onMedia} />
				</View>
			)}
			{/* #1641 **地色の «覆い» は廃止した。** 覆うと料理の写真ごと隠れる。
			    代わりに WebView を畳む（上の `collapsedAfterFailure`）。畳めば向こうのページは
			    同じように消えたうえで、アプリが持っているサムネイルが見える。
			    畳んだことを Detox から見るための印だけ残す（見た目には何も足さない）。 */}
			{collapsedAfterFailure && (
				<View style={styles.playingMarker} pointerEvents="none" testID="external-embed-collapsed" />
			)}
			{/*
			#1641 **無音で再生中のときだけ «音を出す» を出す（いまのところ YouTube だけ）。**

			自動では戻せなかった（onReady で unMute / URL の mute=1 を外す / 再生後も撃ち直す、
			の 3 通りとも実機で無音）。IFrame API が求めているのはユーザー操作なので、
			**タップで撃ち直す口**を出す。オーナー指示 2026-08-28。

			⚠️ アプリ側のタップは WebView の中では «ユーザー操作» にならない可能性がある。
			   効いたかどうかは思い込まず、`unmute_result` の報告で判定する。
			⚠️ 音が出た（audible）ら消す。出続けると «押しても何も起きないボタン» になる。
			*/}
			{playback === "playing" && audio !== null && audio !== "audible" && (
				<View style={styles.overlayContainer} pointerEvents="box-none">
					<View style={styles.unmuteTapTarget}>
						<TouchableOpacity
							testID="external-embed-unmute"
							onPress={handleUnmute}
							accessibilityRole="button"
							accessibilityLabel={i18n.t("DishMediaContent.embed.unmute")}>
							<View style={styles.playHint}>
								<Volume2 size={12} color={FixedColors.onMedia} />
								<Text style={styles.playLabel}>{i18n.t("DishMediaContent.embed.unmute")}</Text>
							</View>
						</TouchableOpacity>
					</View>
				</View>
			)}
			{showFallbackCta && (
				<View style={styles.overlayContainer} pointerEvents="box-none" testID="external-embed-fallback">
					{/*
					#1641 **位置決めはこの View だけが持つ。**

					以前は「タップを受ける View」と「位置を決める View」が同じもので、それが
					`StyleSheet.absoluteFill`（＝ セル全面）だった。WebView は
					`pointerEvents="none"` なので、**このセルで指を受け取りうる View はここだけ**。
					全面のまま残すと縦スワイプがここで止まり、フィードを送れなくなる
					（`playHintTapTarget` を帯の大きさへ縮めるだけでは足りない）。

					⚠️ run 33138096398 / 33146739657 で «セルから動かない» を実際に踏んだが、
					   **あれの真因はこれではなく «フィードの最後のセルだった»**（お店フィードは
					   料理 1 件につき 1 本しか返さないため、素材が 1 本しか並んでいなかった）。
					   ここは «踏んでいないが確実に踏む» 側の穴として塞いである。

					位置決めを外側へ出したので、中の «触れる View» は帯の大きさで済む。
					素の View（高さ 0）で中の絶対配置が壊れる問題（run 32724564583）も、
					絶対配置そのものをやめたので起きない。
					*/}
					<View style={styles.playHintTapTarget}>
						{blockParentTapGesture ? (
							<GestureDetector gesture={blockParentTapGesture}>
								{/* collapsable=false: GestureDetector が実ビューを要求する */}
								<View collapsable={false}>{playButton}</View>
							</GestureDetector>
						) : (
							playButton
						)}
					</View>
				</View>
			)}
		</>
	);
}

const styles = StyleSheet.create({
	// #1641 セル全面。中身の全面化は注入した CSS が担うので、ここでは切り取らない
	cell: {
		...StyleSheet.absoluteFillObject,
		backgroundColor: FixedColors.mediaBackground,
	},
	webView: {
		flex: 1,
		backgroundColor: FixedColors.mediaBackground,
	},
	// #1641 «再生できた» の機械可読な印。見た目には出さない
	// #1641 読み込み中のインジケータ。セルの中央へ 1 つだけ置く
	loadingOverlay: {
		...StyleSheet.absoluteFillObject,
		alignItems: "center",
		justifyContent: "center",
	},
	playingMarker: {
		position: "absolute",
		width: 1,
		height: 1,
		opacity: 0,
	},
	// #1641 «音を出す» は帯より少し上。導線の帯と重ならない位置に置く
	unmuteTapTarget: {
		position: "absolute",
		bottom: 172,
		alignSelf: "center",
	},
	overlayContainer: {
		...StyleSheet.absoluteFillObject,
		justifyContent: "center",
		alignItems: "center",
	},
	/*
	#1641 タップ受けは帯そのものだけ。**セル全面に広げない**（理由は playButton の定義側）。

	⚠️ 下端ぴったりに置くとフィードの絞り込みチップの裏へ隠れる（web で実測）ので、
	   `overlayContainer` の中で下寄せしつつ余白を取る。
	*/
	playHintTapTarget: {
		position: "absolute",
		bottom: 124,
		alignSelf: "center",
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
