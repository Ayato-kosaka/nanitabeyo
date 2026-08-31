#!/usr/bin/env bash
# =============================================================================
# #1706 表示値 UPDATE が «値が本当に変わる行» にしか書かないことを検証する
# =============================================================================
#
# 2026-08-31 に row_hash の定義へ source_names を足したところ、表示値は
# 1 文字も変わらないのに **619,497 行を書き直し**、この 1 文だけで 1,520 秒
# かかった。name には trigram、location（lat/lng からの生成列）には GIST が
# 乗っているので、同じ値で上書きしても索引は毎回作り直される。
#
# hash は «調べる価値があるか» の粗いふるいで、«書くべきか» ではない。
# その区別が入っていることを、実物の PostgreSQL で固定する。
#
# SQL は 9_1 のソースから抜き出す（写経しない）。
#
#   bash scripts/20260808T0000_restaurant/tests/test_9_1_display_update.sh
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGD="${PGD:-/tmp/pgdata_1706_display}"
PGPORT="${PGPORT:-55439}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TESTS_DIR="$REPO_ROOT/scripts/20260808T0000_restaurant/tests"

fail() { echo "❌ $*" >&2; exit 1; }
q() { psql -h /tmp -p "$PGPORT" -U postgres -tAq -c "SET search_path=dev; $1"; }
rows() { psql -h /tmp -p "$PGPORT" -U postgres -tAq -c "SET search_path=dev; WITH u AS ($1 RETURNING 1) SELECT COUNT(*) FROM u;"; }

cleanup() { su postgres -c "$PGBIN/pg_ctl -D $PGD stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$PGD"; }
trap cleanup EXIT

rm -rf "$PGD"; mkdir -p "$PGD"; chown postgres:postgres "$PGD"
su postgres -c "$PGBIN/initdb -D $PGD -U postgres --auth=trust" >/dev/null
su postgres -c "$PGBIN/pg_ctl -D $PGD -o '-p $PGPORT -k /tmp' -l $PGD/log start" >/dev/null
for _ in $(seq 1 20); do psql -h /tmp -p "$PGPORT" -U postgres -c 'select 1' >/dev/null 2>&1 && break; sleep 0.5; done

psql -h /tmp -p "$PGPORT" -U postgres -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS dev;
SET search_path = dev;
CREATE TABLE restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_place_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL, name_language_code TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL, longitude DOUBLE PRECISION NOT NULL,
  image_url TEXT NOT NULL, image_path TEXT,
  address_components JSONB NOT NULL, plus_code JSONB,
  address TEXT, country_code TEXT,
  source_row_hash TEXT, created_by_source TEXT NOT NULL DEFAULT 'user');
CREATE TABLE restaurant_sync_staging (
  seed_id UUID, google_place_id TEXT, match_method TEXT,
  name TEXT, name_language_code TEXT,
  latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
  image_url TEXT, image_path TEXT,
  address_components_json TEXT, plus_code_json TEXT,
  address TEXT, country_code TEXT,
  phone TEXT, website TEXT, social_urls_json TEXT, source_names_json TEXT, row_hash TEXT);

INSERT INTO restaurants
  (google_place_id, name, name_language_code, latitude, longitude, image_url, image_path,
   address_components, plus_code, address, country_code, source_row_hash, created_by_source) VALUES
  -- ① hash だけ動いた。表示値は全部同じ → **書いてはいけない**（1,520 秒の原因）
  ('P_HASH_ONLY','のれん','ja',35.0,139.0,'','',  '[]',NULL,'東京都1-1','JP','hash-OLD','pipeline'),
  -- ② 店名が変わった → 書く
  ('P_RENAMED', 'ふるい','ja',35.0,139.0,'','',   '[]',NULL,'東京都2-2','JP','hash-OLD','pipeline'),
  -- ③ 座標が動いた → 書く（location の GIST を作り直す価値がある変更）
  ('P_MOVED',   'のれん','ja',35.0,139.0,'','',   '[]',NULL,'東京都3-3','JP','hash-OLD','pipeline'),
  -- ④ 住所だけ変わった → 書く
  ('P_ADDR',    'のれん','ja',35.0,139.0,'','',   '[]',NULL,'ふるい住所','JP','hash-OLD','pipeline'),
  -- ⑤ アプリ製・全部違う → **触ってはいけない**（上書き事故の再発防止）
  ('P_APP',     'ユーザーの店','ja',1.0,2.0,'https://app/u.jpg','gs://app/u.jpg',
                '[{"types":["country"],"shortText":"JP"}]','{"globalCode":"X"}','ユーザー住所','JP',NULL,'user');

