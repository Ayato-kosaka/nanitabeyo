# idea検証: x-syndication-widget-reverse-engineering

**title**: X (Twitter) 埋め込みウィジェットの内部API (cdn.syndication.twimg.com) の逆用
**判定**: 部分的に確認 — **Enrichment(既知ID→詳細データ取得)は完全に動作を再現確認できた**。
**Discovery(キーワード→ツイートURL発見)側はセッション内で検証不能(ブロック)** — 理由は
`managed-serp-api-google-cse-bypass.md` と同種で、ログインセッション取得やAPIキー発行に
実ブラウザでのアカウント作成/サインアップ操作が必須なのに対し、本セッションには
ブラウザ操作ツール(Chrome MCP等)が存在せず読み取り専用の `WebFetch` しか無いため。

## 実施内容と生の結果

### 1. Enrichment単体の再現性確認(既知の飲食系ツイートID 5件)

`out/x_oembed_2026-08-12.json` で oEmbed 検証済みの5件と**同一のツイートID**を
`cdn.syndication.twimg.com/tweet-result` に投げ、ヘッダ無し・ダミートークン(`token=abc`)のみで
5/5が **HTTP 200** で構造化JSONを返した(oEmbedと同じ成功率だが、oEmbedは埋め込み用HTMLの
断片しか返さないのに対し、syndication APIは本文全文・メディアURL・投稿者情報まで生データで返す):

```
$ curl -s -o t.json -w "HTTP %{http_code}\n" "https://cdn.syndication.twimg.com/tweet-result?id=1707234985613447357&token=abc"
HTTP 200
```

| tweet id | account | HTTP | text冒頭 | mediaDetails |
|---|---|---|---|---|
| 1707234985613447357 | mutenkurasushi(無添くら寿司) | 200 | "拡大して見れる！大きい画像は..." | photo x2: `pbs.twimg.com/media/F7FQ4yNb0AAtj-p.jpg` ほか |
| 1658970659878502400 | kappasushi_jp(かっぱ寿司) | 200 | "／▶️#ホロライブ×#かっぱ寿司..." | なし(テキストのみツイート) |
| 1745657674497483022 | hamasushi_jp(はま寿司) | 200 | "はま寿司には、お寿司に集中..." | photo x2: `pbs.twimg.com/media/GDnSZzfbAAABBfr.jpg` ほか |
| 1645341149677371392 | jiro_kame(ラーメン二郎亀戸店) | 200 | "当店も無言で店内や厨房や..." | なし(引用RTのみのテキスト投稿) |
| 2076222728387043819 | rui_moulin2(一般ユーザー) | 200 | "最近のお寿司🍣" | photo x1: `pbs.twimg.com/media/HNA5kArbMAAaW-F.jpg` |

実データ例(はま寿司公式、photo media URL込み):

```json
{
  "id_str": "1745657674497483022",
  "text": "はま寿司には、お寿司に集中できるカウンター席もございます。ぜひお気軽にお寿司をお楽しみください🍣✨\n\n#はま寿司 https://t.co/Ig0Od3g9lN",
  "user": {"name": "はま寿司【公式】", "screen_name": "hamasushi_jp"},
  "mediaDetails": [
    {"type": "photo", "media_url_https": "https://pbs.twimg.com/media/GDnSZzfbAAABBfr.jpg"},
    {"type": "photo", "media_url_https": "https://pbs.twimg.com/media/GDnSZzqawAAMtu-.jpg"}
  ]
}
```

`Referer` ヘッダは付与せず(curlのデフォルトヘッダのみ)、全件成功。追加検証として `id=20`
(jackの最初のツイート)でも従来通り200 OKを再確認し、また既知情報にある「Discovery非対応の
Enrichment専用エンドポイント」という性質どおり `id=1`(未使用の低ID)や存在しないIDでは
一貫して **HTTP 404** を返すことも確認した。→ **既存の知見(実測済み)を追加5件で再現し、
本文全文・画像URLまで含む有用な構造化データであることを新たに確認**。

### 2. Discovery側(ログインセッション方式)の実現性切り分け

