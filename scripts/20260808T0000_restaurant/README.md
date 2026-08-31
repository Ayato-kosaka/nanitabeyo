# 店提案事前データパイプライン

Overture / IFAS / OpenStreetMap / 現行 PostgreSQL を BigQuery で名寄せし、Google
Place ID が安全に確定した店舗と、権利根拠を確認済みの料理媒体だけを PostgreSQL
へ公開する手動パイプラインです。

## 設計上の境界

BigQuery Dataset は `food-scroll.restaurant_recommendation` です。
`food-scroll.wikidata_food_graph` は料理カテゴリの生成元であり、Wikidataではない店舗原票を
混在させません。一方、dev/prod、raw/catalogごとにDatasetを増やさず、1 Dataset内の
table suffixで役割を示します。

| suffix | 役割 | 更新方針 |
|---|---|---|
| `*_raw` | 外部原票・既存DB snapshot | snapshot/run単位のappend-only。同run再実行だけ置換 |
| `restaurant_source_records` | ソース固有形式を揃えた行 | source 1 record = 1 row。まだ店舗統合しない |
| `restaurant_seed_catalog` | ソース横断の実店舗候補 | current snapshotとして全置換 |
| `*_attempts`, `*_logs` | API判定・実行監査 | append-only |
| `*_catalog` | PostgreSQLへ公開可能な現在値 | 品質ゲート付きで全置換 |

dev/prodの違いは最後のPostgreSQL `--schema dev|public`だけです。同じBigQuery catalogを
dry-runし、同じrun_idを段階的に昇格させます。Cloud Schedulerはこの実装に含めず、
すべて番号付きscriptを手動実行します。

### `2_1` と `2_2` の違い

- `2_1_build_restaurant_source_records.py` は **形式統一**です。Overture、IFAS、OSM、
  既存PGの列名・正規化名・座標・S2 cellを同じschemaへ写します。同じ店らしくても
  この時点では別行のままです。
- `2_2_build_restaurant_seed_catalog.py` は **実体解決**です。2_1の行を名称・住所・距離で
  保守的に束ね、「Google Place IDを探す対象となる実店舗seed」を作ります。曖昧候補は
  無理に統合せず、conflict付きの別seedにします。

この二層を分けることで、正規化の誤りと名寄せの誤りを別々に監査できます。

## データフロー

**どこが正か**が一目で分かる形にしてある。手順の羅列は「手動実行順」にある。

```text
  ┌── BigQuery（オープンデータの側。ここが «店の事実» の正）────────────────┐
  │                                                                        │
  │  Overture / IFAS / OSM / 食品営業許可台帳 ──▶ *_raw           1_3〜1_6  │
  │                                     │                                  │
  │   PG の place_id・座標だけ ─────────┤                                  │
  │   （1_2。表示値は運ばない）          ▼                                  │
  │                          restaurant_source_records            2_1      │
  │                                     ▼                                  │
  │                          restaurant_seed_catalog              2_2      │
  │                                     ▼                                  │
  │              Google Place ID match（box_unique_strict）       3_1〜3_3  │
  │                                     ▼                                  │
  │                          restaurant_catalog                   3_4      │
  │                          （name/座標/住所/国/電話/サイト/SNS）          │
  │                                     │                                  │
  │  IFAS の廃業レコード ──▶ restaurant_closure_signals            3_6      │
  │                          （«根拠» であって判定ではない）                │
  └─────────────────────────────────────┼──────────────────────────────────┘
                                        │  9_1（品質ゲート 8_1 が緑のときだけ）
  ┌─────────────────────────────────────▼──────────────────────────────────┐
  │ PostgreSQL（アプリの側。ここが «ユーザーの入力» の正）                  │
  │                                                                        │
  │  restaurants                                                           │
  │    created_by_source='pipeline' … 9_1 が毎回上書きしてよい行            │
  │    created_by_source='user'     … **9_1 は表示値を絶対に触らない**      │
  │                                    （アプリが POI 押下で作った行）      │
  │  restaurant_links … 電話/サイト/SNS。open_data 由来だけを              │
  │                     ON CONFLICT DO NOTHING で足す（ユーザー追加を消さない）│
  └────────────────────────────────────────────────────────────────────────┘

権利確認済みSNS URL
  -> dish_media_social_raw              (4_1)
  -> dish/dish_media/coverage catalog   (4_2)
  -> PostgreSQL dishes/dish_media       (9_2)
```

**この図の要点は矢印ではなく、下の箱の中の 2 行**である。
«誰が書いてよい行か» を行のとなりに刻んであるので、
BigQuery 側のスナップショットが何時間古かろうとアプリの行は壊れない
（古いスナップショットへの否定条件で判定していたのが 2026-08-24 の事故の真因）。

