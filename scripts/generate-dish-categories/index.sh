#!/bin/bash
set -euo pipefail

# ==========================================
# このスクリプトは「料理カテゴリーマスタ」を生成するための一連処理
# - Wikidata から SPARQL で料理情報を取得
# - CSV を PostgreSQL に取り込みやすい形式へ整形
# - Wikimedia Commons の Special:FilePath を upload.wikimedia.org 実体URLへ変換
# - DB (dish_categories) を再構築
# - 多言語ラベルや派生表記 (variants) を生成
# - さらに祖先タグ (tags) を Wikidata から取得して反映
#
# 実行方法:
#   DATABASE_URL=postgresql://xxx bash scripts/generate-dish-categories/index.sh
# ==========================================

# ========== 設定 ==========
WDQS_URL="https://query.wikidata.org/sparql"   # Wikidata Query Service
PSQL_ARGS=()
PSQL_ARGS+=("$DATABASE_URL")                   # psql 接続先
DB_SCHEMA="dev"                                # 書き込み先スキーマ
WORKDIR="$(cd "$(dirname "$0")" && pwd)"       # スクリプトのあるディレクトリ
TMPDIR="${WORKDIR}/../../data/dish_master_tmp" # 一時作業ディレクトリ
DISHES_CSV="$(realpath "${TMPDIR}/dishes_pg.csv")"
VARIANTS_CSV="$(realpath "${TMPDIR}/variants.csv")"
mkdir -p "$TMPDIR"

echo "▼ Start generating dish categories..."

# ========== STEP 1: Wikidata から料理データを取得 ==========
echo "→ [1] Fetching dishes_with_tags from Wikidata..."

curl -sG "${WDQS_URL}" \
  --data-urlencode query@"${WORKDIR}/dishes_with_tags.rq" \
  -H "Accept: text/csv" \
  -H "User-Agent: food-app/0.1 (contact: you@example.com)" \
  -o "${TMPDIR}/dishes_raw.csv"

echo "✅ Raw dish data saved to ${TMPDIR}/dishes_raw.csv"

# ========== STEP 2: CSV を PostgreSQL 形式に整形 ==========
echo "→ [2] Transforming CSV to PostgreSQL-compatible format..."

tr -d '\r' < "${TMPDIR}/dishes_raw.csv" | csvsql -d , --query "
SELECT
  dish AS id,
  labelEN AS label_en,
  '{}' AS labels,
  COALESCE(image, '') AS image_raw,        -- 画像URLは生のまま保持（Special:FilePathでもOK）
  CASE WHEN origins  IS NULL OR origins  = '' THEN '{}' ELSE '{'||REPLACE(origins, '|', ',') ||'}' END AS origin,
  CASE WHEN cuisines IS NULL OR cuisines = '' THEN '{}' ELSE '{'||REPLACE(cuisines,'|', ',') ||'}' END AS cuisine,
  CASE WHEN tags     IS NULL OR tags     = '' THEN '{}' ELSE '{'||REPLACE(tags,    '|', ',') ||'}' END AS tags
FROM stdin
" > "${DISHES_CSV}"

echo "✅ Preprocessed to ${DISHES_CSV}"

# ========== STEP 2.5: Wikimedia 実体URLへ変換 ==========
echo "→ [2.5] Resolve Special:FilePath to actual upload.wikimedia.org URL"

python3 "${WORKDIR}/resolve_commons_url.py" \
        "${DISHES_CSV}" \
        "${TMPDIR}/dishes_pg_with_final.csv"
DISHES_CSV="${TMPDIR}/dishes_pg_with_final.csv"

echo "✅ Image URLs resolved to ${DISHES_CSV}"

# ========== STEP 3: dish_categories テーブル更新 ==========
echo "→ [3] Importing into dish_categories table..."

psql "${PSQL_ARGS[@]}" -v ON_ERROR_STOP=1 \
  -v schema="${DB_SCHEMA:-public}" <<SQL
SET search_path TO :"schema";

-- 一時テーブルにロード
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

-- 重複件数の確認ログ
\echo [psql] dup_count=
SELECT count(*) FROM (
  SELECT id FROM tmp_dishes GROUP BY id HAVING count(*) > 1
) s;

-- 画像URLが NULL/NULL文字の場合は空文字に修正
UPDATE tmp_dishes
SET image_url = ''
WHERE image_url IS NULL OR image_url = 'NULL';

-- 1) id単位で重複 → 画像ありを優先
DROP TABLE IF EXISTS tmp_dishes_one;
CREATE TEMP TABLE tmp_dishes_one AS
SELECT DISTINCT ON (id)
       id, label_en, labels, image_url, origin, cuisine, tags
FROM tmp_dishes
ORDER BY id, (image_url = ''), image_url DESC;

-- 2) label_en 小文字キーで重複排除 → QID数値が最小のものを採用
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
ORDER BY label_key, qnum;  -- 小さいQIDを優先

-- 既存データをクリア
DELETE FROM dish_category_variants;
DELETE FROM dish_categories;

