#!/bin/bash
set -euo pipefail

# 流し方
# DATABASE_URL=postgresql://xxx bash scripts/generate-dish-categories/index.sh

# ========== SETTINGS ==========
WDQS_URL="https://query.wikidata.org/sparql"
PSQL_ARGS=()
PSQL_ARGS+=("$DATABASE_URL")
DB_SCHEMA="dev"
WORKDIR="$(cd "$(dirname "$0")" && pwd)"
TMPDIR="${WORKDIR}/../../data/dish_master_tmp"
DISHES_CSV="$(realpath "${TMPDIR}/dishes_pg.csv")"
VARIANTS_CSV="$(realpath "${TMPDIR}/variants.csv")"
mkdir -p "$TMPDIR"

echo "▼ Start generating dish categories..."

# ========== STEP 1: Get core dish info (QID, label, tags, etc.) ==========
echo "→ [1] Fetching dishes_with_tags from Wikidata..."

curl -sG "${WDQS_URL}" \
  --data-urlencode query@"${WORKDIR}/dishes_with_tags.rq" \
  -H "Accept: text/csv" \
  -H "User-Agent: food-app/0.1 (contact: you@example.com)" \
  -o "${TMPDIR}/dishes_raw.csv"

echo "✅ Raw dish data saved to ${TMPDIR}/dishes_raw.csv"

# ========== STEP 2: Preprocess CSV to PostgreSQL format ==========
echo "→ [2] Transforming CSV to PostgreSQL-compatible format..."

tr -d '\r' < "${TMPDIR}/dishes_raw.csv" | csvsql -d , --query "
SELECT
  dish AS id,
  labelEN AS label_en,
  '{}' AS labels,
  COALESCE(image, '') AS image_url,
  CASE WHEN origins  IS NULL OR origins  = '' THEN '{}' ELSE '{'||REPLACE(origins, '|', ',') ||'}' END AS origin,
  CASE WHEN cuisines IS NULL OR cuisines = '' THEN '{}' ELSE '{'||REPLACE(cuisines,'|', ',') ||'}' END AS cuisine,
  CASE WHEN tags     IS NULL OR tags     = '' THEN '{}' ELSE '{'||REPLACE(tags,    '|', ',') ||'}' END AS tags
FROM stdin
" > "${DISHES_CSV}"

echo "✅ Preprocessed to ${DISHES_CSV}"

# ========== STEP 3: Import dish_categories ==========
echo "→ [3] Importing into dish_categories table..."

psql "${PSQL_ARGS[@]}" -v ON_ERROR_STOP=1 \
  -v schema="${DB_SCHEMA:-public}" <<SQL
SET search_path TO :"schema";

CREATE TEMP TABLE tmp_dishes (
  id TEXT,
  label_en TEXT,
  labels JSONB,
  image_url TEXT,
  origin TEXT[],
  cuisine TEXT[],
  tags TEXT[]
);

\copy tmp_dishes FROM '${DISHES_CSV}' CSV HEADER

\echo [psql] dup_count=
SELECT count(*) FROM (
  SELECT id FROM tmp_dishes GROUP BY id HAVING count(*) > 1
) s;

UPDATE tmp_dishes
SET image_url = ''
WHERE image_url IS NULL OR image_url = 'NULL';

-- 既存: tmp_dishes に \copy → 画像あり優先の1行に間引く
DROP TABLE IF EXISTS tmp_dishes_one;
CREATE TEMP TABLE tmp_dishes_one AS
SELECT DISTINCT ON (id)
       id, label_en, labels, image_url, origin, cuisine, tags
FROM tmp_dishes
ORDER BY id, (image_url = ''), image_url DESC;

-- 追加: label_en を小文字化したキーで重複排除（QID数値が最小を採用）
DROP TABLE IF EXISTS tmp_dishes_by_label;
CREATE TEMP TABLE tmp_dishes_by_label AS
WITH numbered AS (
  SELECT *,
         LOWER(label_en) AS label_key,
         REGEXP_REPLACE(id, '.*Q([0-9]+)$', '\1')::bigint AS qnum
  FROM tmp_dishes_one
)
SELECT DISTINCT ON (label_key)
       id, label_en, labels, image_url, origin, cuisine, tags
FROM numbered
ORDER BY label_key, qnum;  -- 小さいQIDが勝ち

DELETE FROM dish_category_variants;
DELETE FROM dish_categories;

INSERT INTO dish_categories
(id, label_en, labels, image_url, origin, cuisine, tags)
SELECT
  CASE
    WHEN id ~ '^http' THEN REGEXP_REPLACE(id, '.*/(Q[0-9]+)$', '\1')
    ELSE id
  END AS id,
  label_en,
  labels,
  image_url,
  COALESCE(origin,  ARRAY[]::text[]),
  COALESCE(cuisine, ARRAY[]::text[]),
  COALESCE(tags,    ARRAY[]::text[])