## 名寄せ方針

### Open data間

Overtureを主seedとし、既存PG、OSM、IFASの順でcanonical列を採用します。IFASは営業許可の
裏付けとしては有用ですが、電子申請かつ公開同意分であり、店舗表示マスターとは扱いません。
距離150m以内で完全正規化名、L1正規化名、最後にtrigramを評価します。同順位候補が複数なら
`ambiguous_new_seed`とし、自動統合しません。異なる既存Google Place IDは絶対に統合しません。

Overtureは1 release内でもfeatureごとに元sourceとlicenseが異なるため、`sources`配列を
`restaurant_overture_raw.sources_json`へ行単位で保存します。manifestのlicense値を全行へ
一律適用しません。OSMはraw/名寄せ根拠には常に保持しますが、ODbL上のderived/collective
database公開方針が承認されるまで、OSM canonicalのseedはGoogle検索・PG公開から既定で除外します。
承認後だけ`3_2 --include-osm-only`と`3_4 --allow-osm-only-publish`を明示します。

### 4つ目のソース: 自治体の食品営業許可台帳（1_6）

IFAS は 2021年6月の食品衛生法改正**以降**にオンライン申請された分しか持ちません。
改正前に許可を取った施設は各自治体が個別に公開しています（鹿児島市: IFAS 9,812 行 +
改正前の台帳 4,885 行）。#1276 の PoC で、Google の店に届かない分は**名寄せの失敗
ではなくデータの欠落**で、中心が**雑居ビル上階のスナック・バー**だと分かりました
（未到達 9.8% 対 到達 1.3% ＝ 7.6倍）。許可台帳の住所には階数が入るのでそこを指せます。

実測: Google 側から見た到達率は、台帳のある自治体で **66.5% → 78.9%**、
渋谷区（ArcGIS Hub から座標つきで取れ、階数入り、39,106 行と網羅的）では **84.1%**。

座標が無い台帳が多いので、`geocode_addresses.py`（国土地理院の住所検索API）で先に
解決します。13,896 件で命中率 100%、全件が番地レベルでした。座標が無い行も raw には
残し、`2_1` で落とします。

自治体ごとに列名も文字コードも公開形式も違うため、**落とした行は必ず理由つきで
数えます**（`1_6` の step に `dropped_reasons` として残る）。PoC では取り込み行数が
4,160 → 174,828 になるまでに、この数え上げを見て8回直しました。

### Google Place ID

根拠は「A と B の合意」ではなく **座標矩形の中での一意性** です（#1276 の PoC で
差し替え、`algorithm_version = box-unique-strict-v1`）。

1. 現行PostgreSQLの `google_place_id` は検索せずconfidence 1.0で引き継ぐ。
2. 未確定seedだけにText Search (New) ID Onlyを、**必要な順に必要なだけ**投げる。
   - `tight`: 店名、seed座標の **±25m 矩形 `locationRestriction`**
   - `wide`: 同じく **±250m 矩形**
   - Query A: 店名、seed座標の150m `locationBias`（裏取り）
   - Query B: 店名 + 住所、biasなし（裏取り。座標と独立な証拠）
3. 矩形の中に同名が **1件だけ** で、それを A か B が挙げていれば候補にする。
4. 候補が **±25m 矩形の中にあり**、かつ **B が1件以下** のときだけ自動採用する。
5. 0件、複数件、裏取りなし、住所なし、API errorは採用しない。
6. 人手修正は再生成で消えない `restaurant_google_place_match_overrides` に記録する。

**なぜ合意ベースをやめたか。** `locationBias` は絞り込みません。大阪の店名を東京の
bias で引いても大阪の店が返ります。店が Google に無ければ A も B も揃って**隣の店**を
返すので、2本が一致しても証拠になりません。負例での誤マッチ率は **11.3%** でした。
`locationRestriction` の矩形は外を実際に切り落とすので、「矩形の中に同名が1件しか
無い」が「取り違える相手が居ない」を意味します。

**4 の2条件は「確定したものは 100% 正しい」ための代償つきの選択です。** ラベル
6,000 件で確定 5,083 件・裁定後の誤り **0 件**（`mine_wrong` 0 件、95%下限 99.92%）。
外すと誤りが 8 件出る代わりに確定率が 11pt 上がります。条件はそのラベルの上で
選んでいるので、別のラベル集合でも 0 である保証はありません。

**裏取りは外せません。** ±25m 矩形が一意でも A も B もその place を挙げていない
195 件のうち、正解は 2 件（**1.0%**）でした。

probe は判定に要る順に送るので、実測 2.17 本/店です（4本全部送る場合と判定は不変）。

