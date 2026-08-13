# idea検証: tiktok-user-extractor-known-handle

**title**: yt-dlp `tiktok:user` エクストラクタ(既知ハンドル→動画一覧、部分成功)
**判定**: **combine_with_others確定(補完チャネルとして限定採用)、ただし仮説の一部を修正**

## 実施内容と生の結果

### 1. 基本再現(Round1のyoshinoya_official / mcdonaldsjapan / official.sukiya.com)

```
$ PY=/tmp/claude-0/.../scratchpad/py311/python/bin/python3
$ $PY /tmp/yt-dlp-latest --version
2026.07.04

$ $PY /tmp/yt-dlp-latest --flat-playlist --dump-json "https://www.tiktok.com/@yoshinoya_official" | wc -l
62   (real 0m8.4s)

$ $PY /tmp/yt-dlp-latest --flat-playlist --dump-json "https://www.tiktok.com/@mcdonaldsjapan" | wc -l
206  (real 0m16.9s)

$ $PY /tmp/yt-dlp-latest --flat-playlist --dump-json "https://www.tiktok.com/@official.sukiya.com" | wc -l
0    (real 0m3.2s)
ERROR: [tiktok:user] official.sukiya.com: Unable to extract secondary user ID. ...
```

Round1の実測(206件/62件/エラー)を完全再現した。仮説どおり。

### 2. 既知ハンドル群での成功率測定 — ただし「ハンドルが実在するか」を先に検証する必要があった

test_planに沿って店舗チェーンのTikTokハンドル候補20件を用意し、`--flat-playlist --dump-json`を
逐次実行した(タイムアウトの都合で18/20件が完走)。

| # | handle | rc | 動画件数 | エラー種別 |
|---|---|---|---|---|
| 1 | yoshinoya_official | 0 | 62 | - |
| 2 | mcdonaldsjapan | 0 | 206 | - |
| 3 | official.sukiya.com | 1 | 0 | Unable to extract secondary user ID |
| 4 | sukiya_jp | 1 | 0 | 同上 |
| 5 | matsuyafoods | 1 | 0 | 同上 |
| 6 | nakau_official | 1 | 0 | 同上 |
| 7 | kfc_japan | 1 | 0 | 同上 |
| 8 | starbucks_j | 0 | 158 | - |
| 9 | domino_japan | 1 | 0 | 同上 |
| 10 | pizzahut_jp | 1 | 0 | 同上 |
| 11 | cocoichi_official | 1 | 0 | 同上 |
| 12 | tullys_coffee_jp | 1 | 0 | 同上 |
| 13 | mos_burger | 1 | 0 | 同上 |
| 14 | freshnessburger | 1 | 0 | 同上 |
| 15 | subway_japan | 1 | 0 | 同上 |
| 16 | gusto_official | 1 | 0 | 同上 |
| 17 | saizeriya_jp | 1 | 0 | 同上 |
| 18 | bikkuridonkey | 1 | 0 | 同上 |

見かけ上の成功率は3/18(17%)だが、この18件のうち何件がそもそも実在するTikTokアカウントなのか
不明という問題があった(推測で作ったハンドルが多数含まれる)。これを切り分けるため、認証不要で
軽量な`https://www.tiktok.com/oembed?url=https://www.tiktok.com/@<handle>`(TikTok公式oEmbed API)
で実在確認を行った:

```
$ for h in yoshinoya_official mcdonaldsjapan official.sukiya.com sukiya_jp matsuyafoods \
    nakau_official kfc_japan starbucks_j domino_japan pizzahut_jp cocoichi_official \
    tullys_coffee_jp mos_burger freshnessburger subway_japan gusto_official saizeriya_jp bikkuridonkey; do
    curl -s -o /dev/null -w "%{http_code}\n" "https://www.tiktok.com/oembed?url=https://www.tiktok.com/@$h"
  done
```