**(a) x.com/search を未ログインで取得 → SSRなしを再確認**

```
$ curl -s -A "Mozilla/5.0 ..." -o search_page.html -w "HTTP %{http_code}, bytes=%{size_download}\n" \
  "https://x.com/search?q=ラーメン%20渋谷&src=typed_query"
HTTP 200, bytes=275031
```

HTML中に `status/[0-9]+` のパターンは **0件**。`<div id="react-root">` の中身は
`aria-label="Loading…"` のプレースホルダのみで、SSRされた検索結果は一切含まれない
(=JSアプリシェルのみが返るという既知情報を再現)。

**(b) guest token方式(旧Nitter方式)の再確認**

```
$ curl -s -X POST "https://api.twitter.com/1.1/guest/activate.json" -H "Authorization: Bearer <public bearer>"
HTTP 200 -> {"guest_token":"2087805933304852628"}

$ curl -s "https://api.twitter.com/1.1/search/adaptive.json?q=ramen" -H "Authorization: Bearer <public bearer>" -H "x-guest-token: 2087805933304852628"
HTTP 404
```

guest tokenの発行自体は今も無料・無認証で通るが、検索エンドポイント`search/adaptive.json`は
**404(エンドポイント自体が廃止)** で、既知情報どおり無認証guest tokenでの検索は不可能と再確認した。

**(c) GraphQL SearchTimeline を guest token のみ(ログインCookie無し)で試行**

```
$ curl -s "https://twitter.com/i/api/graphql/gkjsKepM6gl_HmFWoWKfgg/SearchTimeline?variables=...&features=..." \
  -H "Authorization: Bearer <public bearer>" -H "x-guest-token: <取得済みguest_token>"
HTTP 404
```

GraphQLの`queryId`(この例では`gkjsKepM6gl_HmFWoWKfgg`)はXのJSバンドルごとに変動するハッシュ値で、
実ブラウザのネットワークタブから最新値を採取しないと正しいIDが分からない。本セッションには
ブラウザ操作手段が無いため正しい`queryId`を採取できず、この404はエンドポイント不在の確定的な
証拠にはならない(=queryId不一致の可能性がある)。ただし、**より本質的な問題として test_plan (2)(a)
「使い捨てX無料アカウントを作成しCookie(auth_token, ct0)を取得する」がそもそも本セッション内で
実行不可能**であることを以下で確認した:

```
$ ToolSearch query="browser chrome playwright screenshot interactive"
→ 該当ツールなし。利用可能なのは読み取り専用の WebFetch のみ
  (フォーム送信・メール確認・SMS認証・CAPTCHA突破が一切できない)。
```

これは `managed-serp-api-google-cse-bypass.md` で確認済みの「SerpApi/Serper.devのサインアップに
ブラウザ操作が必須」という制約と**全く同じ壁**であり、Xアカウント作成(メール確認 or 電話番号SMS認証、
場合によりCAPTCHA)は自動化手段では突破できない。よって(2)以降の「実ログインセッションでの
GraphQL検索」「134カテゴリ相当の連続リクエストでのレート制限計測」は**未実施(実行不能)**。

### 3. 代替Discovery(検索エンジン経由)の予備確認

test_planで提案されている代替(Google CSE有効化後 / Brave Search API無料枠)についても、
少なくともBrave Search APIは即座にAPIキー必須と確認できた:

```
$ curl -s -o brave.json -w "HTTP %{http_code}\n" "https://api.search.brave.com/res/v1/web/search?q=test"
HTTP 422
{"error":{"code":"VALIDATION","detail":"Unable to validate request parameter(s)",
 "meta":{"errors":[{"loc":["header","x-subscription-token"],"msg":"Field required"}]}}}
```

キー無しでは422(パラメータ不足=キー必須)。Brave APIキーの取得もアカウント作成(ブラウザ操作)が
前提であり、Google CSE(403で権限不足、GCP Console操作が必要)と同種の「人間のブラウザ操作が必要」
という壁に行き着く。この点はすでに`managed-serp-api-google-cse-bypass.md`で報告済みの制約と重複するため、
本ファイルでは深掘りせず既知の結論を再確認するに留めた。