Field Maskは `places.id` のみです。Google由来の名称・住所・写真をText Search結果から保存しません。
新規open data店舗の `address_components_json` はGoogle由来に見せかけず空配列にし、既存PG値だけ
引き継ぎます。Place Detailsを将来取得する場合は `restaurant_details_raw` から別工程で昇格します。

## SNS媒体方針

`4_1` はInstagram/TikTok/Xをscrape・検索するscriptではありません。公式API、公式oEmbed、
提携、個別許諾で既に取得した投稿URL一覧だけを読み込みます。oEmbedは既知URLの表示方法であり、
無料の投稿発見APIとしては扱いません。

公開catalogの必須条件:

- providerとcanonical URL hostが一致する
- `rights_basis` が `official_api` / `official_oembed` / `partner_license` /
  `first_party_permission` のいずれか
- 最新状態が `available`
- 公式embed HTMLが存在する
- canonical/thumbnail URLがcredentialなしのHTTPS URLである
- Google Place IDがrestaurant catalogに存在し、店舗confidenceが既定0.95以上
- JP gateの134料理カテゴリに存在し、分類confidenceが既定0.80以上
- 1投稿に複数候補がある場合、最高confidenceの主カテゴリ1件だけを公開

外部投稿IDからUUID v5の `dish_media_id` を生成するため、再分類・再実行でもlike/impressionの
参照先は変わりません。削除/private観測はstate catalog経由でPGを非表示にします。
入力から消えただけでは削除とみなしません。削除・非公開は同じ投稿IDを
`deleted` / `private` / `unavailable`として明示的に観測します。

Coverageは「公開可能restaurantが1件以上あるS2 level 14 cell × JP gate 134カテゴリ」の
全直積です。0件の組合せも行として持つため、充足済みだけを数えて実態を過大評価しません。
初期目標は各cell/category 1店舗で、`--target-per-cell-category` で増やせます。

## 初回セットアップ

Python 3.11以上を想定します。

```bash
cd scripts/20260808T0000_restaurant
python -m venv .venv
.venv/bin/pip install -r requirements.txt

# Datasetはwikidata_food_graphとは別。既存なら変更しない
bash ../../infra/big-query/20260812T0000_setup_restaurant_recommendation_dataset.sh

export GCP_PROJECT=food-scroll
export BQ_DATASET=restaurant_recommendation
export BQ_REGION=asia-northeast1
export RESTAURANT_PIPELINE_RUN_ID=restaurant-2026-08-12

.venv/bin/python 1_1_create_tables.py
```

PostgreSQL同期前に次のmigrationをdev/publicへ適用してください。

```text
infra/supabase/migrations/20260823T0000_add_restaurant_recommendation_sync_metadata.sql
```

既存tablesには同期metadataだけを追加し、SNS固有列は
`dish_media_external_embeddings` 子tableへ隔離します。
APIは検索時にこの子tableを参照するため、deploy順は **migration → API/対応client → 9_*同期**
です。特に外部媒体を公開する`9_2`は、対応clientの展開後に実行します。

## 今回の納品範囲（#843 レストラン先行分）

この branch/PR には **restaurants への投入経路（1_x〜3_x, 8_1, 9_1）だけ**が
入っています。SNS 料理媒体の経路（`4_1` / `4_2` / `9_2` と
`1273_sns_dish_media_poc`、supabase の dish_media 系 migration）は統合ブランチ
（PR #1480）で後続納品します。本 README のセクション 4 と `9_2` の記述は
その後続分の予告です。

## GitHub Actions での実行（db-script-run.yml）

資格情報をローカルに置かず実行履歴を残すため、番号付きスクリプトは
`.github/workflows/db-script-run.yml`（workflow_dispatch）から実行できます。

- `script_path`: 例 `scripts/20260808T0000_restaurant/3_2_search_google_place_ids.py`
- `args`: 例 `--snapshot-date 2026-08-25 --execute --qps 40`
- `requirements_path`: `scripts/20260808T0000_restaurant/requirements.txt`

> ⚠️ **`requirements_path` を必ず明示すること。**
> workflow の既定値は **別プロジェクト**（`scripts/20251213T0000_wikidata_food_graph/`）を
> 指している。省略しても bigquery / psycopg2 は入るので 3_4・8_1・9_1 は動いてしまうが、
> **2_1 / 2_2 は `s2sphere` が無くて落ちる**（2026-08-30 に実際に落とした）。
> 常に `scripts/20260808T0000_restaurant/requirements.txt` を渡す。
>
> ⚠️ **1 本ずつ流し、終わってから次を投げること。**
> この workflow は `concurrency: db-script-run` で直列化しているが、
> `cancel-in-progress: false` でも **待機できるのは 1 本だけ**である。
> 実行中に 2 本を続けて投げると、**先に待っていた方が黙って cancel される**
> （GitHub の仕様: pending は concurrency group ごとに 1 本しか保持されない）。
>
> cancel された run は **job が 0 本のまま completed / cancelled になる**ので、
> 一覧の見た目では «流れなかった» ことに気付きにくい。2026-08-30 に
> `9_9_backfill_country_code.py --apply` がこれで無音のまま実行されず、
> 「適用済み」と誤認しかけた。**DB を変える script は、必ず単独で流して
> job のログを見るまで «適用済み» と言わない。**