結果: HTTP 200(実在)= yoshinoya_official, mcdonaldsjapan, official.sukiya.com, matsuyafoods,
kfc_japan, starbucks_j, freshnessburger, gusto_official の8件。HTTP 400(非実在/無効)=残り10件
(sukiya_jp, nakau_official, domino_japan, pizzahut_jp, cocoichi_official, tullys_coffee_jp,
mos_burger, subway_japan, saizeriya_jp, bikkuridonkey)。

**実在確認済み8件だけで再集計すると、成功は3/8(37.5%)、失敗は5/8(62.5%)。** つまり
「Unable to extract secondary user ID」は「ハンドルが存在しない」ケースと「ハンドルは実在するが
抽出が失敗する」ケースを区別なく同じメッセージで返しており、後者(実在アカウントの抽出失敗)だけを
見ると仮説記載の「n=3で成功2/失敗1」よりも悪い、過半数が失敗する不安定な挙動だと判明した。
(oEmbed APIは公式でレート制限も緩く、動画一覧は取れないがハンドル実在確認と表示名取得には
そのまま使える副産物としても有用 — `author_name`フィールドに日本語店舗名が返る。例:
yoshinoya_official→"吉野家", mcdonaldsjapan→"マクドナルド", official.sukiya.com→
"すき家 【公式】🐂→🥩"。)

失敗5件(official.sukiya.com, matsuyafoods, kfc_japan, freshnessburger, gusto_officialの
実在アカウント)を追加で2回ずつ再実行したところ、全て3/3で同一エラーが決定論的に再現した
(非決定的な一時失敗ではない)。同様に成功3件も3/3で件数一致して再現した(yoshinoya_official=62,
mcdonaldsjapan=206, starbucks_j=158)。→ **アカウント単位で成功/失敗が固定される安定した二極化**
であり、リトライで救済できるものではない。

### 3. 失敗要因の切り分け: 生HTML直curlとの比較

```
$ curl -s -L "https://www.tiktok.com/@yoshinoya_official" -H "User-Agent: Mozilla/5.0 ... Chrome/126" \
    -o html_yoshinoya.html -w "HTTP:%{http_code} size:%{size_download}\n"
HTTP:200 size:1462
$ grep -o "Please wait" html_yoshinoya.html
Please wait

$ curl -s -L "https://www.tiktok.com/@official.sukiya.com" -H "User-Agent: Mozilla/5.0 ... Chrome/126" \
    -o html_sukiya.html -w "HTTP:%{http_code} size:%{size_download}\n"
HTTP:200 size:1462
$ grep -o "Please wait" html_sukiya.html
Please wait
```

成功アカウント(yoshinoya_official)・失敗アカウント(official.sukiya.com)のどちらも、生HTML直curlは
常に同一の1462byte WAFチャレンジページ(`Please wait...`)しか返さない。仮説どおり、成功/失敗は
生HTML取得の可否とは無関係で、yt-dlpの`tiktok:user`エクストラクタが使う内部APIパス側の応答が
アカウントごとに異なることが原因と確認できた。

### 4. curl_cffiインパーソネーション検証 — 想定と異なる重大な副作用を発見

`--list-impersonate-targets`を確認すると、サンドボックスに入っていた`curl_cffi==0.16.0`は
yt-dlp側で「unsupported」扱いだった:

```
$ $PY /tmp/yt-dlp-latest --verbose --list-impersonate-targets 2>&1 | grep "Optional libraries"
[debug] Optional libraries: certifi-..., curl_cffi-0.16.0 (unsupported), requests-..., ...
Client    OS   Source
Tor       -    curl_cffi>=0.11 (unavailable)
Chrome    -    curl_cffi (unavailable)
...(全てunavailable)
```

yt-dlpのソース(`yt_dlp/networking/_curlcffi.py`)を確認すると、対応バージョンが明示的に
ハードコードされていた:

```python
if curl_cffi_version != (0, 5, 10) and not (0, 10) <= curl_cffi_version < (0, 16):
    curl_cffi._yt_dlp__version = f'{curl_cffi.__version__} (unsupported)'
    raise ImportError('Only curl_cffi versions 0.5.10 and 0.10.x through 0.15.x are supported')
```

