-- #853 料理提案精度改善: dish_category_features_catalog 全置換 SQL
--
-- 【目的】
-- wikidata_food_llm_feature_scores の特定 run_id を、BigQuery 側の採用版
-- dish_category_features_catalog として丸ごと publish する。
--
-- 【通常の publish_features.sql との違い】
-- 既存の #581 publish_features.sql は MERGE 型で、既存 feature を温存しながら
-- timeSlot / scene / satiety / taste などを更新するためのパイプライン。
-- 今回は「gate 自体を #853 の 134 QID に絞る」「古い feature/key を消して
-- feature catalog を掃除する」ことが目的なので、MERGE ではなく全削除→INSERT
-- を明示的に行う。
--
-- 【この SQL が責任を持つ範囲】
-- - BigQuery `dish_category_features_catalog` の中身を全削除する。
-- - `target_run_id` に一致する `wikidata_food_llm_feature_scores` を採用版として投入する。
-- - 投入前に、空データ・重複 key・不正 score・catalog 外 QID・gate 欠損を ASSERT で止める。
-- - `note` に元ログの confidence / reason / model / phase / task / source_run_id を残す。
--
-- 【この SQL が責任を持たない範囲】
-- - PostgreSQL `dish_category_features` への反映。
--   これは `9_2_sync_dish_category_features.py` を別途 dry-run → 本実行する。
-- - 推薦 API の挙動確認。
--   BigQuery 反映後、PostgreSQL sync 後に代表クエリ/APIで確認する。
-- - satiety / taste:alcohol / timeSlot:afternoon の補完。
--   今回は古い feature/key を消す方針のため、存在しない key は意図的に復元しない。
--
-- 【実行前に確認した前提】
-- - 対象 run は 3,249 rows / 134 items。
-- - 対象 run の gate:region:country:JP は 134 items 全件 score=1。
-- - 対象 run に重複 (item_qid, feature_type, feature_key) はない。
-- - 対象 run に catalog 外 QID はない。
--
-- 【実行コマンド例】
-- bq query --use_legacy_sql=false \
--   < scripts/20251213T0000_wikidata_food_graph/581_relevance_scoring/sql/replace_features_catalog_from_run_20260718_phase1.sql

-- BigQuery scripting では、変数名が列名と同じだと SQL 本体の名前解決で
-- 列が優先され、`WHERE run_id = RUN_ID` が意図せず `run_id = run_id`
-- 相当になるリスクがある。そのため列名と衝突しない変数名にする。
DECLARE target_run_id STRING DEFAULT '20260718_phase1_#853_料理提案精度改善_202607';
DECLARE expected_item_count INT64 DEFAULT 134;
DECLARE expected_gate_positive_count INT64 DEFAULT 134;

-- ---------------------------------------------------------------------------
-- Precheck 1: source が空ではないこと
-- ---------------------------------------------------------------------------
ASSERT (
  SELECT COUNT(*) > 0
  FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_feature_scores`
  WHERE run_id = target_run_id
) AS 'source run_id has no rows';

-- ---------------------------------------------------------------------------
-- Precheck 2: 必須列と score が壊れていないこと
-- ---------------------------------------------------------------------------
ASSERT (
  SELECT COUNT(*) = 0
  FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_feature_scores`
  WHERE run_id = target_run_id
    AND (
      item_qid IS NULL OR item_qid = ''
      OR feature_type IS NULL OR feature_type = ''
      OR feature_key IS NULL OR feature_key = ''
      OR score IS NULL
      OR score < 0 OR score > 1
      OR task IS NULL OR task = ''
      OR phase IS NULL OR phase = ''
      OR model IS NULL OR model = ''
    )
) AS 'source run_id has invalid rows';