**1_3〜1_6 の外部データは `1_0_fetch_and_load.py` 経由で流します。** job を
またいでファイルが残らないため、取得（Overture parquet / OSM PBF / IFAS CSV /
許可台帳）とロードを同じ job で行う入口です。取得元は PoC で固定したもの
（`0000_open_data_poc/sources.lock.json`、`1276_place_id_free_poc/results/`）を
使い、Overture は sha256 検証、許可台帳はジオコーダキャッシュ 13,896 件を
読み込んでから差分だけを解決します。

```text
script_path: scripts/20260808T0000_restaurant/1_0_fetch_and_load.py
args:        --source overture --run-id restaurant-2026-08-23 --snapshot-date 2026-08-23
             （--source は overture / osm / ifas / food_permit の4回 dispatch する）
```

前提が3つあります。

1. **BigQuery 権限**: workflow が借用する SA
   `feature-correction-writer@food-scroll` は現状 `wikidata_food_graph` への
   dataEditor しか持ちません。`restaurant_recommendation` Dataset へのデータセット
   単位の `roles/bigquery.dataEditor` 付与が必要です（GCP 側の IAM 操作。
   GitHub secret の追加ではありません）。
2. **Text Search キー**: `3_2 --execute` には GitHub Environment `development` の
   secret `PLACES_TEXT_SEARCH_API_KEY` が必要です（workflow が env として渡します）。
   キーはバッチ専用プロジェクト `nanitabeyo-places-batch` の `places-batch-key`
   を使います（#1331）。クォータは承認済みで Text Search 3,000,000/日・3,000/分。
3. **run_id**: `GCP_PROJECT` / `BQ_DATASET` / `BQ_REGION` は既定値
   （food-scroll / restaurant_recommendation / asia-northeast1）のままで動きます。
   run_id は env が使えないので、各スクリプトに `--run-id restaurant-2026-08-25`
   のように `args` で明示してください。

### 同期前 backup の読み戻し権限

`9_1_sync_restaurants.py` は更新前の PostgreSQL table を
`gs://nanitabeyo-private/system/PostgreSQL/csv_export/` へ保存します。
workflow の SA からこの backup を読み戻すには、管理権限を持つ principal で次を
一度適用してください。引数なしでは dry-run になり、IAM は変更されません。

```bash
./infra/gcp/20260826T0000_grant_feature_correction_backup_reader.sh
./infra/gcp/20260826T0000_grant_feature_correction_backup_reader.sh --apply
```

このスクリプトは backup prefix を GCS managed folder にし、その folder だけに
`roles/storage.objectViewer` を付与します。`storage.objects.list` はバケット単位の
権限であり、bucket IAM の `resource.name.startsWith` 条件では一覧範囲を prefix に
限定できないためです。適用後は既知 URI の読み出しに加え、必ず prefix を指定した
一覧取得が可能です。バケット全体を一覧する権限は付与しません。

managed folder の権限で一覧するリクエストには `prefix` と併せて `delimiter=/`、
`includeFoldersAsPrefixes=true` が必要です。通常の `gcloud storage ls <prefix>` は
後者を指定できないため 403 になりますが、Google Cloud Storage JSON API の
`objects.list` ではこの3項目を指定すれば一覧できます。backup URI が既知の場合の
`objects.get`（Python client の `download_as_bytes` など）には追加指定は不要です。

hosted runner は 1 job 最大6時間です。`3_2` は attempts の resume
（`algorithm_version` 単位）で続きから再開できるので、複数回 dispatch すれば
全件を消化できます。全コーパス約300万リクエスト（1.38M seed × 実測2.17本）は
分次3,000（≈50qps）で実働約17時間 ＝ 3〜4回の dispatch で完了します。

## 手動実行順

### 1. Raw snapshot

すべて同じ `RESTAURANT_PIPELINE_RUN_ID` とsnapshot日で実行します。取得fileはPOCの
`0000_open_data_poc/sources.lock.json`等でreleaseを固定し、URI、checksum、licenseを
manifestへ残します。