-- dish_categories に挿入（ON CONFLICT: 更新）
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

-- 次工程用のCSVに吐き出し
\copy (SELECT id, label_en FROM dish_categories) TO '${TMPDIR}/dishes_final.csv' CSV HEADER
SQL

echo "✅ dish_categories updated."

# ========== STEP 4: 多言語ラベルの取得と適用 ==========
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

-- 一時テーブルに labels.csv をロード
CREATE TEMP TABLE tmp_labels_raw (
  id TEXT,
  lang TEXT,
  label TEXT
);

\copy tmp_labels_raw FROM '${TMPDIR}/labels.csv' CSV HEADER

-- id を 'Q12345' 形式に正規化
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

-- (id,lang) 重複時は短いラベルを優先
DROP TABLE IF EXISTS tmp_labels_dedup;
CREATE TEMP TABLE tmp_labels_dedup AS
SELECT DISTINCT ON (id, lang)
       id, lang, label
FROM tmp_labels_norm
ORDER BY id, lang, LENGTH(label), label;

-- JSONB に集約
DROP TABLE IF EXISTS tmp_labels_json;
CREATE TEMP TABLE tmp_labels_json AS
SELECT id, jsonb_object_agg(lang, label) AS labels
FROM tmp_labels_dedup
GROUP BY id;

-- dish_categories に labels を反映
UPDATE dish_categories d
SET labels = COALESCE(j.labels, '{}'::jsonb),
    updated_at = now()
FROM tmp_labels_json j
WHERE d.id = j.id;
SQL

echo "✅ Multilingual labels applied to dish_categories."

# ========== STEP 5: 表記ゆれ (variants) を生成・投入 ==========
echo "→ [5] Generating surface forms and importing into dish_category_variants (stream)..."

python3 "${WORKDIR}/generate_variants.py" \
        "${TMPDIR}/labels.csv" \
        "${TMPDIR}/dishes_final.csv" \
| psql "${PSQL_ARGS[@]}" -v ON_ERROR_STOP=1 \
   -c "COPY ${DB_SCHEMA:-public}.dish_category_variants (id, dish_category_id, surface_form, source, created_at) FROM STDIN CSV HEADER;"

echo "✅ dish_category_variants inserted (stream)."

# ========== STEP 7: 祖先タグを取得し dish_categories.tags を更新 ==========
echo "→ [7] Fetching ancestor tags via WDQS and updating dish_categories.tags ..."

TAGS_RAW_CSV="${TMPDIR}/tags_raw.csv"
: > "${TAGS_RAW_CSV}"   # 空ファイルで初期化

# 7-1) id を 200件ごとにバッチ化し、WDQS に問い合わせ
psql -qAtX "${PSQL_ARGS[@]}" -v ON_ERROR_STOP=1 \
  -v schema="${DB_SCHEMA:-public}" <<SQL | while IFS=$'\t' read -r batch_no values_block; do
SET search_path TO :"schema";

WITH numbered AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM dish_categories
)
SELECT
  ((rn-1)/200) AS batch_no,
  'VALUES ?dish { ' || STRING_AGG('wd:'||id, ' ') || ' }' AS values_block
FROM numbered
GROUP BY ((rn-1)/200)
ORDER BY ((rn-1)/200);
SQL

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

  sleep 0.8   # 負荷を避けるためポライトに待機
done

# 7-3) 取得したタグを dish_categories.tags に反映
psql "${PSQL_ARGS[@]}" -v ON_ERROR_STOP=1 \
  -v schema="${DB_SCHEMA:-public}" <<SQL
SET search_path TO :"schema";

DROP TABLE IF EXISTS tmp_step7_tags_raw;
CREATE TEMP TABLE tmp_step7_tags_raw (
  dish TEXT,
  tagQ TEXT
);

\copy tmp_step7_tags_raw (dish, tagQ) FROM '${TAGS_RAW_CSV}' CSV HEADER

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
  AND LOWER(dish) <> 'dish' AND LOWER(tagQ) <> 'tagq';

-- 重複除去 → 配列に集約
DROP TABLE IF EXISTS tmp_step7_tags_dist;
CREATE TEMP TABLE tmp_step7_tags_dist AS
SELECT DISTINCT id, tag_q
FROM tmp_step7_tags_norm;

DROP TABLE IF EXISTS tmp_step7_tags_agg;
CREATE TEMP TABLE tmp_step7_tags_agg AS
SELECT id, ARRAY_AGG(tag_q ORDER BY tag_q) AS tags_new
FROM tmp_step7_tags_dist
GROUP BY id;

-- dish_categories 更新
UPDATE dish_categories d
SET tags = m.tags_new,
    updated_at = NOW(),
    lock_no = lock_no + 1;
FROM tmp_step7_tags_agg m
WHERE d.id = m.id;

\echo [psql] step7_tags_updated=:ROW_COUNT
SQL

echo "✅ Ancestor tags applied to dish_categories.tags"

# ========== 完了 ==========
echo "🎉 Dish category master generation complete!"
