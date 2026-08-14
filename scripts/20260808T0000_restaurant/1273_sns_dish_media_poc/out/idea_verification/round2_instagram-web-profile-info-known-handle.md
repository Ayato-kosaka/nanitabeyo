# idea検証: instagram-web-profile-info-known-handle

**title**: Instagram web_profile_info 無認証直叩き(既知ハンドル→投稿一覧)
**判定**: **技術的仕組みは確認(confirmed)だが、スループット主張は再現できず(needs_more_testing寄りに格下げ)**

## 実施内容と生の結果

### 1. 疎通確認・データ構造の確認 — 確認できた(仮説どおり)

```
$ curl -sS -m 15 "https://www.instagram.com/api/v1/users/web_profile_info/?username=starbucks_j" \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36" \
  -H "X-IG-App-ID: 936619743392459"
HTTP_CODE:200
```

`data.user.edge_owner_to_timeline_media.edges[].node` に実データが入っていることを確認した(starbucks_j、投稿12件、`count: 2848`):

```
shortcode: Db-EWFrMB2X
display_url: https://instagram.ftbs7-1.fna.fbcdn.net/v/t51.82787-15/774362761_...jpg?...(CDN直URL、認証不要)
is_video: True
taken_at_timestamp: 1786601677
caption: 🎞️メイキングストーリー\n昨日(8/12)投稿した、30周年ブランドムービーはご覧いただけましたか...
comments: 3
```

```
shortcode: Db7BMhtMVCe / is_video: True / taken_at_timestamp: 1786499493 / comments: 60
shortcode: Db45QsojLFH / is_video: False / taken_at_timestamp: 1786428013 / comments: 52
```

`edge_owner_to_timeline_media.edges` は必ず12件、`page_info` は
`{"has_next_page": true, "end_cursor": "QVFCZ..."}` を含む。仮説(1)の記述と完全一致。

### 2. 複数ハンドルでの200/400/404の切り分け — 確認できた(仮説どおり)

1req/秒のペースで8ハンドル+1件を実行:

```
starbucks_j -> HTTP 200
mcdonaldsjapan -> HTTP 200
yoshinoya_official -> HTTP 200
gusto_official -> HTTP 200
sukiya_jp -> HTTP 400
cocoichi_official -> HTTP 400
nonexistent_handle_zzz9999xyz -> HTTP 404
saizeriya_official -> HTTP 200
```

sukiya_jp・cocoichi_officialの400ボディは仮説の記述と一致:
```json
{"message":"Asset asset://laser.provider/ig_business_category_subvertical has been deleted. You cannot use this schema","status":"fail"}
```

存在しないハンドルの404は通常のHTML 404ページ(`content-type: text/html; charset=utf-8`)で、
JSON化けせず判別可能であることも確認した。仮説(1)(3)(4)は完全に再現された。

### 3. レート上限探索 — **仮説のスループット主張(50/50無ブロック、1〜2req/秒持続可能)は再現できず**

これが本検証で最も重要な相違点である。同一環境・同一IP(`91.184.114.163`)から複数パターンで
連続アクセスを試したが、いずれも仮説が主張する「50/50成功・ブロック兆候ゼロ」を再現できなかった。

```
[A] 無遅延60連続(starbucks_j固定) -> 60/60が HTTP 429 (13.4秒で完走、平均レイテンシ0.22秒)
[B] Aの直後に単発1件 -> HTTP 200 (成功)
[C] Bの直後、0.5秒間隔15連続 -> 15/15が HTTP 429
[D] Cの直後、1.0秒間隔15連続 -> 15/15が HTTP 429
[E] Dの直後、2.0秒間隔15連続 -> 15/15が HTTP 429
[F] 30秒クールダウン後、単発1件 -> HTTP 200 (成功)
[G] Fの直後、3秒間隔10連続 -> 10/10が HTTP 429
[H] 90秒クールダウン後、単発1件 -> HTTP 200 (成功、外部IP 91.184.114.163を再確認)
[I] 60秒クールダウン後、5秒間隔5連続 -> 1件目からHTTP 429(5/5がすべて429)
[J] 180秒クールダウン後、10秒間隔4連続 -> 3件がHTTP 429、4件目はネットワーク一時的到達不能
    (Google疎通は正常だったため、IG側というより環境側の一時的ネットワーク問題と判断)
[K] Jの直後、単発1件(curl) -> HTTP 200 (成功)
[L] Kの直後、60秒間隔で新規スクリプト再実行 -> req0(t=0s) 429 / req1(t=60s) 429 / req2(t=120s) 429
    (このテストは3件目完走前に十分な証拠が得られたため打ち切り)
```