PyPIには0.15.0以下が存在したため、`pip install curl_cffi==0.15.0`にダウングレードしたところ
`--list-impersonate-targets`は36種類のブラウザプロファイルを正常に列挙し、`--impersonate chrome`が
機能する状態になった。curl_cffi自体の直接呼び出し(`from curl_cffi import requests; requests.get(...,
impersonate='chrome')`)もHTTP 200を返し、ライブラリ自体は動作していた(ただし内容はHTML直curlと
同じ1462byteのWAFチャレンジページで、生HTML取得としてはimpersonateしても素通りできなかった)。

ここで**当初の仮説が想定していなかった重大な副作用**を発見した。curl_cffi==0.15.0を入れた状態で
`--impersonate chrome`付きで再テストしたところ、失敗ケースが救済されるどころか、**元々成功していた
yoshinoya_officialまで失敗するようになった**:

```
$ $PY /tmp/yt-dlp-latest --impersonate chrome --flat-playlist --dump-json "https://www.tiktok.com/@yoshinoya_official"
ERROR: [tiktok:user] yoshinoya_official: Unable to extract secondary user ID. ...
```

さらに検証を進めると、`--impersonate`フラグを付けなくても、**curl_cffi==0.15.0がインストール
されているだけ**でyt-dlpの挙動が変わり、同じyoshinoya_officialが失敗することが分かった:

```
$ $PY /tmp/yt-dlp-latest --flat-playlist --dump-json "https://www.tiktok.com/@yoshinoya_official"
WARNING: [tiktok:user] 7577263161934368007: Unexpected response from webpage request
... (10回同様の警告)
ERROR: [tiktok:user] yoshinoya_official: Unable to extract secondary user ID. ...
```

`--verbose`で確認すると、curl_cffiが「supported」と判定される版が入っているだけで
Request Handlersの構成が変わっていた:

```
curl_cffi==0.16.0(unsupported)時: [debug] Request Handlers: urllib, requests
curl_cffi==0.15.0(supported)時  : [debug] Request Handlers: urllib, requests, curl_cffi
```

yt-dlp内部の`curl_cffi_preference()`ロジックにより、curl_cffiが利用可能だと`tiktok:user`
エクストラクタが優先的にcurl_cffi経路を選ぶようになるが、**その経路自体がTikTok側でうまく
機能せず、むしろ以前は動いていたurllib/requests経路より劣化する**という逆説的な結果になった。

`curl_cffi`を再度`0.16.0`(unsupported)へ戻すと、yoshinoya_officialは即座に62件で復帰した
(3回連続再現、リグレッションではなくバージョン依存の挙動と確認)。

```
$ $PY -m pip install --quiet "curl_cffi==0.16.0"
$ $PY /tmp/yt-dlp-latest --flat-playlist --dump-json "https://www.tiktok.com/@yoshinoya_official" | wc -l
62
```

**結論としてtest_plan 4)の問いへの回答は「NO、むしろ逆」。** curl_cffiインパーソネーションを
有効化しても失敗ケースは救済されず、有効化そのものが成功ケースを壊す副作用を持つ。運用上の
含意として、**yt-dlpのrequirements.txt側でcurl_cffiを一切インストールしない、または
0.16.0以降(=yt-dlpにとってunsupported)に固定する**ことが、現状観測できている最良の成功率を
維持する条件になる。逆に何も考えずに最新の`curl_cffi`をrequirements.txtに追加すると、無言で
成功率が悪化するリグレッションを踏む恐れがある。

### 5. スループット測定

成功ハンドル(yoshinoya_official, 62件の動画メタデータを含むフル応答)を5回連続で逐次実行:

```
$ time (for i in 1 2 3 4 5; do $PY /tmp/yt-dlp-latest --flat-playlist --dump-json \
    "https://www.tiktok.com/@yoshinoya_official" > /dev/null; done)
5回で64秒 → 1回あたり約12.8秒 → 理論値 約281件/時(逐次)
```