## 結論

- **Enrichment(仮説の核心部分)は実機で完全に再現・確認できた**: 既知の飲食系ツイートID
  (くら寿司/かっぱ寿司/はま寿司/ラーメン二郎亀戸店/一般ユーザーの計5件、oEmbedと同一サンプル)全てで
  `cdn.syndication.twimg.com/tweet-result?id=<ID>&token=abc` が認証・Referer無しでHTTP 200を返し、
  本文全文・投稿者情報に加え、oEmbedでは取得できない**メディアの直リンクURL(photo)**まで構造化JSONで
  取得できた。これは「既知のツイートURL/IDがあればX Search API課金なしに詳細情報を取れる」という
  仮説の主張どおりであり、oEmbedの上位互換として有効に機能する。
- 一方で **Discovery側(キーワード→URL発見)は本セッションでは実質的に検証不能**。
  - guest token方式は仮説どおり死んでいる(`search/adaptive.json`は404)ことを再確認。
  - x.com/searchは未ログインではSSRなしのJSアプリシェルのみ(仮説どおり)。
  - ログインセッション方式(GraphQL SearchTimeline)は、その前提となる「使い捨てXアカウントの作成」
    自体がブラウザ操作(メール確認/SMS認証/CAPTCHA)を要求するため、本セッションのツールセット
    (読み取り専用WebFetchのみ、Chrome MCP等の対話的ブラウザ操作ツール無し)では実行できない。
  - 代替の検索エンジン経由Discovery(Google CSE / Brave Search API)も、キー発行にブラウザでの
    サインアップが必要という同一の壁にあたることを追加確認した。
- **総合判定**: 仮説の「Enrichmentは無料・無認証で動く」という部分は**確定的にTRUE**(実データで再現済み)。
  「Discoveryはログインセッションor検索エンジンで代替できる」という部分は**環境制約により未検証
  (technical rejectではなくblocked)**。次アクションとしては、人間オペレーターが(a)使い捨てXアカウントを
  ブラウザで作成しCookieを`.env`に渡す、または(b)Google CSE有効化 / Brave APIキー発行のいずれかを行えば、
  即座にDiscovery側のend-to-end検証(検索→ID抽出→syndication APIでEnrichment)を再開できる状態にある。
  それまでの間、**Enrichment単体(oEmbedの上位互換としてmediaDetails付きJSONを無料取得)は現状のPoC
  パイプラインにそのまま組み込んで良い**と判断できる。

## 実行コマンド一覧(再現用)

```bash
curl -s -o t20.json -w "HTTP %{http_code}\n" "https://cdn.syndication.twimg.com/tweet-result?id=20&token=abc"
curl -s -o food.json -w "HTTP %{http_code}\n" "https://cdn.syndication.twimg.com/tweet-result?id=1707234985613447357&token=abc"
curl -s -o food.json -w "HTTP %{http_code}\n" "https://cdn.syndication.twimg.com/tweet-result?id=1658970659878502400&token=abc"
curl -s -o food.json -w "HTTP %{http_code}\n" "https://cdn.syndication.twimg.com/tweet-result?id=1745657674497483022&token=abc"
curl -s -o food.json -w "HTTP %{http_code}\n" "https://cdn.syndication.twimg.com/tweet-result?id=1645341149677371392&token=abc"
curl -s -o food.json -w "HTTP %{http_code}\n" "https://cdn.syndication.twimg.com/tweet-result?id=2076222728387043819&token=abc"

curl -s -A "Mozilla/5.0" -o search_page.html -w "HTTP %{http_code}, bytes=%{size_download}\n" \
  "https://x.com/search?q=ラーメン%20渋谷&src=typed_query"

curl -s -X POST "https://api.twitter.com/1.1/guest/activate.json" \
  -H "Authorization: Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"
curl -s "https://api.twitter.com/1.1/search/adaptive.json?q=ramen" \
  -H "Authorization: Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA" \
  -H "x-guest-token: <取得したguest_token>"

curl -s -o brave.json -w "HTTP %{http_code}\n" "https://api.search.brave.com/res/v1/web/search?q=test"
```