観測されたパターン: **十分な間隔(30〜90秒以上)を空けた「孤立した単発リクエスト」は高確率で成功するが、
その直後に2件目以降を発行すると、間隔を0.5秒〜60秒のどこに設定しても即座に429へ転じ、
その429状態は数十秒〜数分単位で持続する。** 429応答に`Retry-After`や`X-RateLimit-*`ヘッダは
含まれておらず(確認済み、`grep -iE "retry-after|x-ratelimit|x-app-usage"`はいずれもヒットなし)、
クライアント側から解除タイミングを予測する手段がない。

これはRound1のREPORT.mdに記録された「50/50成功、ブロック兆候ゼロ」という実測(3アカウント持ち回り
無遅延30連続+同一アカウント0.5秒間隔20連続)と直接矛盾する。同一エンドポイント・同一ヘッダー構成
での再検証だが、今回は同種の連続アクセスパターンで一貫して429が発生した。考えられる要因(未特定):
(a) Instagram側がRound1実施時点からレート制限を強化した、(b) 本セッションの送信元IP
(91.184.114.163、データセンター系IPと推測)が既に何らかの理由でより厳しい制限区分に入っている、
(c) Round1計測時と本検証時で偶然ネットワークパス/IPが異なり、IPレピュテーションの差が結果に
影響した。いずれも本検証環境からは切り分け不能。

### 4. ページネーション検証 — 未実施(意図的に見送り)

`page_info.end_cursor`の存在は確認済み(上記1)だが、上記3の通り2件目以降のリクエストが
高確率で429になる状態のため、GraphQLページネーションクエリを追加で叩くと429状態をさらに
悪化させるだけと判断し、実施を見送った。仮説の記述どおり「未検証のまま」であり、これは
仮説自身も認めている制約(Round3以降の課題)なので、本検証による新たな不利な情報はない。

### 5. dev.restaurant_seed_catalogとの結合 — テーブル自体が存在しない

```sql
select table_schema, table_name from information_schema.tables where table_name ilike '%seed%';
-- 0 rows
select table_schema, table_name, column_name from information_schema.columns
  where column_name ilike '%instagram%' or column_name ilike '%sns%' or column_name ilike '%handle%';
-- pg_catalog.pg_am.amhandler / pg_catalog.pg_foreign_data_wrapper.fdwhandler のみ(PostgreSQL内部列、無関係)
select count(*) from dev.restaurants;
-- 2439
```

`dev.restaurant_seed_catalog`というテーブルは存在せず、`dev.restaurants`(2,439件、issueが
前提とする70万件とは桁違いに少ないdevサブセット)にもInstagram/SNSハンドルに類する列は
一切存在しない。仮説のtest_plan(5)は前提となるデータが現状のDBに存在しないため実行不能。
Round1のREPORT.mdに記載の「devデータとの名寄せは0/6件」という既知の制約がそのまま該当する。

## 結論

- **技術的な仕組み自体(仮説1・3・4)は完全に再現・確認できた**: 認証・Cookie・ブラウザ自動化なしで
  `X-IG-App-ID`ヘッダのみを付けたGETで、既知ハンドルの直近12投稿(shortcode/display_url/is_video/
  taken_at_timestamp/キャプション/コメント数)がJSONで取得できる。400(特定ビジネスカテゴリの
  恒常的エラー)と404(存在しないハンドル)の判別も確認どおり可能。これはRoute A(既知アカウント経由の
  投稿一覧取得)として技術的に実在する無料ルートである。
