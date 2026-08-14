# アイデア検証: hybrid-session-mint-plus-xbogus-signed-requests

## 結論: 動作しなかった (DOES NOT WORK)

「実ブラウザで1回だけセッション(msToken/Cookie)を確立 → 以降はNode/Pythonの軽量HTTPリクエストに
OSS実装のX-Bogus署名を付与するだけで済ませる」というハイブリッド方式は、**2つの独立した理由で
どちらも致命的**であることを実機で確認した。

1. **署名スキームそのものが陳腐化している**: TikTok本体が実際に送信している内部APIリクエストを
   キャプチャしたところ、`X-Bogus=1`(固定値のプレースホルダ)になっており、代わりに
   `X-Gnarly`(クエリパラメータ、Base64長大文字列)と`X-Dynosaur`という**別の署名**が必須になっていた。
   検証で使ったOSS実装 `lijinhuai/X-Bogus-1` は `X-Gnarly`/`X-Dynosaur` を生成できないため、
   このライブラリで作った署名はそもそも現行APIの検証をパスしない。
2. **署名が完全に正しくてもTLS/クライアント層でブロックされる**: 実ブラウザが検索ページ遷移時に
   自然発行した「100%正しい・キャプチャ直後でまだ有効なはずの」実リクエストURL
   (正しいX-Gnarly/X-Dynosaur/msToken/Cookieを全て含む)を、そのままNode.jsの`https`モジュールで
   リプレイしたところ、HTTP 200・本文0バイトで即座にブロックされた。署名やCookieの正しさとは
   無関係に、**リクエストを発行するクライアントのTLS/HTTP層のフィンガープリント(JA3/JA4等)で
   弾かれている**ことを示す直接証拠。

つまり「ブラウザは初回セッション確立の1回だけ」という当初の狙いは成立せず、
軽量HTTPクライアントでは(署名が完璧でも)Akamai/TikTok側のクライアント判定を通過できなかった。

## 実行内容と生の結果

### Step 1: 実ブラウザ(Playwright, headless Chromium)で1回だけセッションを確立

リポジトリの `e2e-web` が既に依存する `@playwright/test`(chromium 1234, headless=true)を利用。
`scratchpad/mint_session.js` で `https://www.tiktok.com/` に遷移し、`context.cookies()` でCookieを抽出。

```
$ node mint_session.js
navigating to https://www.tiktok.com/ ...
final URL: https://www.tiktok.com/
cookie count: 9
cookie names: tt_csrf_token, tt_chain_token, tiktok_webapp_theme_source, tiktok_webapp_theme, ttwid, msToken, delay_guest_mode_vid, msToken, g_state
page title: TikTok - Make Your Day
done, cookies saved.
```

→ 有効な `msToken`(176文字)を含む9個のCookieを実ブラウザから取得できた(`scratchpad/mint_cookies.json`)。
ここまでは仮説通り成功。

### Step 2: この実Cookie + OSS X-Bogusで軽量HTTP(Node `https`、ブラウザ無し)リクエスト

`scratchpad/xbtest_realcookies.js` で、Step 1の実msToken/Cookieを使い、
`lijinhuai/X-Bogus-1` (`scratchpad/xbogus1/X-Bogus.js`) で署名した
`https://www.tiktok.com/api/search/general/full/?keyword=ramen+tokyo&...&X-Bogus=...` に
プレーンなNode `https.get`でアクセス。

```
$ node xbtest_realcookies.js
cookie keys from real session: [ 'tt_csrf_token', 'tt_chain_token', ..., 'msToken', ... ]
msToken present: true len= 176
URL length: 645
STATUS 200
content-length header: 0
body length (actual): 0
BODY (first 800):
```

→ **HTTP 200だが本文0バイト**。前回検証(Cookie未確立)と同じ結果。実ブラウザ由来の有効な
msTokenを持ち込んでも、軽量HTTPクライアントからのX-Bogus署名リクエストはブロックされたまま。

### Step 3 (追加の切り分け): 同じ署名済みURLを、セッション確立に使ったのと同じブラウザ内から`fetch()`で叩く

