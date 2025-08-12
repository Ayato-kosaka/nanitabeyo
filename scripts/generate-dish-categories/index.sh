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

FILTERS=(
  # A. 料理（dish）…インスタンスも含める
  '{ ?dish wdt:P31/wdt:P279* wd:Q746549 . }'
  '{ ?dish wdt:P279+ wd:Q746549. }'
  # B. 菜系（cuisine）…クラス/インスタンス両方
  '{ ?dish (wdt:P31/wdt:P279* | wdt:P279+) wd:Q1778821 . }'
  # C. 食事（meal）…朝食/昼食/夕食などを含む概念
  '{ ?dish (wdt:P31/wdt:P279* | wdt:P279+) wd:Q6460735 . }'
  # D. デザート（甘味の上位）
  '{ ?dish (wdt:P31/wdt:P279* | wdt:P279+) wd:Q8495 . }'
  # E. ヌードル（うどん等を包含）
  '{ ?dish (wdt:P31/wdt:P279* | wdt:P279+) wd:Q192874 . }'
  # F. 定食（和定食/朝食セットの受け皿）
  '{ ?dish (wdt:P31/wdt:P279* | wdt:P279+) wd:Q117231375 . }'
  # G. カフェ（店舗種別）
  '{ ?dish (wdt:P31/wdt:P279* | wdt:P279+) wd:Q30022 . }'
)

RANGES=()
max=200000000
step=10000
for ((i=0; i<=$max; i+=$step)); do
  start=$i
  end=$((i+step))
  RANGES+=("$start $end")
done

OUT_CSV="${TMPDIR}/dishes_raw.csv"
> "$OUT_CSV"
part_idx=0

for pattern in "${FILTERS[@]}"; do
  for range in "${RANGES[@]}"; do
    read start end <<< "$range"

    filter="${pattern}
      BIND( xsd:integer(STRAFTER(STR(?dish), \"entity/Q\")) AS ?qnum )
      FILTER( ?qnum >= ${start} && ?qnum < ${end} )"

    qfile="${TMPDIR}/query_${part_idx}.rq"
    tmpfile="${TMPDIR}/part_${part_idx}.csv"

    FILTER="$filter" envsubst < "${WORKDIR}/dishes_with_tags.template.rq" > "$qfile"

    echo "  → Part ${part_idx}: pattern='${pattern}' range=${start}-${end}"
    if ! curl -fsSLG --retry 5 --retry-delay 10 "${WDQS_URL}" \
        --data-urlencode query@"$qfile" \
        -H "Accept: text/csv" \
        -H "User-Agent: food-app/0.1 (contact: your-email-or-url)" \
        -o "$tmpfile"; then
      echo "WARN: Failed part $part_idx after retries, skipping..." >&2
      part_idx=$((part_idx + 1))
      continue
    fi

    if [[ ! -s "$tmpfile" ]]; then
      echo "WARN: Empty result for part $part_idx, skipping..." >&2
      part_idx=$((part_idx + 1))
      continue
    fi

    if [[ $part_idx -eq 0 ]]; then
      cat "$tmpfile" >> "$OUT_CSV"
    else
      tail -n +2 "$tmpfile" >> "$OUT_CSV"
    fi

    part_idx=$((part_idx + 1))
  done
done

# 重複排除（dish列基準）
awk -F, '!seen[$1]++' "$OUT_CSV" > "${TMPDIR}/dishes_raw_dedup.csv" \
  && mv "${TMPDIR}/dishes_raw_dedup.csv" "$OUT_CSV"

echo "✅ Combined raw dish data saved to ${OUT_CSV}"

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
" > "${TMPDIR}/dishes_pg.csv"

echo "✅ Preprocessed to ${TMPDIR}/dishes_pg.csv"

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
  id,
  label_en,
  labels,
  COALESCE(NULLIF(image_url, 'NULL'), ''),        -- 念のため二重保険
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
    updated_at = now();
  \copy (SELECT id, label_en FROM dish_categories) TO '${TMPDIR}/dishes_final.csv' CSV HEADER
SQL

echo "✅ dish_categories updated."

# ========== STEP 4: Fetch multilingual labels ==========
echo "→ [4] Fetching multilingual labels from Wikidata..."

curl -sG "${WDQS_URL}" \
  --data-urlencode query@"${WORKDIR}/labels_lang.rq" \
  -H "Accept: text/csv" \
  -H "User-Agent: food-app/0.1 (contact: you@example.com)" \
  -o "${TMPDIR}/labels.csv"

echo "✅ Multilingual labels saved to ${TMPDIR}/labels.csv"

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

# ========== FINISH ==========
echo "🎉 Dish category master generation complete!"