- **一方で、仮説の核となる量的主張(2)「50/50無ブロック」「1〜2req/秒を安全に持続」「1時間数千〜1万
  ハンドル」は、本検証環境では一貫して再現できなかった。** 単発の孤立リクエストは高確率で成功するが、
  間隔を0.5秒〜60秒のどこに設定しても2件目以降で即座に429へ転じ、429状態が数十秒〜数分単位で
  持続するという、Round1の実測と正反対に近い挙動を7パターン全てで観測した。429にRetry-After等の
  ヘッダがなく、クライアント側からクールダウン時間を予測できないため、実運用での安全なスループットは
  現状「1リクエストごとに数十秒〜数分の間隔をおく必要がある可能性がある」レベルまで下方修正すべきで、
  Round1が示した「1〜2req/秒」という前提でのスケール試算(1時間数千〜1万ハンドル)はそのままでは
  成立しない。
- **ページネーション(1店舗12投稿を超える取得)は本検証でも未検証のまま**。429状態を悪化させない
  ための判断であり、仮説自身が認める既知の保留事項と一致する。
- **DB結合(test_plan 5)は実行不能**: `dev.restaurant_seed_catalog`は存在せず、`dev.restaurants`
  (2,439件)にもSNSハンドル列は無い。Instagramハンドルをどこかで収集・保存する仕組み(例:
  `commoncrawl-portal-reverse-discovery`の出力をDBに永続化する処理)が別途必要になる。

## 総合判定

**needs_more_testing(再現性に重大な疑義)**。「無認証で既知ハンドルの投稿一覧が取れる」という
技術的な穴自体は実在し、Round1の発見を裏付けた。しかし「量産に耐える無料の決定打」という
Round1の評価は本検証では支持できない。同一の技術検証を複数の時間帯・複数の送信元IPから
再々実行し、(a) 429の発生が今回観測したような即時的・持続的なものなのか、(b) Round1同様の
高スループットが出る条件(時間帯・IPレンジ・ヘッダー構成の違い等)が別途あるのか、を切り分けない
限り、Route Aをスケール試算の主軸に据えるのは時期尚早と判断する。仮に安全な実効レートが
「数十秒〜数分に1件」水準だとすると、1時間あたり数十〜高々百件程度になり、scale_reasoningが
想定する「1時間数千〜1万ハンドル」には遠く及ばない。Round3では、まず本検証で観測した429の
持続時間・解除条件そのものを定量化すること(例: 5分・10分・30分の各クールダウン後に単発成功するか、
成功後2件目まで何秒空ければ429を回避できるかの二分探索)を最優先課題とすべきである。

## 実行コマンド一覧(再現用)

```bash
# 1. 疎通確認
curl -sS -m 15 "https://www.instagram.com/api/v1/users/web_profile_info/?username=starbucks_j" \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36" \
  -H "X-IG-App-ID: 936619743392459" -w "\nHTTP_CODE:%{http_code}\n"

# 2. 複数ハンドル(1req/秒)
for h in starbucks_j mcdonaldsjapan yoshinoya_official gusto_official sukiya_jp cocoichi_official \
         nonexistent_handle_zzz9999xyz saizeriya_official; do
  curl -sS -m 15 -o /tmp/ig_$h.json -w "$h -> %{http_code}\n" \
    "https://www.instagram.com/api/v1/users/web_profile_info/?username=$h" \
    -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36" \
    -H "X-IG-App-ID: 936619743392459"
  sleep 1
done

# 3. レート上限探索(無遅延60連続、Python urllib)
python3 -c "
import urllib.request, time
from collections import Counter
url = 'https://www.instagram.com/api/v1/users/web_profile_info/?username=starbucks_j'
headers = {'User-Agent': 'Mozilla/5.0 ... Chrome/120.0 Safari/537.36', 'X-IG-App-ID': '936619743392459'}
results = []
for i in range(60):
    req = urllib.request.Request(url, headers=headers)
    try:
        resp = urllib.request.urlopen(req, timeout=15); code = resp.getcode()
    except urllib.error.HTTPError as e:
        code = e.code
    results.append(code)
print(Counter(results))
"
# -> Counter({429: 60})

# 5. DB確認
psql "\$DATABASE_URL" -t -c \
  "select table_schema, table_name from information_schema.tables where table_name ilike '%seed%';"
# -> 0 rows
psql "\$DATABASE_URL" -t -c "select count(*) from dev.restaurants;"
# -> 2439
```
