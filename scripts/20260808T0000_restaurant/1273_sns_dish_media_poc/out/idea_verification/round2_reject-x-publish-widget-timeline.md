# idea検証: reject-x-publish-widget-timeline

**title**: [却下] X publish.twitter.comタイムラインウィジェット経由の既知アカウント投稿一覧取得
**判定**: **却下確定(実機再検証済み)**

## 実施内容と生の結果

### 1. publish.twitter.com/oembed はスタブHTMLのみ

```
$ curl -sS -L -o naver_oembed.json -w "HTTP %{http_code}, bytes=%{size_download}\n" \
  "https://publish.twitter.com/oembed?url=https://twitter.com/naver_jp"
HTTP 200, bytes=429
{"url":"https:\/\/x.com\/naver_jp","title":"","html":"<a class=\"twitter-timeline\" href=\"https:\/\/x.com\/naver_jp?ref_src=twsrc%5Etfw\">Posts by naver_jp</a>\n<script async src=\"https:\/\/platform.x.com\/widgets.js\" charset=\"utf-8\"></script>\n", ...}

$ curl -sS -L -o sbux_oembed.json -w "HTTP %{http_code}, bytes=%{size_download}\n" \
  "https://publish.twitter.com/oembed?url=https://twitter.com/Starbucks_J"
HTTP 200, bytes=438
{"url":"https:\/\/x.com\/Starbucks_J","title":"","html":"<a class=\"twitter-timeline\" href=\"https:\/\/x.com\/Starbucks_J?ref_src=twsrc%5Etfw\">Posts by Starbucks_J</a>\n<script async src=\"https:\/\/platform.x.com\/widgets.js\" charset=\"utf-8\"></script>\n", ...}
```

naver_jp・Starbucks_Jの2アカウントとも、`html`フィールドは埋め込み用の
`<a class="twitter-timeline">` + `<script src=widgets.js>` というスタブに過ぎず、投稿本文・投稿ID・
メディアURL等のデータは一切含まれない。仮説の記述どおり。

### 2. cdn.syndication.twimg.com/timeline/profile は空応答(HTTP 200, Content-Length 0)

実際のウィジェット動作ではブラウザ上でwidgets.jsが `timeline/profile?screen_name=...` を
内部的に叩く想定だが、UA/Referer/クエリパラメータを変えた3パターンで再現を試みたところ、
いずれも **HTTP 200 かつ body 0バイト** だった。

```
=== 3a. plain UA, no Referer ===
$ curl -sSv "https://cdn.syndication.twimg.com/timeline/profile?screen_name=naver_jp&lang=ja" \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ... Chrome/120.0 Safari/537.36"
< HTTP/2 200
< access-control-allow-origin: https://platform.twitter.com
< content-length: 0
body bytes: 0

=== 3b. UA + Referer=platform.x.com ===
$ curl -sSv "https://cdn.syndication.twimg.com/timeline/profile?screen_name=naver_jp&lang=ja&dnt=false" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ... Safari/605.1.15" \
  -H "Referer: https://platform.x.com/"
< HTTP/2 200
< access-control-allow-origin: https://platform.twitter.com
< content-length: 0
body bytes: 0

=== 3c. 別アカウント(Starbucks_J) + 追加パラメータ(dnt/showReplies) + Referer=twitter.com ===
$ curl -sS "https://cdn.syndication.twimg.com/timeline/profile?screen_name=Starbucks_J&lang=ja&dnt=true&showReplies=false" \
  -H "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15" \
  -H "Referer: https://twitter.com/"
HTTP 200, bytes=0
```

3パターンいずれも `access-control-allow-origin: https://platform.twitter.com` というCORSヘッダは
返るものの、body自体が空(content-length: 0)。screen_nameやUA/Refererの違いによらず一貫して空応答。

### 3. サニティチェック: 同一環境からsyndication host自体には到達できている

`timeline/profile` の空応答が「このセッションからcdn.syndication.twimg.comに到達できていないだけ」
という可能性を排除するため、Round1/Round2で実測済みの `tweet-result`(単体ツイート取得)エンドポイントを
同一環境から再実行し、正常に動作することを確認した:

