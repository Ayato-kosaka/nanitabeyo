#!/usr/bin/env bash
# =============================================================================
# #843 本番規模（62万行）で 9_1 の所要時間と上書きガードを測る
# =============================================================================
#
# ⚠️ **このテストの秒数で dev / 本番の所要時間を予測してはいけない。**
#
# ここで backfill を 17 秒と測ったが、**dev の実測は 10 分**だった（約 35 倍）。
# GIN 索引を足しても 10.3 秒 → 17.1 秒にしかならず、差の大半は索引では説明できない。
# 残りは Supabase 側の I/O・CPU とネットワーク往復であり、**ここでは再現できない**。
#
# したがってこのテストで言えるのは次の 2 つだけである。
#   ・62 万行でも **壊れない**（アプリ製の行が守られる）
#   ・処理どうしの **相対的な重さ**（provenance UPDATE がいちばん重い、など）
# 「30 分の timeout に間に合うか」は、ここではなく **dev の実行ログ**で確かめること。
#
# 2026-08-24 の同期は `canceling statement due to statement timeout` で落ちた。
# 対策として同期 session に 30 分の statement_timeout を入れたが、**それが
# 足りているのかを誰も測っていなかった**。落ちた原因がサーバ既定の短い
# timeout だったのか、本当に 30 分かかる処理なのかで、打ち手が変わる。
#
# あわせて、小さなテスト（test_9_1_overwrite_guard.sh）では見えない
# «62万行の中に紛れたアプリ製の行が本当に守られるか» も同じ場で確かめる。
#
# 実測の内訳に合わせて作る:
#   restaurants 572,126 = パイプライン製 569,661 + アプリ製 2,465
#   staging     621,616 = 既存 PIPE 569,661 + 既存 APP 2,108 + 新規 49,847
#   さらに «snapshot に載っていないアプリ製 357 行» を staging へ入れて
#   事故と同じ形を再現する
#
# 使い方（数分かかる。既定では回らないので明示的に呼ぶこと）:
#   bash scripts/20260808T0000_restaurant/tests/test_9_1_scale.sh
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGD="${PGD:-/tmp/pgdata_843_scale}"
PGPORT="${PGPORT:-55441}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MIGRATION="$REPO_ROOT/infra/supabase/migrations/20260827T0000_add_restaurants_created_by_source.sql"

fail() { echo "❌ $*" >&2; exit 1; }
q() { psql -h /tmp -p "$PGPORT" -U postgres -tAq -c "SET search_path=dev; $1"; }
timed() { local label="$1"; shift; local s e
  s=$(date +%s.%N); "$@" >/dev/null; e=$(date +%s.%N)
  printf '  %-46s %6.1f 秒\n' "$label" "$(echo "$e - $s" | bc)"; }
run_sql() { psql -h /tmp -p "$PGPORT" -U postgres -q -v ON_ERROR_STOP=1 -f "$1"; }

cleanup() { su postgres -c "$PGBIN/pg_ctl -D $PGD stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$PGD"; }
trap cleanup EXIT

rm -rf "$PGD"; mkdir -p "$PGD"; chown postgres:postgres "$PGD"
su postgres -c "$PGBIN/initdb -D $PGD -U postgres --auth=trust" >/dev/null
# 既定の共有バッファのままだと本番と傾向が変わりすぎるので、最低限そろえる
cat >> "$PGD/postgresql.conf" <<'CONF'
shared_buffers = 512MB
work_mem = 32MB
maintenance_work_mem = 256MB
max_wal_size = 4GB
CONF
su postgres -c "$PGBIN/pg_ctl -D $PGD -o '-p $PGPORT -k /tmp' -l $PGD/log start" >/dev/null
for _ in $(seq 1 40); do psql -h /tmp -p "$PGPORT" -U postgres -c 'select 1' >/dev/null 2>&1 && break; sleep 0.5; done

cat > /tmp/scale_setup.sql <<'SQL'
CREATE SCHEMA IF NOT EXISTS dev;
SET search_path = dev;
CREATE TABLE restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_place_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL, name_language_code TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL, longitude DOUBLE PRECISION NOT NULL,
  image_url TEXT NOT NULL, image_path TEXT, address_components JSONB NOT NULL, plus_code JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), source_seed_id UUID,
  source_names TEXT[] NOT NULL DEFAULT '{}', source_row_hash TEXT, synced_at TIMESTAMPTZ);

