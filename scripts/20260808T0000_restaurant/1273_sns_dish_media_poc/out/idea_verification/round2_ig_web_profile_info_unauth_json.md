# idea検証: ig_web_profile_info_unauth_json

**title**: X-IG-App-IDヘッダー付き無認証プロフィールJSON APIによる直近投稿一覧取得
**判定**: **技術的仕組みは確認(confirmed)。ただし実際の飲食店ハンドルでの実効成功率は約25%(400エラー多発)、
かつレート制限は非常に脆く即座かつ長時間ブロックされる ── 全国スケールの主軸には現時点で不適(needs_more_testing、
実質reject寄り)**

## 実施内容と生の結果

すべて実機で `curl` / Python `urllib` を用いて実行した。送信元IPは `91.184.114.163`(このサンドボックス環境の
egress IP。同一IPで実施された別セッションの検証 `round2_instagram-web-profile-info-known-handle.md` と条件が
揃っているため直接比較可能)。

### 1. ヘッダー必要性の再検証 ── 仮説の記述は不正確だったが、機構自体は確認

仮説は「UAヘッダーなしだと`useragent mismatch`で400になる」としていたが、実際に切り分けると原因は逆だった。

```
== X-IG-App-ID なし、ブラウザUAあり ==
$ curl -A "<Chrome UA>" "https://www.instagram.com/api/v1/users/web_profile_info/?username=nasa"
HTTP 400 {"message":"useragent mismatch","status":"fail"}   # 3回連続再現

== X-IG-App-ID あり、UAヘッダーを明示的に除去 (-H "User-Agent:") ==
$ curl -H "User-Agent:" -H "X-IG-App-ID: 936619743392459" ".../web_profile_info/?username=nasa"
HTTP 200                                                      # 3回連続再現

== X-IG-App-ID あり、curlデフォルトUA(curl/x.x.x)のまま ==
HTTP 200                                                      # 3回連続再現
```

つまり `useragent mismatch` という400メッセージは**UA文字列の内容とは無関係で、`X-IG-App-ID` ヘッダーの
欠如そのもの**が原因だった。UAヘッダーが完全に無い、あるいはcurlのデフォルトUAのままでも `X-IG-App-ID` さえ
付与すれば200が返る。ブラウザUAを偽装する必要は無く、「ブラウザ挙動の模倣に依存」という仮説のToS上の
懸念は過大評価だった(必要なのはApp-IDヘッダー1つのみ)。

### 2. データ構造の確認 ── 仮説どおり確認

```json
// resp_nasa.json (200, 415,812 bytes)
username: nasa
biz email: None / biz phone: None
num posts: 12
 shortcode: Db9IVmrDvQ4 is_video: False ts: 1786570138
 shortcode: Db8wcqjvmGS is_video: True  ts: 1786557692
 shortcode: Db519z8vcyN is_video: False ts: 1786460373
end_cursor: QVFESjRrYUpPM1lldmlRVXk4S3pMQXM0eHk1RENRVFZ3TzZXbHJ4dDVoUHNnbHFGUjRxNS01eXJDZEoyMVY2VFhBYXQwYkg3OXd2cWRZZ2ZGQ3had25pUg==
```

`edge_owner_to_timeline_media.edges` に12件、`page_info.end_cursor` も存在。仮説(1)は再現できた。

### 3. 実際の飲食店ハンドルでの400(subvertical bug)発生率 ── 仮説の懸念を大きく裏付ける実測値

**3-a. 仮説記載の既知失敗ハンドル(再確認)**

```
ippudo_jp / domiso_official / tsukemen_sharin / jiroyatogi / menya33 / torachanramen
-> 全て HTTP 400 {"message":"Asset asset://laser.provider/ig_business_category_subvertical
    has been deleted. You cannot use this schema","status":"fail"}   (6/6 = 100%失敗、再現)
```

**3-b. WebSearchで発見した飲食系ハンドル(混合サンプル、個人店+チェーン)**

```
ramennagi_jp        -> 200 (category: "Ramen Restaurant", is_business:False, 12投稿取得成功)
sinto.mugi           -> 400 (subvertical bug)
ramen_makotoya       -> 400 (subvertical bug)
ramendb              -> 400 (subvertical bug)
harapecooh           -> 200 (グルメ紹介メディアアカウント、実店舗ではない)
tokyogourmet3        -> 200 (グルメ紹介メディアアカウント、実店舗ではない)
sukiya_jp            -> 400 (subvertical bug、※本物のすき家アカウントかは未確認)
cocoichi_official    -> 400 (subvertical bug、※本物のCoCo壱番屋アカウントかは未確認)
yoshinoya_official    -> 200 (だがfollower数2件、実物の吉野家アカウントではない疑いが強い)
mcdonaldsjapan       -> 200 (is_business:True、followers 679,147、実物の大手チェーン)
gusto_official       -> 200 (followers 58、実物か不明)
saizeriya_official   -> 200 だが followers 0 / posts 0 (実在しないダミーアカウントと推定)
```