Round1のYouTube ytsearch3実測(逐次約3,900クエリ/時)と比べると、**約14分の1のスループット**。
これはYouTube検索が「検索結果1ページ」を返すのに対し、TikTokユーザー抽出は「アカウントの
全動画をページネーションして完全列挙する」という質的に異なる処理のためで、単純比較はできないが、
大量ハンドルを毎日全件リフレッシュするような運用には現実的でない速度感だとわかる。

失敗ケース(存在しない/抽出失敗するハンドル)はエラーで即座に終了するため約3秒程度で完了し、
「失敗しても遅くはない」ため、成功可否をあらかじめ知らないまま候補ハンドルを大量に流すコスト自体は
低い。

### 6. 取得データの内容確認

成功時のJSON 1件を確認すると、仮説に記載のid/uploader/title/channel_id/durationに加え、
view_count/like_count/repost_count/comment_count/save_count/timestamp/thumbnails等の
エンゲージメント指標まで一括取得できていた:

```json
{
  "id": "7577263161934368007",
  "channel": "吉野家",
  "channel_id": "MS4wLjABAAAAmmazw0RCOfPozBqdMG5ykF73k9vTdgKf76CkOEJNRy0TQwWXkbbjlz-hy8SHbRCE",
  "uploader": "yoshinoya_official",
  "duration": 34,
  "title": "吉野家でラーメンだと？！ #吉野家 #牛肉玉ラーメン鍋膳 #ラーメン　@baretarakubi",
  "timestamp": 1764234000,
  "view_count": 625700,
  "like_count": 12600,
  "repost_count": 518,
  "comment_count": 107,
  "save_count": 1402,
  ...
}
```

成功時に限れば、メタデータの質・量ともに想定以上に豊富。

## 結論

- **基本再現は成功**。yoshinoya_official(62件)・mcdonaldsjapan(206件)・official.sukiya.com
  (エラー)というRound1の実測値を完全再現した。
- **実在確認込みの成功率測定により、仮説の楽観的な想定を下方修正**。TikTok公式oEmbed API
  (`tiktok.com/oembed?url=...`, 無料・無認証・軽量)でハンドル実在を先に確認したところ、
  実在する8アカウント中、成功したのはyoshinoya_official・mcdonaldsjapan・starbucks_jの3件のみ
  (37.5%)で、official.sukiya.com・matsuyafoods・kfc_japan・freshnessburger・gusto_officialの
  5件(62.5%)は決定論的に失敗した(3回再現)。仮説記載の「n=3で成功2/失敗1」は、より大きい
  実在確認済みサンプル(n=8)でもほぼ同水準の不安定さ(過半数失敗)であることが裏付けられた。
- **成功/失敗は「生HTML取得のブロック有無」とは無関係**であることを確認。成功アカウントも
  失敗アカウントも生HTML直curlは常に同一の1462byte WAFチャレンジページしか返さない。
- **新知見: curl_cffiインパーソネーションは失敗ケースを救済せず、逆に成功ケースを壊す副作用を
  持つ**。curl_cffiを`0.10.x〜0.15.x`(yt-dlpがsupportedと判定するレンジ)にダウングレードして
  `--impersonate chrome`を試したが、失敗ケースは救済されなかった上、フラグの有無に関わらず
  curl_cffiが「supported」と検出されるだけでRequest Handlersの構成が変わり、それまで安定して
  成功していたyoshinoya_officialまで失敗するようになった。`curl_cffi`を未インストール/
  unsupportedバージョン(0.16.0以降)に戻すと即座に復帰した。これはRound1の「Playwright駆動の
  ブラウザ自動化は12/12ブロック」とは別レイヤーの新知見であり、「TLSインパーソネーションの
  強化」という直感的に良さそうな対策が、少なくとも現行yt-dlp(2026.07.04)×TikTokの組み合わせでは
  逆効果になるという、運用上重要な落とし穴。
- **スループットは逐次で約281件/時**(成功ケース、フル動画一覧取得)で、Round1のYouTube ytsearch3
  (約3,900件/時)の約14分の1。処理内容が異なる(全動画列挙 vs 検索結果1ページ)ため単純比較は
  参考値。失敗ケースは約3秒で終了するため、大量ハンドルの当たり外れを試す一次スクリーニング
  コストは低い。
