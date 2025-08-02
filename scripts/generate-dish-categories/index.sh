#!/bin/bash
set -euo pipefail

# ========== SETTINGS ==========
WDQS_URL="https://query.wikidata.org/sparql"
DB_NAME="mydb"                   # ← 必要に応じて変更
DB_USER="postgres"
WORKDIR="$(cd "$(dirname "$0")" && pwd)"
TMPDIR="${WORKDIR}/../../data/dish_master_tmp"
mkdir -p "$TMPDIR"

echo "▼ Start generating dish categories..."

# ========== STEP 1: Get core dish info (QID, label, tags, etc.) ==========
echo "→ [1] Fetching dishes_with_tags from Wikidata..."

curl -sG "${WDQS_URL}" \
  --data-urlencode query@"${WORKDIR}/dishes_with_tags.rq" \
  -H "Accept: text/csv" \
  -o "${TMPDIR}/dishes_raw.csv"

echo "✅ Raw dish data saved to ${TMPDIR}/dishes_raw.csv"

# ========== STEP 2: Preprocess CSV to PostgreSQL format ==========
echo "→ [2] Transforming CSV to PostgreSQL-compatible format..."

csvsql --query "
SELECT
  dish AS id,
  labelEN AS label_en,
  '{}' AS labels,
  image AS image_url,
  CASE WHEN origin='' THEN NULL ELSE '{'||origin||'}' END AS origin,
  CASE WHEN cuisines='' THEN NULL ELSE '{'||REPLACE(cuisines,'|',',')||'}' END AS cuisine,
  CASE WHEN tags='' THEN '{}' ELSE '{'||REPLACE(tags,'|',',')||'}' END AS tags
FROM stdin" "${TMPDIR}/dishes_raw.csv" > "${TMPDIR}/dishes_pg.csv"

echo "✅ Preprocessed to ${TMPDIR}/dishes_pg.csv"

# ========== STEP 3: Import dish_categories ==========
echo "→ [3] Importing into dish_categories table..."

psql -U "$DB_USER" -d "$DB_NAME" <<SQL
CREATE TEMP TABLE tmp_dishes (
  id TEXT,
  label_en TEXT,
  labels JSONB,
  image_url TEXT,
  origin TEXT[],
  cuisine TEXT[],
  tags TEXT[]
);

\copy tmp_dishes FROM '${TMPDIR}/dishes_pg.csv' CSV HEADER;

INSERT INTO dish_categories
(id, label_en, labels, image_url, origin, cuisine, tags)
SELECT id, label_en, labels, image_url, origin, cuisine, tags
FROM tmp_dishes
ON CONFLICT (id) DO UPDATE
SET label_en = EXCLUDED.label_en,
    image_url = EXCLUDED.image_url,
    origin = EXCLUDED.origin,
    cuisine = EXCLUDED.cuisine,
    tags = EXCLUDED.tags,
    updated_at = now();
SQL

echo "✅ dish_categories updated."

# ========== STEP 4: Fetch multilingual labels ==========
echo "→ [4] Fetching multilingual labels from Wikidata..."

curl -sG "${WDQS_URL}" \
  --data-urlencode query@"${WORKDIR}/labels_lang.rq" \
  -H "Accept: text/csv" \
  -o "${TMPDIR}/labels.csv"

echo "✅ Multilingual labels saved to ${TMPDIR}/labels.csv"

# ========== STEP 5: Generate variants with Python ==========
echo "→ [5] Generating surface forms (variants)..."

python3 "${WORKDIR}/generate_variants.py" \
        "${TMPDIR}/labels.csv" > "${TMPDIR}/variants.csv"

echo "✅ Variants CSV generated: ${TMPDIR}/variants.csv"

# ========== STEP 6: Import dish_category_variants ==========
echo "→ [6] Importing into dish_category_variants table..."

psql -U "$DB_USER" -d "$DB_NAME" <<SQL
\copy dish_category_variants(id, dish_category_id, surface_form, source, created_at, lock_no)
FROM '${TMPDIR}/variants.csv' CSV HEADER;
SQL

echo "✅ dish_category_variants inserted."

# ========== FINISH ==========
echo "🎉 Dish category master generation complete!"