「Node httpsのTLSフィンガープリントが原因では」という仮説を検証するため、
`scratchpad/mint_and_probe.js` で、Cookieを確立したのと**同じPlaywrightブラウザコンテキスト内**の
`page.evaluate(() => fetch(url, {credentials:'include'}))` で全く同じ署名済みURLを叩いた
(TLSスタックは本物のChromium)。

```
$ node mint_and_probe.js
msToken len: 176
IN-BROWSER FETCH RESULT: {
  "status": 200,
  "bodyLen": 0,
  "bodyStart": ""
}
```

→ **本物のブラウザのTLSスタックを使ってもブロックされた**。この時点で、単純なTLS指紋の問題だけでなく
「OSSのX-Bogus署名自体が現行APIの検証ロジックに合っていない」可能性が濃厚と判断し、Step 4へ。

### Step 4 (根本原因の特定): TikTok自身が発行する内部リクエストを実際にキャプチャして比較

`scratchpad/native_search_probe.js` / `native_search_probe2.js` で、`https://www.tiktok.com/search?q=ramen%20tokyo`
に**通常のページ遷移**で移動し(TikTok自身のフロントエンドJSに検索APIを呼ばせる)、
`page.on('response')` / `page.on('request')` で実際に送信されたリクエストを丸ごとキャプチャした。

```
$ node native_search_probe.js
navigating to search page...
final URL: https://www.tiktok.com/search?q=ramen%20tokyo
captured search API calls: 1
---
url: https://www.tiktok.com/api/search/general/full/?WebIdLastTime=...
status: 200 bodyLen: 282684
bodyStart: {"status_code":0,"data":[{"type":1,"item":{"id":"7650052642089225493","desc":"日本一行列ができる屋台ラーメン🍜 ...
=== 可視テキスト(抜粋) ===
Top liked
1.1M  日本一行列ができる屋台ラーメン🍜  コージー≪Japanese Food≫
68.3K The best ramen I've ever eaten. Ichiran 📍 #ramen #tokyo #japan #japanfood  Polly Frier | Content Creator
=== video links found ===
[
  'https://www.tiktok.com/@koji_japanese_food/video/7650052642089225493',
  'https://www.tiktok.com/@pollyinparadise/video/7629270899274812694',
  'https://www.tiktok.com/@madvianne/video/7545356760177986846',
  ...
]
```

→ **これは成功した**(282KB、実データ)。つまりTikTok自身のフロントエンドJSが発行する「本物の」
検索リクエストは、この同じheadless Chromiumセッションで問題なく通る。ここで実際のリクエストURL/ヘッダを
`native_request_captured.json`に保存し、Step 2で使ったOSS版X-Bogus署名リクエストとの差分を確認した:

```
"X-Bogus=1"                       ← 固定のプレースホルダ値(!)。もはや検証に使われていない可能性が高い
"&X-Gnarly=MOWecpZt5rqB6yxtAoMDws..."  ← 長大なBase64様の別署名(クエリパラメータ)
"&X-Dynosaur=M/iLEZIli/BWJaXtXTOj..."  ← さらに別の署名らしきクエリパラメータ
```

OSS実装 `X-Bogus-1` はこの `X-Gnarly` / `X-Dynosaur` を生成する機能を持たない。つまりStep 2/3の
失敗は「TLSフィンガープリントだけが原因」ではなく、**そもそも送っていた署名(X-Bogusのみ)が
現行のTikTok Web APIが要求する検証(X-Gnarly/X-Dynosaur)を満たしていなかった**ことが根本原因だと判明した。

### Step 5 (最終確認): 100%正しい・キャプチャ直後の有効なURLでも、非ブラウザ再生では失敗する

では「正しい署名(X-Gnarly/X-Dynosaur込み)さえ持ち回れば軽量HTTPで通るのでは」を確認するため、
Step 4でキャプチャした**そのまま100%valid・数秒前に本物のブラウザが使った実URL・実ヘッダ**を、
同じCookieを添えてプレーンなNode `https`で即座にリプレイした。