```bash
export DATABASE_URL='postgresql://...'

.venv/bin/python 1_2_import_existing_pg_restaurants.py \
  --snapshot-date 2026-08-12 --schema dev

.venv/bin/python 1_3_load_overture.py \
  --snapshot-date 2026-08-12 \
  --source-release 2026-07-22.0 \
  --parquet data/overture-asia.parquet \
  --source-uri 's3://overturemaps-us-west-2/release/2026-07-22.0/...'

.venv/bin/python 1_4_load_ifas.py \
  --snapshot-date 2026-08-12 --as-of 2026-08-12 \
  --source-release 2026-08-12 --directory data/ifas \
  --source-uri 'https://i2fas.mhlw.go.jp/'

.venv/bin/python 1_5_load_osm.py \
  --snapshot-date 2026-08-12 --source-release 2026-08-12 \
  --pbf data/japan-latest.osm.pbf \
  --source-uri 'https://download.geofabrik.de/asia/japan-latest.osm.pbf'
```

### 2. 共通化とseed

```bash
.venv/bin/python 2_1_build_restaurant_source_records.py \
  --snapshot-date 2026-08-12
.venv/bin/python 2_2_build_restaurant_seed_catalog.py
```

### 3. Google Place IDとrestaurant catalog

```bash
.venv/bin/python 3_1_seed_existing_google_place_ids.py

# まず候補だけ確認。APIもBQ書込も行わない
.venv/bin/python 3_2_search_google_place_ids.py --limit 100

# 少量batchから実測し、result_status分布を確認して徐々に増やす
# （APIサーバーの GOOGLE_MAPS_API_KEY とは別キー。Text Search IDs Only 専用）
export PLACES_TEXT_SEARCH_API_KEY='...'
.venv/bin/python 3_2_search_google_place_ids.py --limit 100 --execute

.venv/bin/python 3_3_build_google_place_match_catalog.py
.venv/bin/python 3_4_build_restaurant_catalog.py --service-cell-level 14

# 閉店の «根拠» を集める。判定はしない。Google は叩かない（課金ゼロ）
.venv/bin/python 3_6_build_closure_signals.py
```

`3_2` は `--limit` がrequest数の上限です。同algorithmのattemptはresume時に除外します。
1 seedにつき最大4 request（tight→A→B→wide、必要なprobeだけ送る）で、
PoC実測の平均は約2.17 request/seedでした。全SKUはText Search IDs Only（$0.00）です。
API keyはheaderで送り、query文字列・ID配列・HTTP status・採否だけを監査tableへ保存します。

### 4. SNS料理媒体とcoverage

入力はUTF-8 CSVまたはNDJSONです。必要列と例は
[`social_media.example.csv`](./social_media.example.csv)を参照してください。

```bash
.venv/bin/python 4_1_load_social_media.py \
  --observed-date 2026-08-12 \
  --input data/social-media-2026-08-12.csv \
  --source-uri 'gs://approved-input/social-media-2026-08-12.csv' \
  --source-release 2026-08-12 \
  --license-id official-oembed-terms

.venv/bin/python 4_2_build_dish_media_catalog.py \
  --observed-from 2026-01-01 --observed-to 2026-08-12 \
  --target-per-cell-category 1 --expected-category-count 134
```

### 8. 品質ゲート

```bash
.venv/bin/python 8_1_validate_catalogs.py --expected-category-count 134
```

重複、参照切れ、既存PG欠損、座標/JSON不正、coverage直積欠損はERRORです。
媒体の未充足率は初期投入を観測できるようWARNINGですが、最終充足判定では
`--fail-on-warning`を付けます。9_* は最新ERRORが全件PASSしていなければ起動しません。

### 9. PostgreSQL同期

必ず `dev --dry-run`、`dev`、動作確認、`public --dry-run`、`public` の順に進めます。
dry-runも実際のDMLとconstraint検査をtransaction内で行い、最後にrollbackします。

```bash
.venv/bin/python 9_1_sync_restaurants.py --schema dev --dry-run
.venv/bin/python 9_1_sync_restaurants.py --schema dev

.venv/bin/python 9_2_sync_dishes_and_media.py --schema dev --dry-run
.venv/bin/python 9_2_sync_dishes_and_media.py --schema dev

# publicは明示的な二重確認flagが必要
.venv/bin/python 9_1_sync_restaurants.py --schema public --dry-run --allow-public
.venv/bin/python 9_1_sync_restaurants.py --schema public --allow-public
.venv/bin/python 9_2_sync_dishes_and_media.py --schema public --dry-run --allow-public
.venv/bin/python 9_2_sync_dishes_and_media.py --schema public --allow-public
```

本実行前に対象tableをGCSへstreaming backupします。backup失敗時は同期を中止します。
BigQueryに無いPostgreSQL行は削除しません。`--skip-backup` は復旧手段を別途確保した緊急時だけ
使用します。

