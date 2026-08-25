-- #737 【SQL】承認済みの季節曲線を dish_category_features_catalog へ MERGE
--
-- 【仕様】
-- - feature_type = 'season'
-- - feature_key  = '<REGION_SCOPE>:month:MM'（例: 'region:country:JP:month:08'）
-- - score        = LEAST(index_value, 1.0)
-- - source       = 'wikipedia_pageviews'
--
-- 【なぜ LEAST(index, 1.0) なのか】
-- 補正係数は `1 - w + w × score` で、score = 1 のとき係数がちょうど 1.0 になる。
-- つまり **1.0 が「無補正」の意味**。1 を超える値を入れると係数が 1 を超え、
-- 押し上げになってしまう。押し上げ（夏にかき氷を上げる）はスコアではなく
-- スレートの「旬枠」でやる方針なので（#737 Phase 2）、ここでは 1.0 で頭を打つ。
--
-- 【なぜ approve された分だけ入れるのか】
-- 実測で「カフェ」「和食」のような抽象カテゴリや、sitelink が別記事を指していた
-- 「日本の餃子」に偽の季節性が出た。行が無ければ推薦側は COALESCE(...,1) で
-- 係数 1.0 になり完全に無影響なので、**迷ったら入れない**のが安全側。
--
-- 【DELETE 分岐】同じ (feature_type, feature_key) で以前 approve していたものが
-- reject へ変わった場合、行を消さないと古い補正が残り続ける。
-- 消す対象は「この REGION_SCOPE の season 行」だけに限定する。

MERGE `${DATASET}.dish_category_features_catalog` AS target
USING (
  WITH latest_review AS (
    -- review は append-only なので、(item_qid, run_id) ごとに最新の 1 件を採用する
    SELECT * EXCEPT(rn) FROM (
      SELECT
        r.*,
        ROW_NUMBER() OVER (PARTITION BY r.item_qid ORDER BY r.created_at DESC) AS rn
      FROM `${DATASET}.dish_category_seasonality_review` r
      WHERE r.run_id = '${RUN_ID}'
    )
    WHERE rn = 1
  )
  SELECT
    c.item_qid,
    'season' AS feature_type,
    CONCAT('${REGION_SCOPE}', ':month:', FORMAT('%02d', c.month)) AS feature_key,
    LEAST(c.index_value, 1.0) AS score,
    'wikipedia_pageviews' AS source,
    '${RUN_ID}' AS run_id,
    CURRENT_TIMESTAMP() AS updated_at,
    TO_JSON_STRING(STRUCT(
      c.index_value AS index_value,
      c.amplitude AS amplitude,
      c.monthly_pv_mean AS monthly_pv_mean,
      c.article AS article,
      c.wiki AS wiki,
      v.reviewer AS reviewer,
      v.reason AS review_reason,
      '${TASK}' AS task
    )) AS note
  FROM `${DATASET}.dish_category_seasonality_curve` c
  JOIN latest_review v ON v.item_qid = c.item_qid
  WHERE c.run_id = '${RUN_ID}'
    AND v.decision = 'approve'
) AS source
ON target.item_qid = source.item_qid
  AND target.feature_type = source.feature_type
  AND target.feature_key = source.feature_key
WHEN MATCHED THEN
  UPDATE SET
    score = source.score,
    source = source.source,
    run_id = source.run_id,
    updated_at = source.updated_at,
    note = source.note
WHEN NOT MATCHED THEN
  INSERT (item_qid, feature_type, feature_key, score, source, run_id, updated_at, note)
  VALUES (source.item_qid, source.feature_type, source.feature_key, source.score,
          source.source, source.run_id, source.updated_at, source.note)
WHEN NOT MATCHED BY SOURCE
  AND target.feature_type = 'season'
  AND STARTS_WITH(target.feature_key, CONCAT('${REGION_SCOPE}', ':month:'))
  THEN DELETE
