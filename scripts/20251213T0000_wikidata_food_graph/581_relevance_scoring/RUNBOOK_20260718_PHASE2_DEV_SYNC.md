# #853 phase2 features MERGE and dev sync runbook

## 目的

`wikidata_food_graph.wikidata_food_llm_feature_scores` に投入済みの
`run_id = '20260718_phase2_#853_料理提案精度改善_202607'` を
BigQuery 採用版 `dish_category_features_catalog` に MERGE し、その後
PostgreSQL `dev.dish_category_features` へ反映する。

## 前提

- phase1 はすでに `dish_category_features_catalog` へ全置換済み。
- phase1 反映後の BigQuery 採用版は `3,249 rows / 134 items / JP gate 134`。
- phase2 は `timeSlot:morning` と `timeSlot:dinner` の補正だけを持つ。
- phase2 反映後、PostgreSQL dev は `9_2_sync_dish_category_features.py` だけ再実行すればよい。
  `dish_categories`, `dish_category_localized_text`, `dish_category_variants` は phase2 features MERGE では変わらない。

## 1. 環境変数

```bash
cd /root/workspace/nanitabeyo

export GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/service-account-key/food-scroll-2bc35f43cfea.json
set -a
source scripts/.env
set +a
```

## 2. phase2 source precheck

phase2 run の形を確認する。

```bash
python3 - <<'PY'
from google.cloud import bigquery

client = bigquery.Client(project="food-scroll")
run_id = "20260718_phase2_#853_料理提案精度改善_202607"

queries = {
    "summary": """
      WITH src AS (
        SELECT item_qid, feature_type, feature_key, score
        FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_feature_scores`
        WHERE run_id = @run_id
      ),
      dup AS (
        SELECT item_qid, feature_type, feature_key, COUNT(*) AS row_count
        FROM src
        GROUP BY item_qid, feature_type, feature_key
        HAVING COUNT(*) > 1
      ),
      catalog_miss AS (
        SELECT DISTINCT s.item_qid
        FROM src s
        LEFT JOIN `food-scroll.wikidata_food_graph.dish_category_catalog` c
          ON c.item_qid = s.item_qid
        WHERE c.item_qid IS NULL
      )
      SELECT 'source_rows' AS metric, COUNT(*) AS value FROM src
      UNION ALL SELECT 'source_items', COUNT(DISTINCT item_qid) FROM src
      UNION ALL SELECT 'source_feature_pairs', COUNT(DISTINCT CONCAT(feature_type, '\\u0001', feature_key)) FROM src
      UNION ALL SELECT 'duplicate_keys', COUNT(*) FROM dup
      UNION ALL SELECT 'catalog_missing_items', COUNT(*) FROM catalog_miss
    """,
    "by_feature": """
      SELECT
        feature_type,
        feature_key,
        COUNT(*) AS row_count,
        COUNT(DISTINCT item_qid) AS item_count
      FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_feature_scores`
      WHERE run_id = @run_id
      GROUP BY feature_type, feature_key
      ORDER BY feature_type, feature_key
    """,
}

config = bigquery.QueryJobConfig(
    query_parameters=[bigquery.ScalarQueryParameter("run_id", "STRING", run_id)]
)

for name, query in queries.items():
    print(f"## {name}")
    for row in client.query(query, job_config=config).result():
        print(dict(row))
PY
```

期待値:

```text
source_rows = 124
source_items = 122
source_feature_pairs = 2
duplicate_keys = 0
catalog_missing_items = 0

timeSlot:dinner  = 4 rows
timeSlot:morning = 120 rows
```

## 3. BigQuery `dish_category_features_catalog` へ MERGE

SQL は precheck `ASSERT` 付き。想定件数からズレた場合は mutation 前に止まる。

```bash
bq query --use_legacy_sql=false \
  < scripts/20251213T0000_wikidata_food_graph/581_relevance_scoring/sql/merge_phase2_features_catalog_20260718.sql
```

`bq` が PATH にない場合:

```bash
export PATH=/home/ubuntu/.local/google-cloud-sdk/bin:$PATH
```

期待される postcheck:

```text
run_id = 20260718_phase2_#853_料理提案精度改善_202607
timeSlot:dinner  = 4 rows
timeSlot:morning = 120 rows

total_rows = 3249
total_items = 134
positive_jp_gate_rows = 134
```

## 4. BigQuery 反映後確認

```bash
python3 - <<'PY'
from google.cloud import bigquery

client = bigquery.Client(project="food-scroll")
q = """
SELECT
  COUNT(*) AS total_rows,
  COUNT(DISTINCT item_qid) AS total_items,
  COUNTIF(feature_type='gate' AND feature_key='region:country:JP' AND score > 0) AS positive_jp_gate_rows,
  COUNTIF(run_id='20260718_phase2_#853_料理提案精度改善_202607') AS phase2_rows
FROM `food-scroll.wikidata_food_graph.dish_category_features_catalog`
"""
for row in client.query(q).result():
    print(dict(row))
PY
```

期待値:

```text
total_rows = 3249
total_items = 134
positive_jp_gate_rows = 134
phase2_rows = 124
```

## 5. PostgreSQL dev dry-run

phase2 で変わるのは features だけなので、`9_2` のみ dry-run する。

```bash
python3 scripts/20251213T0000_wikidata_food_graph/9_2_sync_dish_category_features.py --schema dev --dry-run
```

期待値:

```text
Fetched 3249 features from BigQuery
Would sync 3249 features
```

## 6. PostgreSQL dev 本実行

`dev.dish_category_features` は全削除後に BigQuery 採用版を INSERT する。
スクリプトが実行前に GCS backup を作る。

```bash
python3 scripts/20251213T0000_wikidata_food_graph/9_2_sync_dish_category_features.py --schema dev
```

期待値:

```text
Backed up ... dish_category_features.csv
Deleted 3249 existing features
Inserted 3249 features
```

## 7. PostgreSQL dev 確認

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
SET search_path TO dev;
SELECT
  COUNT(*) AS total_rows,
  COUNT(DISTINCT dish_category_id) AS total_items,
  COUNT(*) FILTER (
    WHERE feature_type='gate'
      AND feature_key='region:country:JP'
      AND score > 0
  ) AS positive_jp_gate_rows
FROM dish_category_features;
" -c "
SET search_path TO dev;
SELECT
  feature_type,
  feature_key,
  COUNT(*) AS row_count,
  COUNT(DISTINCT dish_category_id) AS item_count
FROM dish_category_features
WHERE feature_type = 'timeSlot'
GROUP BY feature_type, feature_key
ORDER BY feature_key;
"
```

期待値:

```text
total_rows = 3249
total_items = 134
positive_jp_gate_rows = 134

timeSlot:dinner     134 rows
timeSlot:late_night 134 rows
timeSlot:lunch      134 rows
timeSlot:morning    134 rows
```

注: `timeSlot:dinner` と `timeSlot:morning` は各 134 rows のままだが、そのうち `dinner` 4 rows / `morning` 120 rows が phase2 score で上書き済み。

## 8. API 確認

dev API で代表ケースを確認する。

見る観点:

- レスポンスが空にならない。
- `gate` が 134 QID ベースになっている。
- `timeSlot=morning` / `timeSlot=dinner` の順位やスコアが phase2 反映前の期待から改善している。
- `timeSlot=lunch` / `timeSlot=late_night` が壊れていない。

推奨ケース:

```text
timeSlot=morning, scene=solo
timeSlot=lunch, scene=friends
timeSlot=dinner, scene=date
timeSlot=late_night, scene=drinking
```

API の具体的な叩き方は環境の backend base URL / 認証方式に合わせる。
既存の functional runner を使う場合は、`api/test/functional/v1/dish-categories` の設定に従う。

## 9. 問題が出た場合

PostgreSQL dev の戻しは、`9_2` 実行時に出力された GCS backup CSV を使う。
BigQuery 採用版の戻しは、phase1 全置換 SQL を再実行する。

```bash
bq query --use_legacy_sql=false \
  < scripts/20251213T0000_wikidata_food_graph/581_relevance_scoring/sql/replace_features_catalog_from_run_20260718_phase1.sql
```

その後、再度 dev へ `9_2_sync_dish_category_features.py --schema dev` を実行する。