#### 上書きガードの検証（#843）

9_1 の「表示値を上書きする UPDATE」は、**アプリが作った行を絶対に触らない**ことが要件です
（2026-08-24 に 7 行が壊れた事故があり、その再発防止）。この性質は SQL を読んでも
「たまたま条件に当たっていないだけ」と区別できないので、実物の PostgreSQL で確かめます。

```bash
bash tests/test_9_1_overwrite_guard.sh       # 上書きガード本体（6項目）
bash tests/test_9_9_backfill.sh              # backfill の行選択（5項目）
python3 tests/test_9_1_backfill_guard.py     # backfill 漏れ «検知» の契約（7項目）
bash tests/test_9_1_display_update.sh        # 表示値を «変わる行» にしか書かない（5項目）
bash tests/test_9_1_provenance_update.sh     # provenance / seed / synced_at の分離（6項目）
bash tests/test_9_1_restaurant_links.sh      # リンクの追加・削除（6項目）
bash tests/test_9_1_address_fill.sh          # アプリ製の行の住所の穴埋め（5項目）
bash tests/test_9_1_work_table.sh            # 作業表が対象を取りこぼさない（7項目）
bash tests/test_pg_connect_survives_rollback.sh  # rollback で dev→public に化けない（5項目）
```

`test_pg_connect_survives_rollback.sh` は **«落ちない・壊れない・気付けない»**
種類の事故を止めるためのものです。PostgreSQL の `SET`（LOCAL 無し）は
トランザクションの一部なので、`connect_postgres` が接続後に流していた
`SET search_path TO dev, public` は **呼び出し側の `rollback()` で消えていました**。
そのあとに修飾なしの表名で SQL を流すと、**dev のつもりで public を触ります**。
2026-08-31 に実際に起き、`VACUUM (ANALYZE) restaurants` が public に当たりました。

対策は 2 段にしてあります。

1. **接続時オプションで渡す**（保険）。startup packet の値はセッション既定になるので、
   ROLLBACK はそこへ戻る
2. **`reapply_session_settings(connection, schema)` を呼ぶ**（本体）。
   **途中で rollback して SQL を続けるスクリプトは必ずこれを呼ぶ**

2 段にしているのは、**rollback の «戻り先» が環境で違う**からです。
Supabase はロールに `statement_timeout = 2min` を設定しており、これが接続時
オプションに勝ちます（同日に実測。長い文が 2 分で切られた）。
**どちらが勝つかに設計を依存させない。** 張り直して、効いたことを確かめます。

`test_9_1_backfill_guard.py` は、**検知が誤って発火しないこと**だけを見ています。
この判定は 2 回続けて偽陽性で同期を止めました（08-30 は «seed が付いているか» で
2,115 件、08-31 は «実行窓に入っているか» で 1 件）。どちらも «行を数える» 形で、
アプリ製の行を必ず巻き込みます。いまは «過去の同期が INSERT しているのに
`pipeline` の行が 1 件も無い» という全か無かの判定にしてあります。

その場にクラスタを立てて壊し、終わったら消すので、外部の DB は要りません
（`initdb` / `pg_ctl` / `psql` が要ります。既定は PostgreSQL 16）。

どちらのテストも **「直っていない状態で落ちること」を先に確かめる**構成にしています。
`test_9_1_overwrite_guard.sh` は旧ガードで事故を再現してから新ガードを試し、
`test_9_9_backfill.sh` は `source_seed_id` だけで絞ると余計な行を掴むことを示します。
新しい条件を足すときは、**その条件が無いと落ちるケース**も一緒に足してください。
そうしないと、条件を消しても緑のままになります。

## 本番（`public`）へ流す手順 <!-- runbook -->

`dev` で通したものを `public` へ持っていくための手順書。**上から順に実行し、
各段の «確認» を満たしてから次へ進む。** 途中で止めても `public` は壊れない
（9_1 は 1 トランザクションで、失敗すれば丸ごと巻き戻る）。

> 🚫 **絶対にやらないこと**
> - `3_2_search_google_place_ids.py` を再実行しない。**Google に課金が発生する
>   唯一のステップ**である。3_3 は 90 日以内の attempts を読むので、再実行は要らない
> - `9_9_backfill_created_by_source.py` を `public` で実行しない。`public` は
>   **一度も同期していない**ので «過去の同期が作った行» が存在しない。
>   実行窓が空なので、このスクリプトは正しく落ちる
> - `db-migrate.yml` を `target_schema: public` で勝手に dispatch しない。
>   オーナーが `public` と言ったときだけ

### なぜ 1_2 からやり直すのか

