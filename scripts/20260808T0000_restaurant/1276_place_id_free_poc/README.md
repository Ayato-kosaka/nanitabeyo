# 完全無料SKUだけで google_place_id を逆引きする PoC（Issue #1261 Step 1）

日本のオープンデータ上の飲食店に対して、Google Places API (New) の**課金されない
SKUだけ**で `google_place_id` を逆引きできるかを実測した PoC です。BigQuery へは
投入せず、ローカルで完結します。

seed は `0000_open_data_poc` で調べた3ソースを統合して作ります。

| ソース | 生の件数 | 採用 | ライセンス |
| --- | ---: | ---: | --- |
| Overture Maps Places `2026-07-22.0` 日本の飲食店 | 1,081,471 | 1,080,933 | CDLA-Permissive 2.0 |
| IFAS（食品衛生申請等システム、157自治体） | 1,089,349 | 250,186 | 各自治体のオープンデータ |
| OpenStreetMap（Overpass、コア8業態 + `shop=*` 13種） | 219,405 | 151,304 | **ODbL** |

**統合後 1,482,423 行。**

実測した3つの数字。

| | 何を測ったか | 分母 | 結果 |
| --- | --- | ---: | ---: |
| ②（最優先） | 確定した place_id のうち正しかった割合 | 5,083 | **100.000%**（誤り0件） |
| ③（主KPI） | Google のレストランのうち place_id を出力できた割合 | 1,747 | **63.37%** |
| ① | コーパスの行のうち place_id が1つに決まった割合 | 5,850 | **55.61%** |

IFAS は営業許可のデータなので、飲食店以外（製造所・給食施設など）と廃業済みを外して
から使います。3ソースを座標60mグリッドと正規化店名で寄せた結果が seed です。
OSM だけライセンスが違う（ODbL は継承条項がある）ので、成果物の扱いを分けられるよう
`seed_id` の接頭辞でソースが分かるようにしてあります。

実測結果と作戦の変遷は [REPORT.md](./REPORT.md) を参照してください。

## 課金しないための構造

Google の課金はリクエストした fieldMask で決まります。したがって fieldMask を
呼び出し側の引数にせず、`free_places.FIELD_MASK = "places.id"` として定数で固定し、
さらに応答側でも `id` 以外のキーが来たら `BillingGuardError` で**処理を止めます**。

使っているSKUは次の2つで、いずれも $0.00 です。

**Nearby Search は使いません。** 「fieldMask を絞れば無料」という性質は Text Search と
Place Details にしかなく、Nearby Search (New) には IDs Only の無料枠がありません。
fieldMask を `places.id` だけにしても Nearby Search Pro として課金されます
（Google サポートの回答、#1331）。`search_nearby` は呼ばれた時点で例外を投げます。

| SKU | 呼び出し | fieldMask |
| --- | --- | --- |
| Text Search Essentials (IDs Only) | `places:searchText` | `places.id` |
| Place Details Essentials (IDs Only) | `places/{id}` | `id` |

`displayName` や `location` を1つでも足すと Pro SKU に切り替わって課金されるため、
このリポジトリのコードからは足せないようにしてあります。単体テストでも
`test_field_mask_is_ids_only` と `test_billable_field_stops_the_run` で固定しています。

結果として **Google 由来の店名・住所・座標は1件も取得・保存していません**。
保存しているのは place_id だけです。

## 投げているクエリ

| probe | textQuery | 位置指定 | 役割 |
| --- | --- | --- | --- |
| A | 正規化店名 | `locationBias` circle 150m | Issue 記載のクエリA |
| B | 正規化店名 + 住所文字列 | なし | Issue 記載のクエリB（座標と独立） |
| C | 正規化店名 | `locationRestriction` rectangle 半辺75m | 座標の裏取り |
| c_tight | 正規化店名 | `locationRestriction` rectangle 半辺25m | 一意性の確認（採用ルールの層1） |
| c_wide | 正規化店名 | `locationRestriction` rectangle 半辺250m | 座標ズレ行の救済（採用ルールの層2） |
| nearby | （なし） | `locationRestriction` circle 40m | C が使えない場合の代替 |

C 系（矩形）を足したのが本 PoC の肝です。`locationRestriction` は `locationBias` と違って
矩形の外を実際に切り落とします（大阪の店名を東京の矩形で検索すると0件になることを
確認済み）。つまり「その place_id が Google 側でもこの座標の近くにある」ことを、
座標フィールドを買わずに確かめられます。A/B だけの判定は誤マッチ率が高く、
C を必須にすると桁で下がります（[REPORT.md](./REPORT.md) の実測表）。

## 判定ルール `box_unique`

正解ラベル2,541件に対して、候補の選び方と証拠の連言を総当たりで採点し直した結果
（`gate_analysis.py`）、効いていたのは **「A と B の合意」ではなく「矩形内の一意性」**
でした。合意を根拠にする層はどれも 99.7〜99.8% で頭打ちになります。店が Google に
無ければ、A も B も揃って隣の店を返すからです。