INSERT INTO restaurant_sync_staging VALUES
  ('11111111-1111-1111-1111-111111111111','P_HASH_ONLY','box',
   'のれん','ja',35.0,139.0,'','','[]',NULL,'東京都1-1','JP',NULL,NULL,'[]','[]','hash-NEW'),
  ('22222222-2222-2222-2222-222222222222','P_RENAMED','box',
   'あたらしい','ja',35.0,139.0,'','','[]',NULL,'東京都2-2','JP',NULL,NULL,'[]','[]','hash-NEW'),
  ('33333333-3333-3333-3333-333333333333','P_MOVED','box',
   'のれん','ja',35.5,139.5,'','','[]',NULL,'東京都3-3','JP',NULL,NULL,'[]','[]','hash-NEW'),
  ('44444444-4444-4444-4444-444444444444','P_ADDR','box',
   'のれん','ja',35.0,139.0,'','','[]',NULL,'あたらしい住所','JP',NULL,NULL,'[]','[]','hash-NEW'),
  ('55555555-5555-5555-5555-555555555555','P_APP','box',
   'オープンデータ名','ja',9.0,9.0,'','','[]',NULL,'オープンデータ住所','JP',NULL,NULL,'[]','[]','hash-NEW');
SQL

DISPLAY="$(python3 "$TESTS_DIR/extract_provenance_sql.py" --which display)"

N=$(rows "$DISPLAY")

# --- 1. hash だけ動いた行は書かない ---
[ "$(q "SELECT name FROM restaurants WHERE google_place_id='P_HASH_ONLY';")" = "のれん" ] \
  || fail "hash だけ動いた行の表示値を書き換えた"
echo "✅ 1. hash だけ動いた行は書かない（62 万行の空更新をしない）"

# --- 2. 実際に値が変わった行は書く ---
[ "$(q "SELECT name FROM restaurants WHERE google_place_id='P_RENAMED';")" = "あたらしい" ] \
  || fail "改名した店が更新されていない"
[ "$(q "SELECT latitude FROM restaurants WHERE google_place_id='P_MOVED';")" = "35.5" ] \
  || fail "座標が動いた店が更新されていない"
[ "$(q "SELECT address FROM restaurants WHERE google_place_id='P_ADDR';")" = "あたらしい住所" ] \
  || fail "住所が変わった店が更新されていない"
echo "✅ 2. 名前・座標・住所のどれかが変わった行は更新される"

# --- 3. 掴んだのはちょうど 3 行（＝ hash だけの行とアプリ製の行を含まない）---
[ "$N" = "3" ] || fail "掴んだ件数が想定と違う: $N（期待 3）"
echo "✅ 3. 掴んだのは値が変わった 3 行だけ"

# --- 4. アプリ製の行は 1 列も触らない（上書き事故の再発防止）---
[ "$(q "SELECT name FROM restaurants WHERE google_place_id='P_APP';")" = "ユーザーの店" ] \
  || fail "アプリ製の行の name を上書きした"
[ "$(q "SELECT image_path FROM restaurants WHERE google_place_id='P_APP';")" = "gs://app/u.jpg" ] \
  || fail "アプリ製の行の image_path を上書きした"
echo "✅ 4. アプリ製の行は触らない"

# --- 5. 冪等（2 回目は 0 行）---
[ "$(rows "$DISPLAY")" = "0" ] || fail "2 回目も行を掴んだ（冪等でない）"
echo "✅ 5. 冪等（2 回目は 0 行）"

echo
echo "すべて通過（5/5）"