**BQ のカタログは «どちらの PG スキーマに対して作ったか» を持っている。**
`1_2` は対象スキーマの `restaurants` を `restaurant_existing_pg_raw` へ取り込み、
`3_1` がその行の `google_place_id` をそのまま carry-forward する。だから

- `dev` 向けに作ったカタログは、`dev` の行 id に紐づいた seed を含む
- `public` へ流すなら、`public` の行を材料に seed を組み直す必要がある

`1_2` は run_id × snapshot_date のパーティションを置き換えるので、**同じ run_id を
使い回してよい**（`public` 用に取り直すと `dev` の分は消える。`dev` へ戻すときは
`1_2 --schema dev` から同じ順で流し直す）。open data の生データ（1_3〜1_6）は
run_id で引くので、**run_id を変えると全部取り直しになる。変えないこと。**

### 0. 前提（ここが揃っていないと先へ進まない）

| # | 条件 | 確認方法 |
| --- | --- | --- |
| 0-1 | PR が main へマージ済み | — |
| 0-2 | migration 3 本が `public` に当たっている | 下記 |
| 0-3 | `dev` で 8_1 が 14/14 PASS、9_1 が成功している | 直近の run のログ |

0-2 の 3 本（いずれも `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` で冪等）:

| ファイル | 何を足すか |
| --- | --- |
| `20260823T0000_add_restaurant_recommendation_sync_metadata.sql` | `restaurants` に `source_seed_id` / `source_names` / `source_row_hash` / `synced_at` |
| `20260827T0000_add_restaurants_created_by_source.sql` | `restaurants.created_by_source`（既定 `'user'`） |
| `20260828T0000_add_restaurants_address_country_and_links.sql` | `restaurants.address` / `country_code` と `restaurant_links` テーブル |

`db-migrate.yml` を `target_schema: public` / `dry_run` で流して差分を確認してから、
**オーナーの指示で** 本適用する。既存行はすべて `created_by_source='user'` になる
（＝**同期はそれらの表示値を一切書き換えない**）。これが `public` の既存データを守る仕組みである。

### 1. `public` の既存行を BQ へ取り込む

```text
script_path: scripts/20260808T0000_restaurant/1_2_import_existing_pg_restaurants.py
args:        --run-id restaurant-2026-08-23 --schema public --snapshot-date 2026-08-23
```

確認: ログの `row_count` が `public.restaurants` の行数と一致すること。

### 2. seed を組み直す（約 100 分。Google は叩かない）

**1 本ずつ、前が終わってから次を dispatch する**（同時に投げると待機側が黙って cancel される）。

```text
2_1_build_restaurant_source_records.py  --run-id restaurant-2026-08-23 --snapshot-date 2026-08-23   ≈40分
2_2_build_restaurant_seed_catalog.py    --run-id restaurant-2026-08-23                              ≈55分
3_1_seed_existing_google_place_ids.py   --run-id restaurant-2026-08-23                              <1分
3_3_build_google_place_match_catalog.py --run-id restaurant-2026-08-23                              <1分
3_4_build_restaurant_catalog.py         --run-id restaurant-2026-08-23                              <1分
```

確認: 3_3 のログで `existing_pg_matched` の件数が 1 の `row_count` とおおむね一致すること
（`public` の既存行が Text Search 抜きで place_id を持ち込めている、の意）。

### 2-b. 表の健康状態を測る（同期が一度でも失敗しているなら必須）

```text
9_9_maintain_restaurants.py --schema public --allow-public              測るだけ
9_9_maintain_restaurants.py --schema public --allow-public --vacuum     VACUUM (ANALYZE)
```

**9_1 は 1 トランザクションなので失敗すれば内容は巻き戻るが、書きかけた行の
バージョンは «死んだ行» として表に残る。** 62 万行を書き換えて失敗した実行が
2 回あれば、62 万行の表に 120 万行ぶんの死骸が積む。以後の全ての走査が
その分だけ遅くなり、次の同期も落ちる——という悪循環になる。

2026-08-31 に dev で実際に起き、3 回目は
`SELECT COUNT(*) FROM restaurants` が 30 分で終わらなかった。

**同期が失敗したら、次を流す前にここを見る。** 死骸が 20% を超えていたら
`--vacuum` してから進む。数字を見ずに «もう一度流す» のは、遅くなった表を
さらに膨らませるだけである。

### 3. 品質ゲート

```text
8_1_validate_catalogs.py --run-id restaurant-2026-08-23 --skip-dish-media-checks
```

確認: **14 件すべて PASS。** 1 件でも ERROR なら `public` へは進まない。
特に `restaurant_catalog_free_of_google_values = 0`（Google 由来の値がカタログに
混ざっていない）は、規約上ここで止めるべき検査である。

### 4. `public` の既存行の `country_code` を埋める（同期の前）

