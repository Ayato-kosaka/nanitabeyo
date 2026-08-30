/*
#1375 4 巡目実機確認: 取り込んだ SNS 投稿（render_type='external_embed'）の
«再生用» 埋め込み URL を組む純関数。

## なぜ canonicalUrl をそのまま使わないのか

canonicalUrl は投稿ページ（instagram.com/reel/... 等）で、iframe / WebView に
そのまま入れると X-Frame-Options で拒否されるか、フルサイトが出てしまう。
各 provider が公式に用意している «埋め込み専用 URL» を使う。

| provider | 埋め込み URL | 根拠 |
| --- | --- | --- |
| instagram | `https://www.instagram.com/p/{code}/embed/` | 公式 blockquote 埋め込みが最終的に描く iframe と同じ。reel のコードも `/p/{code}/` で解決される（サーバ側 sns-oembed.service.ts が resolve で実測済みの同じ経路）。`/embed/captioned/` はヘッダ＋キャプションの白カードが付き全画面フィードで浮くため、映像本体だけの `/embed/` を使う（独立レビュー指摘） |
| tiktok | `https://www.tiktok.com/embed/v2/{videoId}` | 公式 embed v2。動画 ID だけで動く。**自動再生はしない**（autoplay パラメータが無く、provider 側もユーザー操作を要求する）ので、着地後に 1 タップ要る。独立レビュー指摘で «TikTok も無音自動再生» という記述を実測に合わせて訂正した |
| youtube | `https://www.youtube.com/embed/{videoId}?playsinline=1&autoplay=1&mute=1` | 公式 iframe embed。playsinline はモバイルでフルスクリーンに奪われないため。autoplay+mute は既存 dish_media の «着地したら動く» に寄せるため（ブラウザは無音でないと自動再生を許可しない） |

判定できない provider は null（呼び出し側は «外部で開く» へ縮退する）。
*/

export type EmbeddablePlayerSource = {
	/** iframe / WebView に入れる URL */
	embedUrl: string;
	/** 「◯◯で再生」の表示名。固有名詞なので翻訳しない（sns-import.tsx と同じ判断） */
	providerLabel: string;
	/**
	 * #1641 **埋め込みをどう読み込むか。**
	 *
	 * | | 意味 |
	 * | --- | --- |
	 * | `document` | 埋め込み URL を WebView へ直接読ませる（＝ トップレベル文書）。ページと同一オリジンになるので `<video>` を注入で操作できる |
	 * | `iframe` | こちらの HTML の中に iframe として置く。**YouTube はこれでないと動かない**（下記） |
	 *
	 * ## なぜ YouTube だけ iframe が要るのか
	 *
	 * YouTube の埋め込みは **トップレベル文書として開かれることを拒否する**。実測（Chrome 152）:
	 *
	 * | 読み込み方 | 結果 |
	 * | --- | --- |
	 * | `https://www.youtube.com/embed/{id}` を直接開く | **エラー 153**。`dQw4w9WgXcQ`（誰でも埋め込める動画）でも同じ |
	 * | 実 https オリジンのページに iframe で置く | **無音で自動再生する**（`paused=false` / `currentTime` が進む） |
	 *
	 * WebView は URL を直接渡すとトップレベル文書として開くので、
	 * **これまで YouTube は必ずエラー 153 になっていた**（オーナー報告「アプリ内再生できない」）。
	 */
	mode: "document" | "iframe";
};

export function buildExternalEmbedPlayerSource(
	provider: string,
	externalContentId: string,
): EmbeddablePlayerSource | null {
	if (!externalContentId) return null;
	const encodedId = encodeURIComponent(externalContentId);
	switch (provider) {
		case "instagram":
			return {
				embedUrl: `https://www.instagram.com/p/${encodedId}/embed/`,
				providerLabel: "Instagram",
				mode: "document",
			};
		case "tiktok":
			return {
				embedUrl: `https://www.tiktok.com/embed/v2/${encodedId}`,
				providerLabel: "TikTok",
				mode: "document",
			};
		case "youtube":
			return {
				/*
				enablejsapi=1: 親のページから再生状態を受け取るため（YouTube IFrame API）。

				⚠️ **`mute=1` を付けないこと。** 付けるとプレイヤーが無音で始まり、あとから
				   `unMute` を撃っても実機では無音のままだった（run 33167111834: `audio=muted`。
				   同じ run で TikTok は `audible` になっている）。自動再生ポリシーで蹴られた場合は、
				   包みの HTML が無音で撃ち直す。
				*/
				embedUrl: `https://www.youtube.com/embed/${encodedId}?playsinline=1&autoplay=1&enablejsapi=1`,
				providerLabel: "YouTube",
				mode: "iframe",
			};
		default:
			return null;
	}
}