```
$ curl -sS "https://cdn.syndication.twimg.com/tweet-result?id=1745657674497483022&token=abc" \
  -w "HTTP %{http_code}, bytes=%{size_download}\n"
HTTP 200, bytes=3373
{"__typename":"Tweet","favorite_count":1677,"lang":"ja",...,"text":"はま寿司には、お寿司に集中できる...
```

同一ホスト・同一curl環境で `tweet-result`(id+token指定の単体ツイート取得)は3373バイトの正常な
構造化JSONを返すのに対し、`timeline/profile`(screen_name指定のタイムライン一覧取得)は一貫して
0バイト。ホスト到達性の問題ではなく、エンドポイント仕様上「id+token方式のみ有効、screen_name方式は
無効化されている」ことを裏付ける結果。

## 結論

- **仮説どおり却下確定**。`publish.twitter.com/oembed` は埋め込み用スタブHTML(`<a class="twitter-timeline">`
  + `widgets.js`)しか返さず、投稿データそのものは一切含まれない(naver_jp, Starbucks_Jの2アカウントで確認)。
- `cdn.syndication.twimg.com/timeline/profile?screen_name=...` は、UA/Referer/クエリパラメータを
  3パターン変えて試行したが、いずれもHTTP 200・Content-Length 0の空応答で機能しなかった
  (naver_jp, Starbucks_Jの2アカウントで確認)。同一環境から `tweet-result`(id+token方式)は
  正常に3373バイトのJSONを返すことをサニティチェックで確認しており、これは環境側のネットワーク
  問題ではなく、`timeline/profile`(screen_name方式)エンドポイント自体が無効化/廃止されていることを
  示す。
- Web二次情報(shkspr.mobiの解析記事)の「cdn.syndication.twimg.comはid+tokenを指定した単一ツイート
  取得(tweet-result)専用であり、ユーザー名指定でタイムライン一覧を無認証取得する方法は存在しない」
  という記述と実測結果が一致した。
- Round1で確定済みの「Xのguest search endpointは404で廃止確認済み」、および
  `x-syndication-widget-reverse-engineering.md` で確認済みの「x.com/searchは未ログインでSSRなし」
  と合わせ、Xについては (a) キーワード検索によるDiscovery、(b) 既知アカウントの投稿一覧取得による
  Route A のいずれも無料では技術的に閉じていることが再確認された。
- `tweet-result` 単体エンドポイント(id+token指定)による個別ツイートのEnrichmentは引き続き有効
  (Round1: 5/5成功、本検証でも1件追加再現)だが、これはあくまで「既に分かっているツイートIDの詳細取得」
  であり「アカウントの投稿一覧化」ではない点は変わらない。

**総合判定: 却下確定。Round3以降での再調査は不要。**

## 実行コマンド一覧(再現用)

```bash
curl -sS -L -o naver_oembed.json -w "HTTP %{http_code}, bytes=%{size_download}\n" \
  "https://publish.twitter.com/oembed?url=https://twitter.com/naver_jp"

curl -sS -L -o sbux_oembed.json -w "HTTP %{http_code}, bytes=%{size_download}\n" \
  "https://publish.twitter.com/oembed?url=https://twitter.com/Starbucks_J"

curl -sSv "https://cdn.syndication.twimg.com/timeline/profile?screen_name=naver_jp&lang=ja" \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36" \
  -w "HTTP %{http_code}, bytes=%{size_download}\n"

curl -sSv "https://cdn.syndication.twimg.com/timeline/profile?screen_name=naver_jp&lang=ja&dnt=false" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15" \
  -H "Referer: https://platform.x.com/" \
  -w "HTTP %{http_code}, bytes=%{size_download}\n"

curl -sS "https://cdn.syndication.twimg.com/timeline/profile?screen_name=Starbucks_J&lang=ja&dnt=true&showReplies=false" \
  -H "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15" \
  -H "Referer: https://twitter.com/" \
  -w "HTTP %{http_code}, bytes=%{size_download}\n"

# サニティチェック(同一環境で正常動作するエンドポイント)
curl -sS "https://cdn.syndication.twimg.com/tweet-result?id=1745657674497483022&token=abc" \
  -w "HTTP %{http_code}, bytes=%{size_download}\n"
```