`box_unique` は2層だけです。

1. `tight_unique_in_ab` — ±25m の矩形に同名が**1件だけ**で、A か B もそれを挙げている
2. `wide_unique_in_ab` — ±250m まで広げても同名が**1件だけ**で、A か B もそれを挙げている

「A か B が挙げている」という裏取りは必須です。これを外すと層1に新たに49件が
通りますが、そのうち正解は1件だけ（2.0%）でした。矩形内で唯一でも、店名クエリが
その店を指していなければ別の店だからです。

## 実行

Python 3.11以上。

```bash
cd scripts/20260808T0000_restaurant/1276_place_id_free_poc
python -m pip install -r requirements.txt
export PLACE_API_TEST=<APIキー>

# 1. Overture parquet から seed を作る（parquet の取得は 0000_open_data_poc の手順）
python place_id_poc.py prepare \
  --overture-parquet ../0000_open_data_poc/data/overture-asia.parquet \
  --output out/seeds.csv --sample 10000

# 2. 精度の下限を測るための負例（店名だけ遠方の別店舗に差し替えたもの）
python place_id_poc.py prepare-negatives \
  --seeds out/seeds.csv --output out/negatives.csv --count 300

# 3. Google へ問い合わせてキャッシュする（--execute が無ければ件数を出すだけ）
#    採用ルール box_unique が使うのは A・B・c_tight・c_wide の4本。
python place_id_poc.py probe \
  --seeds out/seeds.csv out/negatives.csv \
  --cache cache/probe.sqlite --tight-box --wide-box \
  --only-probes a b c_tight c_wide \
  --execute --qps 10 --workers 20

# 4. 判定ルールを当てて指標を出す
python place_id_poc.py evaluate \
  --seeds out/seeds.csv --negatives out/negatives.csv \
  --cache cache/probe.sqlite --output out/eval.json

# 5. 1件に絞れた確定matchだけを CSV へ
python place_id_poc.py export \
  --seeds out/seeds.csv --cache cache/probe.sqlite \
  --rule box_unique --output out/matched_place_ids.csv
```

API の結果は `cache/probe.sqlite` に貯まります。判定ルールを変えても再問い合わせは
起きないので、`evaluate` と `export` は何度でもやり直せます。`probe` は取得済みの
組み合わせを飛ばすため、中断しても続きから再開できます。

`--only-probes` は既存キャッシュへ1種類だけ足したいときにも使えます（`c_wide` を
後から追加する等）。

スループットは実測で 5〜10 req/s でした。`--qps` を15以上にすると 429 が返り、
バックオフで実効レートがかえって落ちます。全789,612件を回すなら4 probe × 約79万件で
約316万リクエスト、10 req/s なら約88時間の見積りです（課金は0のままです）。

## 出力CSVの見かた

`export` は「1件に絞れたもの」だけを出します。同じ place_id を複数の seed が
取り合った行は、どちらかが誤りなので**両方落とします**（`dropped_place_id_collision`）。

| 列 | 内容 |
| --- | --- |
| `overture_id` | seed 側のキー。Overture は UUID、IFAS は `ifas:自治体コード:行番号`、OSM は `osm:type/id` |
| `google_place_id` | 逆引きできた Google place ID |
| `name` / `latitude` / `longitude` / `postcode` | すべて **オープンデータ由来**。Google からは取得していない |
| `match_detail` | `tight_unique_in_ab` / `wide_unique_in_ab` |
| `confidence_tier` | `A` = A・B とも単一候補で一致し矩形内。`B` = それ以外の確定層 |
| `geo_verification` | `confirmed` = 矩形検索で座標近傍に実在を確認 |

### PostgreSQL の既存 restaurants と突合するとき

`google_place_id` で join してください。照合の判定は**座標の距離**で見るのが妥当です。

```sql
-- 例: 突合して距離を出す
SELECT m.overture_id, m.confidence_tier, r.id,
       earth_distance(ll_to_earth(m.latitude, m.longitude),
                      ll_to_earth(r.latitude, r.longitude)) AS distance_m
FROM matched_place_ids m
JOIN restaurants r ON r.google_place_id = m.google_place_id;
```

店名の完全一致で判定しないでください。CSVの `name` は Overture の表記、既存DBの
名称は Google の表記なので、同じ店でも文字列は一致しません（「(株)」の有無、
支店名の書き方、英字表記など）。`confidence_tier` ごとに距離分布を見れば、
どの強さの証拠まで採用してよいかが決まります。

## テスト

```bash
python -m unittest -v test_place_id_poc.py
```

ネットワークなしで、課金ガード・住所クエリ組立・座標裏取り・判定ルールを固定します。