- **成功時のデータ品質は想定以上**。id/uploader/title/channel_id/duration に加え
  view_count/like_count/repost_count/comment_count/save_count/timestamp等のエンゲージメント
  指標まで一括取得できる。

## 位置づけの再確認(scale_reasoningの検証)

仮説のscale_reasoning(「Instagramルートでハンドルが取れた店舗のうち、TikTokアカウントも併記
されていればボーナスで動画一覧まで取る、という二次的な補完チャネル止まり」)は今回の実測結果と
整合しており、**変更の必要なし**。ただし以下2点を追記する価値がある補強知見が得られた:

1. TikTok公式oEmbed API(`tiktok.com/oembed?url=...`)は、動画一覧こそ取れないが、ハンドル実在
   確認と日本語店舗名(`author_name`)取得に無料・無認証・低リスクで使え、
   `tiktok:user`エクストラクタを叩く前の軽量な事前フィルタとして有用(400×多くの誤ハンドルを
   除外でき、本命の重い抽出コストを節約できる)。
2. **依存パッケージのバージョン管理が成功率に直結する運用リスク**として新規に特筆すべき。
   `pip install -U curl_cffi`のような何気ない更新が、無言でTikTok抽出の成功率を悪化させる
   リグレッションを引き起こしうる。本番導入する場合は`curl_cffi`をrequirements.txtから
   明示的に除外するか、yt-dlpが「unsupported」と判定するバージョン(0.16.0以降、または
   0.5.10/0.10.x〜0.15.x以外)に固定し、CI等で意図せぬアップグレードが起きないようピン留め
   することを推奨する。

**総合判定: combine_with_others確定**。全体設計における位置づけ(Instagramルートで発見した
店舗のTikTokハンドルが分かっている場合のボーナス取得、コールドスタートDiscoveryには使えない
鶏卵問題あり)は変更しないが、実在確認済みでの成功率は約37.5%(3/8)と低めであること、
curl_cffi/impersonationは救済策にならない(むしろ悪化させうる)ことを新たに確定情報として
記録する。Round3での深追いは、公式oEmbedによる事前フィルタ運用ルールの整備以外は不要。

## 実行コマンド一覧(再現用)

```bash
PY=/tmp/claude-0/-root-workspace-nanitabeyo/b416ffde-49b5-49ea-a307-1710e95b33d1/scratchpad/py311/python/bin/python3

# 1. 基本再現
$PY /tmp/yt-dlp-latest --flat-playlist --dump-json "https://www.tiktok.com/@yoshinoya_official"
$PY /tmp/yt-dlp-latest --flat-playlist --dump-json "https://www.tiktok.com/@mcdonaldsjapan"
$PY /tmp/yt-dlp-latest --flat-playlist --dump-json "https://www.tiktok.com/@official.sukiya.com"

# 2. ハンドル実在確認(TikTok公式oEmbed, 無料・無認証)
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://www.tiktok.com/oembed?url=https://www.tiktok.com/@<handle>"

# 3. 生HTML直curlとの比較
curl -s -L "https://www.tiktok.com/@<handle>" \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" \
  -w "HTTP:%{http_code} size:%{size_download}\n"

# 4. curl_cffiバージョンとimpersonation検証
$PY -m pip install "curl_cffi==0.15.0"   # yt-dlpがsupportedと判定する版に変更
$PY /tmp/yt-dlp-latest --list-impersonate-targets
$PY /tmp/yt-dlp-latest --impersonate chrome --flat-playlist --dump-json "https://www.tiktok.com/@<handle>"
$PY -m pip install "curl_cffi==0.16.0"   # unsupported版に戻す(復帰確認用)

# 5. スループット測定
time (for i in 1 2 3 4 5; do $PY /tmp/yt-dlp-latest --flat-playlist --dump-json \
  "https://www.tiktok.com/@yoshinoya_official" > /dev/null; done)
```