-- ---------------------------------------------------------------------------
-- Precheck 3: BigQuery は PK を持たないため、採用版に重複 key を入れない。
-- PostgreSQL sync 先は (dish_category_id, feature_type, feature_key) が PK なので、
-- ここで止めておく。
-- ---------------------------------------------------------------------------
ASSERT (
  SELECT COUNT(*) = 0
  FROM (
    SELECT item_qid, feature_type, feature_key
    FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_feature_scores`
    WHERE run_id = target_run_id
    GROUP BY item_qid, feature_type, feature_key
    HAVING COUNT(*) > 1
  )
) AS 'source run_id has duplicate item_qid/feature_type/feature_key rows';

-- ---------------------------------------------------------------------------
-- Precheck 4: dish_category_catalog 外の QID を採用版に混ぜない。
-- catalog に存在しない QID は PostgreSQL の dish_categories にも存在しない可能性が高く、
-- sync 時の FK エラーや孤立データの原因になる。
-- ---------------------------------------------------------------------------
ASSERT (
  SELECT COUNT(*) = 0
  FROM (
    SELECT DISTINCT s.item_qid
    FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_feature_scores` s
    LEFT JOIN `food-scroll.wikidata_food_graph.dish_category_catalog` c
      ON c.item_qid = s.item_qid
    WHERE s.run_id = target_run_id
      AND c.item_qid IS NULL
  )
) AS 'source run_id contains item_qids that are not in dish_category_catalog';

-- ---------------------------------------------------------------------------
-- Precheck 5: 今回の設計では gate が推薦候補集合そのもの。
-- ここが 134 件からズレると、推薦候補の件数が意図せず変わるので止める。
-- ---------------------------------------------------------------------------
ASSERT (
  SELECT COUNT(DISTINCT item_qid) = expected_item_count
  FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_feature_scores`
  WHERE run_id = target_run_id
) AS 'source distinct item count does not match EXPECTED_ITEM_COUNT';

ASSERT (
  SELECT COUNT(DISTINCT item_qid) = expected_gate_positive_count
  FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_feature_scores`
  WHERE run_id = target_run_id
    AND feature_type = 'gate'
    AND feature_key = 'region:country:JP'
    AND score > 0
) AS 'source positive JP gate count does not match EXPECTED_GATE_POSITIVE_COUNT';

-- ---------------------------------------------------------------------------
-- Mutation: 全削除 → 指定 run_id を採用版として投入
-- ---------------------------------------------------------------------------
BEGIN TRANSACTION;

DELETE FROM `food-scroll.wikidata_food_graph.dish_category_features_catalog`
WHERE TRUE;

INSERT INTO `food-scroll.wikidata_food_graph.dish_category_features_catalog` (
  item_qid,
  feature_type,
  feature_key,
  score,
  source,
  run_id,
  updated_at,
  note
)
SELECT
  item_qid,
  feature_type,
  feature_key,
  score,
  model AS source,
  target_run_id AS run_id,
  CURRENT_TIMESTAMP() AS updated_at,
  TO_JSON_STRING(STRUCT(
    confidence,
    reason,
    model,
    phase,
    task,
    run_id AS source_run_id,
    created_at AS source_created_at
  )) AS note
FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_feature_scores`
WHERE run_id = target_run_id;

COMMIT TRANSACTION;

-- ---------------------------------------------------------------------------
-- Postcheck: 実行後にこの結果が返ることを確認する。
-- ---------------------------------------------------------------------------
SELECT
  feature_type,
  COUNT(*) AS row_count,
  COUNT(DISTINCT item_qid) AS item_count,
  ARRAY_AGG(DISTINCT feature_key ORDER BY feature_key) AS feature_keys
FROM `food-scroll.wikidata_food_graph.dish_category_features_catalog`
GROUP BY feature_type
ORDER BY feature_type;

SELECT
  COUNT(*) AS total_rows,
  COUNT(DISTINCT item_qid) AS total_items,
  COUNTIF(feature_type = 'gate' AND feature_key = 'region:country:JP' AND score > 0) AS positive_jp_gate_rows
FROM `food-scroll.wikidata_food_graph.dish_category_features_catalog`;