-- 索引は本番に寄せる。created_by_source 自体に索引があるので更新が HOT にならず、
-- **全索引にエントリが作られる**。GIN の更新は特に重いので、無いと軽く出過ぎる。
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_restaurants_name_trgm ON restaurants USING gin (name gin_trgm_ops);
CREATE TABLE restaurant_sync_staging (
  seed_id UUID, existing_restaurant_id UUID, google_place_id TEXT, name TEXT,
  name_language_code TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
  image_url TEXT, image_path TEXT, address_components_json TEXT, plus_code_json TEXT,
  source_names_json TEXT, row_hash TEXT, match_method TEXT);

INSERT INTO restaurants (google_place_id, name, name_language_code, latitude, longitude,
                         image_url, address_components, source_seed_id, source_row_hash)
SELECT 'PIPE_'||g, '店'||g, 'ja', 35.0+(g%1000)/10000.0, 139.0+(g%997)/10000.0,
       '', '[]'::jsonb, gen_random_uuid(), 'hash-'||g
FROM generate_series(1, 569661) g;

INSERT INTO restaurants (google_place_id, name, name_language_code, latitude, longitude,
                         image_url, image_path, address_components, source_seed_id, source_row_hash)
SELECT 'APP_'||g, 'ユーザーの店'||g, 'ja', 35.5, 139.5,
       'https://app/photo'||g||'.jpg', 'gs://app/'||g,
       '[{"types":["country"],"shortText":"JP"}]'::jsonb,
       CASE WHEN g <= 2115 THEN gen_random_uuid() ELSE NULL END,
       CASE WHEN g <= 2115 THEN 'hash-app-'||g ELSE NULL END
FROM generate_series(1, 2465) g;

INSERT INTO restaurant_sync_staging
SELECT gen_random_uuid(), NULL, 'PIPE_'||g, 'オープンデータ名'||g, 'ja', 35.0, 139.0,
       '', NULL, '[]', NULL, '["overture"]', 'hash-new-'||g, 'box_unique_strict'
FROM generate_series(1, 569661) g;
INSERT INTO restaurant_sync_staging
SELECT gen_random_uuid(), r.id, 'APP_'||g, 'オープンデータ名app'||g, 'ja', 35.5, 139.5,
       '', NULL, '[]', NULL, '["overture"]', 'hash-app-new-'||g, 'box_unique_strict'
FROM generate_series(1, 2108) g JOIN restaurants r ON r.google_place_id = 'APP_'||g;
INSERT INTO restaurant_sync_staging
SELECT gen_random_uuid(), NULL, 'NEW_'||g, '新規店'||g, 'ja', 36.0, 140.0,
       '', NULL, '[]', NULL, '["overture"]', 'hash-brandnew-'||g, 'box_unique_strict'
FROM generate_series(1, 49847) g;
-- 事故と同じ形: snapshot に載っていないアプリ製 357 行が staging に居て row_hash も違う
INSERT INTO restaurant_sync_staging
SELECT gen_random_uuid(), NULL, 'APP_'||g, '乗っ取られた名'||g, 'ja', 35.9, 139.9,
       '', NULL, '[]', NULL, '["overture"]', 'hash-hijack-'||g, 'box_unique_strict'
FROM generate_series(2109, 2465) g;
SQL

echo "データを作成中（62万行、1分ほど）..."
run_sql /tmp/scale_setup.sql
[ "$(q 'SELECT COUNT(*) FROM restaurants;')" = "572126" ] || fail "restaurants の件数が想定と違う"
[ "$(q 'SELECT COUNT(*) FROM restaurant_sync_staging;')" = "621973" ] || fail "staging の件数が想定と違う"

echo
echo "所要時間:"
timed "migration の適用" psql -h /tmp -p "$PGPORT" -U postgres -q -c "SET search_path=dev;" -f "$MIGRATION"

cat > /tmp/scale_backfill.sql <<'SQL'
SET search_path = dev;
SET statement_timeout = '1800000ms';
UPDATE restaurants SET created_by_source='pipeline'
WHERE created_by_source='user' AND source_seed_id IS NOT NULL
  AND google_place_id LIKE 'PIPE_%';
SQL
timed "backfill（569,661 行）" run_sql /tmp/scale_backfill.sql

cat > /tmp/scale_insert.sql <<'SQL'
SET search_path = dev;
SET statement_timeout = '1800000ms';
INSERT INTO restaurants (
  id, google_place_id, name, name_language_code, latitude, longitude,
  image_url, image_path, address_components, plus_code,
  source_seed_id, source_names, source_row_hash, synced_at, created_by_source)