**3-c. 【最重要】Round1のCommon Crawl逆引きパイプラインが実際に発見した飲食店ハンドル16件をそのまま投入**
(このパイプラインの出力こそが本アイデアが実運用で受け取る入力そのものであり、最も代表性が高いサンプル)

```
bluffbakery          -> 400 (subvertical bug)
dobrogi_akasaka      -> 400 (subvertical bug)
doramamitaida01      -> 200 (成功、12投稿取得)
enekotokyo           -> 400 (subvertical bug)
gocchibatta          -> 200 (成功、12投稿取得)
kameari_happy        -> 400 (subvertical bug)
osakana_ikebukuro    -> 400 (subvertical bug)
osakana_shinjuku     -> 400 (subvertical bug)
osakana_shizuoka     -> 400 (subvertical bug)
osakana_tachikawa    -> 400 (subvertical bug)
osakana_tsukishima   -> 400 (subvertical bug)
parlour_ekoda        -> 200 (成功、12投稿取得)
sanpiryoron_official -> 400 (subvertical bug)
spiralcafe.jp        -> 404 (該当ハンドル無し、ドット付きハンドルの表記揺れの可能性)
spistagram1          -> 200 (成功、12投稿取得)
susuru_tv            -> 400 (subvertical bug)
```

**集計(3-c、Round1実出力ベースの最も代表的なサンプル、n=16)**: 400(subvertical bug) = 11件(68.75%)、
200(成功) = 4件(25.0%)、404(ハンドル不一致) = 1件(6.25%)。

**全飲食店系ハンドルを横断した集計(3-a+3-b+3-c、チェーン店/メディア系/ダミーアカウントを除いた実店舗系のみ)**:
400失敗 = 22件、200成功 = 5件(ramennagi_jp, doramamitaida01, gocchibatta, parlour_ekoda, spistagram1)、
404 = 1件。**実店舗系ハンドルでの成功率はおよそ18%〜25%程度**であり、仮説が「未解決の技術的コスト」と
自己申告していた懸念(実効成功率が個人アカウントより著しく低い)は今回の実測で定量的に裏付けられた。

### 4. 追加で判明した新しい失敗モード ── 仮説未記載

`nintendo` アカウントに対するリクエストはHTTP 200を返すが、ボディが `{"status":"ok"}` のみで
`data` フィールド自体が存在しない(6回連続再現、`hl=ja` 付与でも同様)。これは400のsubverticalバグとは
別の"静かな失敗"パターンであり、HTTPステータスコードだけでは成功/失敗を判別できないことを示す
(呼び出し側は必ず `data.user` の存在をチェックする必要がある)。

```
$ curl -A "<UA>" -H "X-IG-App-ID: ..." ".../web_profile_info/?username=nintendo"
HTTP 200
{"status":"ok"}
```

### 5. レート制限探索 ── 仮説の「50〜100件/時間」的な前提を大きく下回る、かつ既存の別検証と整合

同一IP(`91.184.114.163`)から実施した別セッションの検証(`round2_instagram-web-profile-info-known-handle.md`)
で報告された「間隔を空けても即429、429状態が数十秒〜数分持続する」という結果を、本検証でも独立に再現・補強した。

```
[a] 2秒間隔で12件連続(WebSearchハンドル) -> 0/12が429(全て200/400の正常な業務応答)
[b] 2秒間隔で16件連続(CommonCrawlハンドル) -> 0/16が429(全て200/400/404の正常な業務応答)
[c] [b]の直後、無遅延で15件連続(5ハンドル×3周) -> 15/15が429(3.5秒で完走)
[d] 30秒クールダウン後、単発1件 -> 200(成功)
[e] [d]の直後、5秒間隔で6件連続 -> 6/6が200(成功)
[f] [e]の直後、間隔を1秒に変更して10件連続 -> 10/10が429(即座に転落)
[g] 60秒クールダウン後、5秒間隔で10件連続 -> 10/10が429(30秒クールダウンより長い60秒でも回復せず悪化)
[h] 合計約220秒以上のクールダウン後、単発1件 -> 200(成功)
```

観測: **2秒間隔(≒0.5 req/秒)を守れば連続アクセスでもブロックされないウィンドウが存在する一方、
無遅延バーストや、直前に別パターンでアクセスした直後の高頻度アクセスは即座に429へ転落し、
一度その状態に入ると数十秒〜3分超のクールダウンでも解消しないケースがある。**
Round1のREPORT.mdが記録した「50/50成功、ブロック兆候ゼロ」(無遅延30連続)は本検証・別セッション検証の
どちらでも再現できず、Instagram側のレート制限挙動がRound1計測時よりも厳格化しているか、Round1計測時の
IP/条件が現在と異なっていた可能性が高い。安全な持続レートは「厳密な間隔(2秒以上)を守り、パターンを
急変させない」という運用上の制約付きでしか主張できず、仮説のscale_reasoningが前提とする水準の
検証はできていない。

### 6. ページネーション(次ページ取得)