FROM tmp_dishes_by_label
ON CONFLICT (id) DO UPDATE
SET label_en = EXCLUDED.label_en,
    image_url = COALESCE(NULLIF(EXCLUDED.image_url, 'NULL'), ''),
    origin = EXCLUDED.origin,
    cuisine = EXCLUDED.cuisine,
    tags = EXCLUDED.tags,
    updated_at = now(),
    lock_no = dish_categories.lock_no + 1;
  \copy (SELECT id, label_en FROM dish_categories) TO '${TMPDIR}/dishes_final.csv' CSV HEADER
SQL

echo "✅ dish_categories updated."

# ========== STEP 4: Fetch multilingual labels ==========
echo "→ [4-1] Fetching multilingual labels from Wikidata..."

curl -sG "${WDQS_URL}" \
  --data-urlencode query@"${WORKDIR}/labels_lang.rq" \
  -H "Accept: text/csv" \
  -H "User-Agent: food-app/0.1 (contact: you@example.com)" \
  -o "${TMPDIR}/labels.csv"

echo "✅ Multilingual labels saved to ${TMPDIR}/labels.csv"

echo "→ [4-2] Applying multilingual labels to dish_categories..."

psql "${PSQL_ARGS[@]}" -v ON_ERROR_STOP=1 \
  -v schema="${DB_SCHEMA:-public}" <<SQL
SET search_path TO :"schema";

-- labels.csv を受ける一時テーブル
CREATE TEMP TABLE tmp_labels_raw (
  id TEXT,
  lang TEXT,
  label TEXT
);

\copy tmp_labels_raw FROM '${TMPDIR}/labels.csv' CSV HEADER

-- ID 形式を dish_categories.id (= 'Q12345' など) に正規化
-- URLが入ってきたケースにも対応
DROP TABLE IF EXISTS tmp_labels_norm;
CREATE TEMP TABLE tmp_labels_norm AS
SELECT
  CASE
    WHEN id ~ '^http' THEN REGEXP_REPLACE(id, '.*/(Q[0-9]+)$', '\1')
    ELSE id
  END AS id,
  LOWER(lang) AS lang,
  label
FROM tmp_labels_raw
WHERE lang IS NOT NULL AND label IS NOT NULL AND label <> '';

-- 同一 (id,lang) の重複がある場合は、短いラベルを優先（任意の方針）
DROP TABLE IF EXISTS tmp_labels_dedup;
CREATE TEMP TABLE tmp_labels_dedup AS
SELECT DISTINCT ON (id, lang)
       id, lang, label
FROM tmp_labels_norm
ORDER BY id, lang, LENGTH(label), label;

-- lang -> label の JSONB に集約
DROP TABLE IF EXISTS tmp_labels_json;
CREATE TEMP TABLE tmp_labels_json AS
SELECT id, jsonb_object_agg(lang, label) AS labels
FROM tmp_labels_dedup
GROUP BY id;

-- dish_categories.labels を更新 (labels.csv の内容を優先して上書き)
UPDATE dish_categories d
SET labels = COALESCE(j.labels, '{}'::jsonb),
    updated_at = now()
FROM tmp_labels_json j
WHERE d.id = j.id;
SQL

echo "✅ Multilingual labels applied to dish_categories."

# ========== STEP 5: Generate variants with Python ==========
echo "→ [5] Generating surface forms (variants)..."

python3 "${WORKDIR}/generate_variants.py" \
        "${TMPDIR}/labels.csv" \
        "${TMPDIR}/dishes_final.csv" \
        > "${TMPDIR}/variants.csv"

echo "✅ Variants CSV generated: ${TMPDIR}/variants.csv"

# ========== STEP 6: Import dish_category_variants ==========
echo "→ [6] Importing into dish_category_variants table..."

psql "${PSQL_ARGS[@]}" -v ON_ERROR_STOP=1 \
  -v schema="${DB_SCHEMA:-public}" <<SQL
SET search_path TO :"schema";
\copy dish_category_variants (id, dish_category_id, surface_form, source, created_at) \
  FROM '${VARIANTS_CSV}' CSV HEADER;
SQL

echo "✅ dish_category_variants inserted."

# ========== STEP 7: Fetch ancestor tags from Wikidata and apply ==========
echo "→ [7] Fetching ancestor tags via WDQS and updating dish_categories.tags ..."

TAGS_RAW_CSV="${TMPDIR}/tags_raw.csv"
: > "${TAGS_RAW_CSV}"   # 空にしておく