/*
WebView 内ナビゲーションの許可判定（2 段構え）。

## 1. `isAllowedEmbedNavigation` — スキーム
`onShouldStartLoadWithRequest` は **サブフレーム（広告 iframe）や 302 リダイレクトでも
呼ばれる**（iOS は isTopFrame をイベントに載せるだけで必ず呼ぶ / Android は
isForMainFrame を捨てて URL 版へ委譲する）。埋め込み内部の通信を打ち切ると
埋め込み自体が壊れるので、http(s) と about: は通し、`intent://` `market://` 等の
アプリ起動スキームだけを黙って遮断する。

## 2. `isInlineEmbedUrl` — トップフレームで «そのまま読ませてよい» URL か
独立レビュー指摘（PR #1469）: ホスト集合の «拒否リスト» では
`l.instagram.com`（外部リンク shim）/ `vm.tiktok.com` / `instagr.am` /
`accounts.instagram.com` のような別ホストや、パスの途中に `/embed` を含む本体ページを
取りこぼし、フルサイトがフィードのセル内へ読み込まれる（実機でアプリのプロセスごと
落ちた。run 32654704176）。そこで発想を反転し、**埋め込みページの形に前方一致する
ものだけを inline 継続とする許可リスト**にした。それ以外のトップフレーム遷移は
呼び出し側がアプリ内ブラウザへ逃がす。
*/
export function isAllowedEmbedNavigation(url: string): boolean {
	return /^https?:\/\//.test(url) || url.startsWith("about:");
}

/** provider の «埋め込みページ» そのものか（トップフレームで inline 継続してよいか） */
export function isInlineEmbedUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		// RN 内蔵の URL は hostname を小文字化しない（polyfill の読み込み順に依存させない）
		const host = parsed.hostname.toLowerCase();
		const path = parsed.pathname;
		if (host === "www.instagram.com" || host === "instagram.com") {
			// /p/{code}/embed/ ・ /reel/{code}/embed/ ・ /tv/{code}/embed/
			return /^\/(p|reel|tv)\/[^/]+\/embed\/?$/.test(path);
		}
		if (host === "www.tiktok.com" || host === "tiktok.com") {
			return /^\/embed(\/v2)?\/[^/]+\/?$/.test(path);
		}
		if (host === "www.youtube.com" || host === "youtube.com" || host === "www.youtube-nocookie.com") {
			return /^\/embed\/[^/]+\/?$/.test(path);
		}
		return false;
	} catch {
		return false;
	}
}

/**
 * #1641 `mode: "iframe"` の埋め込みを包む HTML を組む（いまは YouTube だけ）。
 *
 * ## なぜ包む必要があるのか
 *
 * YouTube の埋め込みは **トップレベル文書として開かれると必ずエラー 153 になる**
 * （`EmbeddablePlayerSource.mode` の表を参照）。**実在の https オリジンを持つページの
 * 中に iframe として置く**と、無音で自動再生する。WebView へはこの HTML を
 * `baseUrl` 付きで読ませ、そのオリジンを親として使わせる。
 *
 * ## 再生状態は YouTube の公式 API で受け取る
 *
 * 中身は別オリジンなので、Instagram / TikTok のように `<video>` を直接触れない。
 * 代わりに **YouTube IFrame API**（`enablejsapi=1`）へ `postMessage` で話しかけ、
 * 返ってくる `onStateChange` / `onError` を、他の provider と**同じ形の報告**
 * （`nb-embed-autoplay`）へ翻訳する。こうすることで、
 * 「再生できているセルには何も重ねない / 再生できない投稿だけ導線へ縮退する」という
 * 呼び出し側の分岐を provider ごとに書き分けずに済む。
 *
 * ⚠️ `postMessage` の宛先オリジンは `https://www.youtube.com` に固定する。
 *    `*` にすると、埋め込みが差し替わったときに任意の相手へ送ってしまう。
 * ⚠️ 受信側も `event.origin` を検査する。**中身は第三者のページである。**
 */