通貨表示は `country_code` を先に見る。同期はアプリ製の行の表示値を触らないので、
**この列はその行自身の `address_components` から埋める**。

```text
9_9_backfill_country_code.py --schema public --allow-public              （まず dry run）
9_9_backfill_country_code.py --schema public --allow-public --apply
```

確認: `--apply` 前後で「埋まった件数」がログの想定と一致すること。NULL の行にしか書かない。

### 4-b. この同期が共有 DB にかける負荷（本番で何が起きるか）

**この DB は本番と共有している。** スキーマは分かれていても CPU・IO・接続枠は
同じ 1 台であり、2026-08-31 にこのバッチが本番障害を起こした。

`public` への**初回**同期は、dev の定常同期とは負荷の形が違う。

| | dev の定常同期 | **public の初回同期** |
| --- | --- | --- |
| 書く行 | 数千行 | **約 62 万行の INSERT** |
| リンク | ほぼ 0 | **約 136 万行の INSERT** |
| 走査 | 全表 2 回（作業表の作成） | 全表 2 回 |
| 支配的なコスト | 探す | **書く**（索引の構築を含む） |

初回は «書く» が支配的で、**軽くする方法は無い**（62 万店を入れるのだから
62 万行書く）。したがって次を守る。

- **低トラフィック帯に流す**
- **オーナーの承認を都度取る**（→ CLAUDE.md「共有 DB に負荷をかける作業の規則」）
- 20 分の予算（`SYNC_TIME_BUDGET_SECONDS`）を超えたら自分から降りる。
  初回でこれに掛かるなら、**上限を伸ばさず分割を実装する**

2 回目以降は作業表が効いて数千行になるので、この重さは初回だけである。

### 5. 同期の dry run

```text
9_1_sync_restaurants.py --run-id restaurant-2026-08-23 --schema public --dry-run --allow-public
```

dry run も実 DML と制約検査をトランザクション内で行い、最後に rollback する。

確認: 3 つ全部を見る。

- `insert` の件数が想定（≒ カタログ件数 − `public` の既存一致分）に収まっている
- 検証エラー（Place ID の暗黙変更 / place_id の取り合い / backfill 漏れ）が 0 件
- **文ごとの所要時間**が出るので、30 分（statement timeout）に近い文が無いこと

### 6. 本適用

```text
9_1_sync_restaurants.py --run-id restaurant-2026-08-23 --schema public --allow-public
```

実行前に `public.restaurants` を GCS へ backup する（失敗したら同期しない）。
BigQuery に無い PostgreSQL の行は**削除しない**。

### 7. 事後確認

```text
9_9_verify_sync_result.py     --schema public --allow-public
9_9_audit_column_coverage.py  --schema public --allow-public
```

確認: `created_by_source='user'` の行の name / image_url / image_path が
同期前と変わっていないこと（＝既存データが欠けても書き換わってもいない）。

### 巻き戻し

| いつ | どうなるか | 戻し方 |
| --- | --- | --- |
| 2〜3 で失敗 | `public` は無傷（BQ しか触っていない） | 直して流し直す |
| 5 の dry run で失敗 | `public` は無傷（rollback される） | 直して流し直す |
| 6 の途中で失敗 | `public` は無傷（1 トランザクション） | 直して流し直す |
| 6 が成功した後で問題が見つかった | 行が入っている | 手順 6 の直前に取った GCS backup から `restaurants` を戻す |

**migration 自体の巻き戻しは要らない。** 足した列はすべて NULLABLE か既定値付きで、
既存のコードは列があっても無くても動く。列を消すより、同期した行を消す方が安全である。

## 保留機能の受け口

- `restaurant_reviews_raw`: rating原値/正規化値、本文、言語、公開状態、権利根拠を保持
- `restaurant_details_raw`: 営業時間、臨時休業、LO、個室、禁煙、駐車場、子連れ、
  バリアフリー、Wi-Fi、決済、予約等を `attribute_key` + 型付きvalueで保持

どちらも現時点ではcatalog化・PostgreSQL同期・API配信しません。権利と鮮度SLA、優先source、
競合解決規則が決まってから別stepで昇格します。

## 今回含めないもの

- Cloud Scheduler / Workflowsによる定期実行
- 事前検索が1件以上ある場合のGoogle補完など、クライアントfallback変更
- レビュー・詳細属性のserving仕様

上記は実データ投入後の件数・品質・UXを見て別ticketで判断します。

## テスト

```bash
# 純粋な正規化・名寄せ・Google採否・SNS入力契約
.venv/bin/python -m unittest -v test_restaurant_pipeline.py

# 既存POCの回帰
python -m unittest -v 0000_open_data_poc/test_open_data_poc.py
```
