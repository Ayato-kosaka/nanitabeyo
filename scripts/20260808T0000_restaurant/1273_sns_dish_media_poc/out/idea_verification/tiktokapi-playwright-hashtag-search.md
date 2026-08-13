# アイデア検証: tiktokapi-playwright-hashtag-search

## 結論: 動作しなかった (DOES NOT WORK)

davidteather/TikTokApi (v7.3.3, Playwright駆動) は、`headless=True`だけでなく`headless=False`
(Xvfb実ディスプレイ経由)でも、hashtag検索・keyword検索の両方が**100%ブロック**された。
コード自体は正常に動作しており(セッション確立・署名生成は成功)、TikTok側サーバーが
署名済みリクエストに対して空レスポンスを返す形でボットを検知していることをソースコードレベルでも
確認した。「無料だが実運用に耐えない」という当初の仮説通り、headless=Falseにしても歩留まりは
改善しなかった。

## セットアップ(既実施分の再確認)

```
PY311=.../scratchpad/py311/python/bin/python3
$PY311 -m pip show TikTokApi playwright
```
→ `TikTokApi 7.3.3`, `playwright 1.62.0` がインストール済みであることを確認。

## 実行内容と生の結果

### 1. ベースライン再確認: headless=True, browser='chromium'
```
$PY311 test_tiktokapi2.py chromium true
```
→ `session created OK` (セッション確立は成功)。しかしその後の全呼び出しが同一の
`EmptyResponseException`で失敗:
```
search(item) FAILED: EmptyResponseException("TikTok returned an empty response.
  They are detecting you're a bot, try some of these: headless=False, browser='webkit',
  consider using a proxy")
hashtag[ramen]    FAILED: EmptyResponseException(... 同上 ...)
hashtag[sushi]    FAILED: EmptyResponseException(... 同上 ...)
hashtag[yakiniku] FAILED: EmptyResponseException(... 同上 ...)
hashtag[curry]    FAILED: EmptyResponseException(... 同上 ...)
hashtag[udon]     FAILED: EmptyResponseException(... 同上 ...)
```
→ **6/6 (100%) ブロック**(search 1件 + hashtag 5件)。

なお、以前のtest_tiktokapi.pyで使っていた`api.search.videos(...)`は現行バージョンの
`Search`クラスに存在しない属性であることをソース(`TikTokApi/api/search.py`)で確認した。
正しい呼び出しは`api.search.search_type(term, "item", count=...)`(内部的に
`https://www.tiktok.com/api/search/item/full/`を叩く)であり、今回はこちらで再検証した。
結果は同じくブロックだった。

### 2. headless=False (Xvfb実ディスプレイ) での再検証

サンドボックスにXvfbが未導入だったため追加インストール:
```
apt-get install -y xvfb
```
→ 成功 (`xvfb 2:1.20.4-1+deb10u14`ほか依存パッケージ導入完了、`/usr/bin/xvfb-run`利用可能に)。

```
xvfb-run -a $PY311 test_tiktokapi2.py chromium false
```
→ `session created OK`(実ディスプレイ上でのブラウザ起動も成功)。しかし結果は同一:
```
search(item) FAILED: EmptyResponseException("... detecting you're a bot ...")
hashtag[ramen]    FAILED: EmptyResponseException(... 同上 ...)
hashtag[sushi]    FAILED: EmptyResponseException(... 同上 ...)
hashtag[yakiniku] FAILED: EmptyResponseException(... 同上 ...)
hashtag[curry]    FAILED: EmptyResponseException(... 同上 ...)
hashtag[udon]     FAILED: EmptyResponseException(... 同上 ...)
```
→ こちらも **6/6 (100%) ブロック**。headless=Falseにしても改善は一切観測されなかった
(通算 12/12 呼び出しが失敗)。

### 3. browser='webkit' への切替 — サンドボックス制約で未検証

```
$PY311 -m playwright install webkit
$PY311 -m playwright install-deps webkit
```
→ webkitバイナリのダウンロードは成功したが、依存ライブラリのインストールで失敗:
```
E: Unable to locate package libicu74
E: Unable to locate package libatk-bridge2.0-0t64
E: Unable to locate package libatk1.0-0t64
E: Unable to locate package libglib2.0-0t64
... (計10種以上のt64/新世代パッケージ名が見つからない)
Failed to install browser dependencies
```
→ 本サンドボックスのOSがDebian 10 (buster, 2019年リリース)であり、Playwright最新版が要求する
WebKitビルドはDebian 12/Ubuntu 24以降のパッケージ命名規則(`libicu74`, `*-t64`等)に依存しているため、
このOS上では原理的にインストール不可能。これは仮説の成否とは無関係な**環境側の制約**であり、
「webkitなら回避できるか」は本検証では判定不能(未検証)。

### 4. ソースコード確認によるブロックの発生箇所の特定

`TikTokApi/tiktok.py`の`make_request()`を読むと、`EmptyResponseException`は
ブラウザページ内で実行した`fetch()`(`run_fetch_script`)の戻り値が**空文字列そのもの**だった場合に
発生する(JSONパースエラーではなくレスポンスボディが空)。これはmsToken取得やライブラリ側の
実装不備ではなく、**TikTok側のエッジ/WAFが署名済みリクエストに対して意図的に空応答を返している**
ことを示す。つまりCDPベースの自動操作(Playwright)自体をフィンガープリンティングで検知しており、
`headless`フラグの真偽やXvfbの有無では回避できないブロックだと確認できた。

## 評価まとめ

| 検証項目 | 結果 |
|---|---|
| TikTokApi + Playwright(chromium, headless=True)のセッション確立 | 成功 |
| chromium, headless=True でのhashtag/search呼び出し | 6/6 (100%) ブロック (EmptyResponseException) |
| Xvfb導入 (`apt-get install -y xvfb`) | 成功 |
| chromium, headless=False(Xvfb)でのhashtag/search呼び出し | 6/6 (100%) ブロック (改善なし) |
| browser='webkit' への切替 | 未検証(サンドボックスOSがDebian10で新パッケージ名に非対応のため依存関係インストール不可) |
| ブロックの発生原理 | ソース確認により、TikTok側が空レスポンスで自動化ブラウザを検知していると特定 |

コア仮説(「実ブラウザ経由なら正規トークンで内部APIを通せる可能性がある」)は、少なくとも
chromium(headless=True/False いずれも)では**通算12/12呼び出しが100%ブロック**され支持されなかった。
費用は確かに無料(自前Chromium+CPUのみ、課金APIは一切呼んでいない)だが、歩留まりが実質ゼロのため
Discovery手段としては現状使えない。`browser='webkit'`のみサンドボックス環境の制約(古いDebian 10ベース)
により検証不能なまま残っており、それを試すには本サンドボックス外(新しいOSイメージ/コンテナ)での
追試が必要。既存のyt-dlp検証結果(TikTokキーワード/ハッシュタグ検索は`tiktok:tag`が
"CURRENTLY BROKEN")と合わせて、「TikTokの無料キーワード/ハッシュタグ検索は現時点でどの無料手段でも
実現できていない」という結論を補強する結果となった。