export function buildEmbedIframeHtml(embedUrl: string): string {
	// 埋め込み URL は buildExternalEmbedPlayerSource が ID から組み立て直した値だけが来る
	return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>
  html,body{margin:0;padding:0;height:100%;background:#000;overflow:hidden}
  iframe{border:0;position:fixed;inset:0;width:100vw;height:100vh}
</style></head>
<body>
<iframe id="nb-embed" src="${embedUrl}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
<script>
(function () {
  var ORIGIN = 'https://www.youtube.com';
  var frame = document.getElementById('nb-embed');
  var settled = false;
  /*
   * #1641 **まず音ありで撃つ。** 旧版は onReady で必ず mute してから playVideo していたので、
   * YouTube だけ構造的に無音だった（実機ログ: audio=muted）。Instagram は音付きで鳴っており、
   * WebView は mediaPlaybackRequiresUserAction={false} なので、端末側の制限ではない。
   * 音ありで始まらなかったときだけ、下の締め切りで無音へ落とす。
   */
  var UNMUTE_GRACE_MS = 1500;
  var started = false;
  var mutedFallback = false;
  var lastMuted = null;

  // ⚠️ **結論は 1 度だけ。** 再生が始まったあとに締め切りが来ても報告し直さない
  //    （呼び出し側が «再生できない» へ戻り、動いている映像に導線の帯が乗ってしまう）
  function report(kind, detail) {
    if (settled) return;
    settled = true;
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        src: 'nb-embed-autoplay', kind: kind, detail: detail == null ? null : String(detail)
      }));
    } catch (e) {}
  }

  function send(message) {
    try { frame.contentWindow.postMessage(JSON.stringify(message), ORIGIN); } catch (e) {}
  }

  /*
   * #1641 **ユーザーのタップで音を出す口。**
   *
   * 自動では音を戻せなかった（onReady で unMute / URL の mute=1 を外す / 再生後も撃ち直す、の
   * 3 通りとも実機で無音）。IFrame API が求めているのはユーザー操作なので、アプリ側の
   * ボタンから叩けるようにしておく。**結果は必ず報告し直す**（効いたのかどうかを
   * 思い込みではなく計測で判定するため）。
   */
  window.__nbEmbedUnmute = function () {
    lastMuted = null;
    mutedFallback = false;
    send({ event: 'command', func: 'unMute', args: [] });
    send({ event: 'command', func: 'setVolume', args: [100] });
    send({ event: 'command', func: 'playVideo', args: [] });
    var waited = 0;
    var poll = setInterval(function () {
      waited += 300;
      send({ event: 'listening' });
      if (lastMuted !== null || waited >= 3000) {
        clearInterval(poll);
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            src: 'nb-embed-autoplay',
            kind: 'unmute_result',
            detail: lastMuted === false ? 'audible' : lastMuted === true ? 'muted' : 'unknown'
          }));
        } catch (e) {}
      }
    }, 300);
  };

  window.addEventListener('message', function (event) {
    // 中身は第三者のページ。素性の分からない相手の言うことは読まない
    if (event.origin !== ORIGIN) return;
    var data;
    try { data = JSON.parse(event.data); } catch (e) { return; }

    if (data.event === 'onReady') {
      send({ event: 'command', func: 'unMute', args: [] });
      send({ event: 'command', func: 'playVideo', args: [] });
      /*
       * 音ありの自動再生はポリシーで蹴られることがある。**蹴られたら無音で撃ち直す。**
       * 鳴らないより «無音でも動く» 方が、既存の料理動画セルの感覚に近い。
       */
      setTimeout(function () {
        if (started) return;
        mutedFallback = true;
        send({ event: 'command', func: 'mute', args: [] });
        send({ event: 'command', func: 'playVideo', args: [] });
      }, UNMUTE_GRACE_MS);
      return;
    }

    /*
     * ⚠️ **状態は onStateChange では飛んでこない。** 実測すると YouTube は
     *    infoDelivery の中へ info.playerState を載せて送ってくる。
     *
     *    実測（Chrome 152）:
     *      再生できる動画   … playerState: 1（PLAYING）
     *      埋め込み不可の動画 … playerState: -1 → 3（未開始 → バッファのまま進まない）
     */
    if (data.event === 'infoDelivery' && data.info) {
      // 音の状態は別便で届くことがあるので、届いたものを覚えておく
      if (typeof data.info.muted === 'boolean') lastMuted = data.info.muted;
      if (data.info.playerState === 1 && !started) {
        started = true;
        /*
         * ⚠️ **この瞬間に読まない。** unMute の結果が infoDelivery で返るまでの間に
         *    読むと «無音» と誤報する。報告は 1 度だけなので遅らせても二重にならない。
         */
        /*
         * ⚠️ **分かってから報告する。** 無音で撃ち直した（mutedFallback）ならその時点で確定だが、
         *    そうでない場合は YouTube 側から muted の状態が届くまで待つ。届く前に読むと、
         *    実際は音が出ているのに «無音» と報告してしまい、計測が嘘になる。
         *    3 秒待っても届かなければ、分からないまま（unknown）報告する。
         */
        var waited = 0;
        var poll = setInterval(function () {
          waited += 300;
          send({ event: 'listening' });
          /*
           * ⚠️ **再生が始まってからも unMute を撃ち直す。** 自動再生ポリシーは
           *    «無音でない再生を «始める»» を蹴るもので、動き出した後なら通ることがある。
           *    onReady の 1 回だけでは音が戻らなかった（run 33168644022: audio=muted）。
           */
          if (!mutedFallback) send({ event: 'command', func: 'unMute', args: [] });
          if (mutedFallback) { clearInterval(poll); report('playing', 'muted'); return; }
          if (lastMuted !== null) { clearInterval(poll); report('playing', lastMuted ? 'muted' : 'audible'); return; }
          if (waited >= 3000) { clearInterval(poll); report('playing', 'unknown'); }
        }, 300);
      }
      if (typeof data.info.errorCode !== 'undefined') report('no_video', data.info.errorCode);
    }
    // 動画側が埋め込みを許可していない / 存在しない
    if (data.event === 'onError') report('no_video', data.info);
  }, false);

  // 状態通知の購読を開始する（この 1 通が無いと onStateChange は飛んでこない）
  var hello = setInterval(function () { send({ event: 'listening' }); }, 500);
  setTimeout(function () { clearInterval(hello); }, 8000);
  /*
   * #1641 **プレイヤーが起きてこないときは、12 秒も待たない。**
   *
   * 実測（run 33170443855 / Android）: 埋め込みを許可していない動画のセルは、YouTube 自身の
   * ページ（「ログインして bot ではないことを確認してください」）が**そのまま出たまま**だった。
   * onReady が来ない以上こちらは何も撃てないので、待つほど第三者のエラー画面を見せ続けることになる。
   * ⚠️ **短くしすぎない。** 6 秒にしたところ、実機で **まだ準備中の YouTube を 2 セル分
   *    «再生できない» へ落とした**（run 33205231591: no_video / no_ready が 2 件出たあと、
   *    別のセルでは同じ動画が普通に再生している）。エミュレータでは onReady まで
   *    6 秒を超えることがある。10 秒にして、それでも来なければ縮退させる。
   */
  setTimeout(function () { if (!started) report('no_video', 'no_ready'); }, 10000);
  setTimeout(function () { report('timeout', 'no_state_change'); }, 12000);
})();
</script>
</body></html>`;
}

/**
 * `mode: "iframe"` の HTML を読ませるときの `baseUrl`。
 *
 * **実在の https オリジンでなければならない。** `http://127.0.0.1` や `about:blank` では
 * YouTube が親オリジンを認めず「このコンテンツはご利用いただけません」になる（実測）。
 * 自分たちのドメインを使う。
 */
export const EMBED_IFRAME_BASE_URL = "https://app.nanitabeyo.net";