```
$ node -e "... https.get(capturedUrl, {headers: capturedHeaders + Cookie}) ..."
STATUS 200
body length 0
body start
```

→ **署名・Cookie・ヘッダが完全に正しくても、非ブラウザ(Node https)クライアントからのリプレイは
即座にブロックされた(本文0バイト)**。これは署名の正しさとは独立に、TLS/HTTP2クライアント
フィンガープリント(JA3/JA4等、Akamai Bot Managerが典型的に使う仕組み)がブロック要因として
存在することの直接的な証拠。

## 評価まとめ

| 検証ステップ | 結果 |
|---|---|
| 実ブラウザで1回だけセッション確立(msToken/Cookie取得) | 成功(9 Cookie、msToken 176文字) |
| 実Cookie + OSS X-Bogus署名でNode https(非ブラウザ)リクエスト | 失敗(HTTP 200・本文0バイト) |
| 同一署名URLを実ブラウザ内`fetch()`(同一TLSスタック)で再試行 | 失敗(HTTP 200・本文0バイト) |
| TikTok自身の内部リクエストをキャプチャ(通常のページ遷移) | **成功**(282KBの実検索結果、実動画5件超取得) |
| キャプチャで判明: 現行APIは`X-Bogus`を無効化し`X-Gnarly`/`X-Dynosaur`を要求 | 確認済み。OSS実装は非対応 |
| 100%正しい実URL(X-Gnarly込み)を非ブラウザ(Node https)でリプレイ | 失敗(HTTP 200・本文0バイト) |

**このアイデア(セッション使い回し+軽量署名付きリクエスト)は成立しない。** 理由は2段構え:
(1) 参照したOSS署名ライブラリ(X-Bogus-1)は現行APIが要求する`X-Gnarly`/`X-Dynosaur`を生成できず
そもそも仕様が古い、(2) 百歩譲って完全に正しい署名を手に入れても、TLS/HTTPクライアント層の
フィンガープリンティングにより非ブラウザのHTTPクライアントからのリクエストはブロックされる。
test_planで想定していた「TLS偽装(curl-impersonate/curl_cffi)で切り分ける」ステップに進む前に、
そもそも署名アルゴリズム自体がOSSでは再現不能というより根本的な障壁が見つかったため、
この段階で「実運用不可」と判定するのが妥当と考える(X-Gnarly/X-Dynosaurの署名ロジックを
自前でリバースエンジニアリングするのは、TikTok側が難読化・頻繁な更新をしているVM/WASMベースの
コードであり、継続的なメンテナンスコストが非常に高く、本POCのスコープ外)。

一方で興味深い副産物として、**「Cookie/署名を持ち出して軽量クライアントで再現する」のではなく
「ブラウザにページ遷移させ、TikTok自身のJSに検索APIを呼ばせてレスポンスをただ横取りする」方式**
(Step 4の`native_search_probe.js`)は今回1クエリ・1回の試行では成功した。ただしこれは
「クエリ毎に実ブラウザ(ページナビゲーション)が必要」という点で当初のTikTokApi方式と同種の
コスト構造に戻ってしまい、本アイデアが目指していた「軽量HTTPで規模を稼ぐ」という優位性は失われる。
またこの1回の成功が継続的に再現するか(連続クエリでのレート制限/ブロック挙動)は本検証のスコープ外で
別アイデアとして扱うべきである。

## 検証に使用したスクリプト(scratchpad, 再現用)
- `mint_session.js`: 実ブラウザでCookie/msTokenを1回だけ取得
- `xbtest_realcookies.js`: 実Cookie + OSS X-Bogus署名で非ブラウザHTTPリクエスト
- `mint_and_probe.js`: 同一ブラウザ内`fetch()`での追試
- `native_search_probe.js` / `native_search_probe2.js`: TikTok自身の内部リクエストをキャプチャ
- 生成物: `mint_cookies.json`, `native_request_captured.json`, `xbtest_realcookies_response.json`