仮説test_plan(4)のとおり未検証。理由: 上記5の429リスクを悪化させないための判断(先行する別検証と同じ判断)。

## 結論

- **機構自体(仮説1・3)は完全に再現・確認できた**: `X-IG-App-ID: 936619743392459` ヘッダーのみで
  認証・Cookie・ブラウザ自動化なしに200が返り、`edge_owner_to_timeline_media` から直近12投稿の
  shortcode/is_video/timestamp/end_cursorが取得できる。ただし「useragent mismatch」400の真因は
  UA文字列ではなく `X-IG-App-ID` の欠如であり、仮説が想定した「ブラウザ挙動模倣への依存」は誤り
  (ブラウザUAは不要)。
- **仮説自身が課題として挙げていた「ビジネス/プロカテゴリアカウントでの高い失敗率」は、Round1の
  実出力(Common Crawl逆引きで実際に発見された16飲食店ハンドル)を投入した実測で定量的に裏付けられた**:
  400(subverticalバグ)率68.75%(11/16)、成功率25%(4/16)。全飲食店系ハンドル横断でも成功率は
  約18〜25%にとどまる。「既知ハンドル1件につきAPIコール1回で最大12件無料取得」という
  scale_reasoningの前提は、実店舗アカウントの大半(7〜8割)で成立しない。
- **レート制限は仮説やRound1の想定より大幅に脆弱**であることを、別セッションの独立検証と整合する形で
  確認した。2秒間隔の連続アクセスでは29件中0件が429だった一方、無遅延バーストや直前のアクセス
  パターン変化に対しては即座かつ長時間(60秒クールダウンでも解消しない場合がある)429状態に転落する。
  安全な運用には「間隔を機械的に一定(2秒以上)に保つ」制約が必須と見られ、全国スケールでの
  スループット試算の主軸には据えにくい。
- **新たな失敗モードとして、`nintendo` のような一部アカウントでHTTP 200だが `data` フィールドが
  存在しない"空応答"を確認した**。呼び出し側はHTTPステータスだけでなくペイロード構造も検証する必要がある。

## 総合判定

**needs_more_testing(実質reject寄り)**。無認証JSON APIという技術的な穴自体は実在し、Round1・別セッション
検証と合わせて3回独立に再現された確実な事実である。しかし本検証で追加した「Round1の実パイプライン出力を
そのまま投入した現実的なサンプル」により、飲食店の主要ターゲット層(個人店・地域チェーン)での実効成功率が
2〜3割程度しかないことが定量的に判明した。これに加えてレート制限の脆さ(即座かつ長時間ブロックされ得る)も
別セッション検証と整合する形で確認されたため、「既知ハンドル→投稿一覧」を全国スケールDiscoveryの主軸に
据えるのは時期尚早である。位置づけとしては、Common Crawl逆引き等で得たハンドルに対する**低頻度(2秒以上間隔・
バッチはごく小規模)の補完的Enrichmentチャネル**(月次バッチで少数ハンドルを丁寧に処理する用途)に留めるのが
妥当であり、Round1が示唆した「量産に耐える無料の決定打」としての採用は推奨しない。

## 実行コマンド一覧(再現用)

```bash
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

# 1. ヘッダー必要性の切り分け
curl -s -A "$UA" "https://www.instagram.com/api/v1/users/web_profile_info/?username=nasa" -w "\nHTTP:%{http_code}\n"
curl -s -H "User-Agent:" -H "X-IG-App-ID: 936619743392459" "https://www.instagram.com/api/v1/users/web_profile_info/?username=nasa" -w "\nHTTP:%{http_code}\n"

# 2. 飲食店ハンドル一括判定(2秒間隔)
for h in bluffbakery dobrogi_akasaka doramamitaida01 enekotokyo gocchibatta kameari_happy \
         osakana_ikebukuro osakana_shinjuku osakana_shizuoka osakana_tachikawa osakana_tsukishima \
         parlour_ekoda sanpiryoron_official spiralcafe.jp spistagram1 susuru_tv; do
  curl -s -o resp_$h.json -A "$UA" -H "X-IG-App-ID: 936619743392459" \
    "https://www.instagram.com/api/v1/users/web_profile_info/?username=$h" -w "$h -> %{http_code}\n"
  sleep 2
done

# 3. レート上限探索(無遅延バースト、Python urllib)
python3 -c "
import urllib.request, time
from collections import Counter
handles = ['nasa','cocacola','starbucks_j','mcdonaldsjapan','doramamitaida01']*3
headers = {'User-Agent': '$UA', 'X-IG-App-ID': '936619743392459'}
results = []
for h in handles:
    url = f'https://www.instagram.com/api/v1/users/web_profile_info/?username={h}'
    req = urllib.request.Request(url, headers=headers)
    try:
        resp = urllib.request.urlopen(req, timeout=15); code = resp.getcode()
    except urllib.error.HTTPError as e:
        code = e.code
    results.append(code)
print(Counter(results))
"
# -> Counter({429: 15})
```
