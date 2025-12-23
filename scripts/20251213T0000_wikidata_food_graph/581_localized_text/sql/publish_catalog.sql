-- #581 【設計】catalog への publish SQL
-- wikidata_food_copy_generations から confidence='high' のみを抽出し、
-- dish_category_localized_text_catalog に MERGE で反映（Pass2 優先）

MERGE `{dataset}.dish_category_localized_text_catalog` AS target
USING (
  -- #581 【設計】Pass2 結果が存在する場合は Pass2 を優先、なければ Pass1
  WITH pass2_results AS (
    SELECT
      item_qid,
      locale,
      topic_title,
      tagline,
      model,
      run_id,
      created_at
    FROM `{dataset}.wikidata_food_copy_generations`
    WHERE run_id = '{pass2_run_id}'
      AND confidence IN {adopt_confidence}
  ),
  pass1_results AS (
    SELECT
      item_qid,
      locale,
      topic_title,
      tagline,
      model,
      run_id,
      created_at
    FROM `{dataset}.wikidata_food_copy_generations`
    WHERE run_id = '{pass1_run_id}'
      AND confidence IN {adopt_confidence}
  ),
  -- #581 【設計】Pass2 優先でユニオン（Pass2 があれば Pass1 は除外）
  final_results AS (
    SELECT
      item_qid,
      locale,
      topic_title,
      tagline,
      model,
      run_id,
      created_at
    FROM pass2_results
    
    UNION ALL
    
    SELECT
      p1.item_qid,
      p1.locale,
      p1.topic_title,
      p1.tagline,
      p1.model,
      p1.run_id,
      p1.created_at
    FROM pass1_results p1
    LEFT JOIN pass2_results p2
      ON p1.item_qid = p2.item_qid
      AND p1.locale = p2.locale
    WHERE p2.item_qid IS NULL
  )
  SELECT
    item_qid,
    locale,
    topic_title,
    tagline,
    'llm' AS source,
    run_id AS selected_run_id,
    CURRENT_TIMESTAMP() AS updated_at,
    CONCAT('model=', model, ' | pass=', 
      CASE 
        WHEN run_id LIKE '%_p2' THEN 'pass2'
        ELSE 'pass1'
      END
    ) AS note
  FROM final_results
) AS source
ON target.item_qid = source.item_qid
  AND target.locale = source.locale
WHEN MATCHED THEN
  UPDATE SET
    topic_title = source.topic_title,
    tagline = source.tagline,
    source = source.source,
    selected_run_id = source.selected_run_id,
    updated_at = source.updated_at,
    note = source.note
WHEN NOT MATCHED THEN
  INSERT (item_qid, locale, topic_title, tagline, source, selected_run_id, updated_at, note)
  VALUES (source.item_qid, source.locale, source.topic_title, source.tagline, 
          source.source, source.selected_run_id, source.updated_at, source.note)