# 7-1) dishes_final.csv の id を読み込み → SQL でバッチ化（200件/バッチ）
#      psql 側で「各バッチの VALUES ブロック」を組み立てて、bash で1行ずつ処理します
psql -qAtX "${PSQL_ARGS[@]}" -v ON_ERROR_STOP=1 \
  -v schema="${DB_SCHEMA:-public}" <<SQL | while IFS=$'\t' read -r batch_no values_block; do
SET search_path TO :"schema";

-- 行番号付与 → 200件ごとにグルーピング
WITH numbered AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM dish_categories
)
SELECT
  ((rn-1)/200) AS batch_no,
  'VALUES ?dish { ' || STRING_AGG('wd:'||id, ' ') || ' }' AS values_block -- 例: VALUES ?dish { wd:Q100136136 wd:Q100138427  ... }
FROM numbered
GROUP BY ((rn-1)/200)
ORDER BY ((rn-1)/200);
SQL

  # 7-2) バッチごとに WDQS へ問い合わせ
    echo "   - WDQS batch ${batch_no}"
    curl -sG "${WDQS_URL}" \
      --data-urlencode query="
PREFIX wd:  <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>

SELECT ?dish ?tagQ WHERE {
  ${values_block}
  {
    BIND(?dish AS ?ancAll)
  }
  UNION
  {
    ?dish (wdt:P31|wdt:P279|wdt:P361)+ ?ancAll
  }
  BIND( STRAFTER(STR(?ancAll), 'entity/') AS ?tagQ )
}" \
      -H "Accept: text/csv" \
      -H "User-Agent: food-app/0.1 (contact: you@example.com)" \
      >> "${TAGS_RAW_CSV}"

    # ポライトに少し待つ（WDQSに優しく）
    sleep 0.8
  done

# 7-3) 取得CSVをDBに取り込み → dish_categories.tags を更新
psql "${PSQL_ARGS[@]}" -v ON_ERROR_STOP=1 \
  -v schema="${DB_SCHEMA:-public}" <<SQL
SET search_path TO :"schema";

-- 取り込みテーブル
DROP TABLE IF EXISTS tmp_step7_tags_raw;
CREATE TEMP TABLE tmp_step7_tags_raw (
  dish TEXT,
  tagQ TEXT
);

-- header 行が複数ついている可能性があるので、\copy 後に除外する
\copy tmp_step7_tags_raw (dish, tagQ) FROM '${TAGS_RAW_CSV}' CSV HEADER

-- 正規化（wd:Q123 → Q123、URL → Q123）
DROP TABLE IF EXISTS tmp_step7_tags_norm;
CREATE TEMP TABLE tmp_step7_tags_norm AS
SELECT
  CASE
    WHEN dish ~ '^wd:'  THEN REGEXP_REPLACE(dish, '^wd:(Q[0-9]+)$', '\1')
    WHEN dish ~ '^http' THEN REGEXP_REPLACE(dish, '.*/(Q[0-9]+)$', '\1')
    ELSE dish
  END AS id,
  CASE
    WHEN tagQ ~ '^wd:'  THEN REGEXP_REPLACE(tagQ, '^wd:(Q[0-9]+)$', '\1')
    WHEN tagQ ~ '^http' THEN REGEXP_REPLACE(tagQ, '.*/(Q[0-9]+)$', '\1')
    ELSE tagQ
  END AS tag_q
FROM tmp_step7_tags_raw
WHERE dish IS NOT NULL AND tagQ IS NOT NULL AND dish <> '' AND tagQ <> ''
  AND LOWER(dish) <> 'dish' AND LOWER(tagQ) <> 'tagq'; -- ヘッダ除去保険

-- 重複除去
DROP TABLE IF EXISTS tmp_step7_tags_dist;
CREATE TEMP TABLE tmp_step7_tags_dist AS
SELECT DISTINCT id, tag_q
FROM tmp_step7_tags_norm;

-- id ごとに配列へ集約
DROP TABLE IF EXISTS tmp_step7_tags_agg;
CREATE TEMP TABLE tmp_step7_tags_agg AS
SELECT id, ARRAY_AGG(tag_q ORDER BY tag_q) AS tags_new
FROM tmp_step7_tags_dist
GROUP BY id;

-- 更新
UPDATE dish_categories d
SET tags = m.tags_new,
    updated_at = NOW(),
    lock_no = lock_no + 1;
FROM tmp_step7_tags_agg m
WHERE d.id = m.id;

-- 反映件数のログ
\echo [psql] step7_tags_updated=:ROW_COUNT
SQL

echo "✅ Ancestor tags applied to dish_categories.tags"


# ========== FINISH ==========
echo "🎉 Dish category master generation complete!"