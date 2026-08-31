#!/usr/bin/env bash
# =============================================================================
# #1706 アプリ製の行の «空いている住所だけ» を埋めることを検証する
# =============================================================================
#
# 「上書きしない」と「欠けたままにする」は別の話である。
# 同期はアプリ製の行の表示値を触らないが、そのせいで address が
# 2,472 行すべて空だった（dev 実測）。空のときだけ埋める。
#
# ここで守るのは «入っている値を塗り替えない» ことである。
# SQL は 9_1 のソースから抜き出す（写経しない）。
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGD="${PGD:-/tmp/pgdata_1706_addr}"
PGPORT="${PGPORT:-55438}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TESTS_DIR="$REPO_ROOT/scripts/20260808T0000_restaurant/tests"

fail() { echo "❌ $*" >&2; exit 1; }
q() { psql -h /tmp -p "$PGPORT" -U postgres -tAq -c "SET search_path=dev; $1"; }

cleanup() {
  su postgres -c "$PGBIN/pg_ctl -D $PGD stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$PGD"
}
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
  address TEXT,
  created_by_source TEXT NOT NULL);
CREATE TABLE restaurant_sync_work (google_place_id TEXT, address TEXT);

INSERT INTO restaurants (google_place_id, address, created_by_source) VALUES
  ('P_APP_EMPTY',   NULL,              'user'),      -- 埋まるべき
  ('P_OWNER_EMPTY', NULL,              'owner'),     -- 埋まるべき（owner も対象）
  ('P_APP_HAS',     '利用者が入れた住所', 'user'),      -- ★ 触らない
  ('P_PIPELINE',    NULL,              'pipeline'),  -- 値UPDATE の担当。ここでは触らない
  ('P_NO_CATALOG',  NULL,              'user');      -- catalog に住所が無い

INSERT INTO restaurant_sync_work VALUES
  ('P_APP_EMPTY',   '東京都渋谷区1-1-1'),
  ('P_OWNER_EMPTY', '大阪府大阪市2-2-2'),
  ('P_APP_HAS',     'オープンデータの住所'),
  ('P_PIPELINE',    '京都府京都市3-3-3'),
  ('P_NO_CATALOG',  '   ');
SQL

SQL_FILL="$(python3 "$TESTS_DIR/extract_provenance_sql.py" --which address_fill)"
psql -h /tmp -p "$PGPORT" -U postgres -q -v ON_ERROR_STOP=1 -c "SET search_path=dev; $SQL_FILL" >/dev/null

[ "$(q "SELECT address FROM restaurants WHERE google_place_id='P_APP_EMPTY';")" = "東京都渋谷区1-1-1" ] \
  || fail "アプリ製の空の住所が埋まっていない"
[ "$(q "SELECT address FROM restaurants WHERE google_place_id='P_OWNER_EMPTY';")" = "大阪府大阪市2-2-2" ] \
  || fail "owner の空の住所が埋まっていない"
echo "✅ 1. 空いている住所は埋まる（user / owner とも）"

# ★ 本題
[ "$(q "SELECT address FROM restaurants WHERE google_place_id='P_APP_HAS';")" = "利用者が入れた住所" ] \
  || fail "既に入っている住所を塗り替えた"
echo "✅ 2. 既に入っている住所は塗り替えない"

[ -z "$(q "SELECT address FROM restaurants WHERE google_place_id='P_PIPELINE';")" ] \
  || fail "pipeline の行をこの文が触った（値UPDATE の担当）"
echo "✅ 3. pipeline の行はこの文では触らない"

[ -z "$(q "SELECT address FROM restaurants WHERE google_place_id='P_NO_CATALOG';")" ] \
  || fail "catalog 側が空白だけなのに書き込んだ"
echo "✅ 4. catalog 側が空白だけなら書かない"

BEFORE=$(q "SELECT md5(string_agg(google_place_id||coalesce(address,''), '|' ORDER BY google_place_id)) FROM restaurants;")
psql -h /tmp -p "$PGPORT" -U postgres -q -v ON_ERROR_STOP=1 -c "SET search_path=dev; $SQL_FILL" >/dev/null
[ "$(q "SELECT md5(string_agg(google_place_id||coalesce(address,''), '|' ORDER BY google_place_id)) FROM restaurants;")" = "$BEFORE" ] \
  || fail "2 回目で内容が変わった（冪等でない）"
echo "✅ 5. 冪等"

echo
echo "すべて通過（5/5）"