SELECT gen_random_uuid(), s.google_place_id, s.name,
  s.name_language_code, s.latitude, s.longitude, s.image_url, s.image_path,
  s.address_components_json::jsonb,
  CASE WHEN s.plus_code_json IS NULL THEN NULL ELSE s.plus_code_json::jsonb END,
  s.seed_id, ARRAY(SELECT jsonb_array_elements_text(s.source_names_json::jsonb)),
  s.row_hash, CURRENT_TIMESTAMP, 'pipeline'
FROM restaurant_sync_staging s
ON CONFLICT (google_place_id) DO NOTHING;
SQL
timed "9_1 INSERT（新規 49,847 行）" run_sql /tmp/scale_insert.sql

cat > /tmp/scale_update.sql <<'SQL'
SET search_path = dev;
SET statement_timeout = '1800000ms';
UPDATE restaurants r
SET name = s.name, name_language_code = s.name_language_code,
    latitude = s.latitude, longitude = s.longitude,
    image_url = s.image_url, image_path = s.image_path,
    address_components = s.address_components_json::jsonb,
    plus_code = CASE WHEN s.plus_code_json IS NULL THEN NULL ELSE s.plus_code_json::jsonb END
FROM restaurant_sync_staging s
WHERE r.google_place_id = s.google_place_id
  AND r.created_by_source = 'pipeline'
  AND r.source_row_hash IS DISTINCT FROM s.row_hash;
SQL
timed "9_1 値 UPDATE（621,973 行を join）" run_sql /tmp/scale_update.sql

# --- 負の対照: 旧ガードなら大規模でも壊れることを示す ---
#
# ⚠️ ここは **値 UPDATE の直後・provenance UPDATE の前** でなければならない。
# provenance UPDATE は source_row_hash を staging の値で上書きするので、
# それを通したあとだと旧ガードの `source_row_hash IS DISTINCT FROM` が
# 常に偽になり、**壊れていないように見えてしまう**（実際に 0 件になった）。
# 9_1 の apply_sync も «値 UPDATE → provenance UPDATE» の順なので、
# この位置が本番の順序と一致する。
HIJACKED=$(psql -h /tmp -p "$PGPORT" -U postgres -tAq <<'SQL'
SET search_path = dev;
BEGIN;
UPDATE restaurants r SET name = s.name FROM restaurant_sync_staging s
WHERE r.google_place_id = s.google_place_id
  AND s.existing_restaurant_id IS NULL
  AND r.source_row_hash IS DISTINCT FROM s.row_hash;
SELECT COUNT(*) FROM restaurants WHERE name LIKE '乗っ取られた名%';
ROLLBACK;
SQL
)
[ "$HIJACKED" = "357" ] || fail "旧ガードで 357 行が壊れるはずが $HIJACKED 行だった（前提が崩れている）"
echo "✅ 旧ガードなら 357 行が壊れる（新ガードは 0）"


cat > /tmp/scale_prov.sql <<'SQL'
SET search_path = dev;
SET statement_timeout = '1800000ms';
UPDATE restaurants r
SET source_seed_id = s.seed_id,
    source_names = ARRAY(SELECT jsonb_array_elements_text(s.source_names_json::jsonb)),
    source_row_hash = s.row_hash, synced_at = CURRENT_TIMESTAMP
FROM restaurant_sync_staging s
WHERE r.google_place_id = s.google_place_id;
SQL
timed "9_1 provenance UPDATE" run_sql /tmp/scale_prov.sql


echo
# --- 正しさ: 大規模でもアプリ製の行が丸ごと残る ---
[ "$(q "SELECT COUNT(*) FROM restaurants WHERE name LIKE '乗っ取られた名%';")" = "0" ] \
  || fail "アプリ製の行がオープンデータ名で上書きされた"
INTACT=$(q "SELECT COUNT(*) FROM restaurants WHERE created_by_source='user'
            AND name LIKE 'ユーザーの店%' AND image_url LIKE 'https://app/photo%'
            AND image_path LIKE 'gs://app/%' AND jsonb_array_length(address_components) > 0;")
[ "$INTACT" = "2465" ] || fail "アプリ製 2,465 行のうち $INTACT 行しか無傷でない"
echo "✅ アプリ製 2,465 行すべてが name / image_url / image_path / address_components とも無傷"

echo
echo "すべて通過"
