#!/usr/bin/env bash
# =============================================================================
# #1681 country_code の穴埋めが «埋めてよい行だけ» を埋めることを検証する
# =============================================================================
#
# 上書きではなく穴埋めなので、既に値がある行を書き換えないことが要である。
# 判定式は 9_9_backfill_country_code.py から抜き出す（写経しない）。
#
#   bash scripts/20260808T0000_restaurant/tests/test_9_9_country_code_backfill.sh
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGD="${PGD:-/tmp/pgdata_1681_cc}"
PGPORT="${PGPORT:-55436}"
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
  address_components JSONB NOT NULL,
  country_code TEXT,
  CONSTRAINT cc_chk CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'));

INSERT INTO restaurants (google_place_id, address_components, country_code) VALUES
  -- 埋まるべき: country の shortText が 2 文字
  ('P_JP', '[{"types":["locality"],"shortText":"Shibuya"},{"types":["country"],"shortText":"JP","longText":"Japan"}]', NULL),
  ('P_US', '[{"types":["country"],"shortText":"US","longText":"United States"}]', NULL),
  -- 埋まらないべき: longText しか無い（Google が返さないことがある）
  ('P_LONGONLY', '[{"types":["country"],"longText":"日本"}]', NULL),
  -- 埋まらないべき: country の要素が無い
  ('P_NOCOUNTRY', '[{"types":["locality"],"shortText":"Shibuya"}]', NULL),
  -- 埋まらないべき: 空配列（パイプライン製の行はこれ）
  ('P_EMPTY', '[]', NULL),
  -- ★ 触らないべき: 既に値がある
  ('P_ALREADY', '[{"types":["country"],"shortText":"US","longText":"United States"}]', 'JP');
SQL

EXPR="$(python3 "$TESTS_DIR/extract_country_backfill_sql.py")"
UPDATE_SQL="UPDATE restaurants r SET country_code = $EXPR WHERE r.country_code IS NULL AND $EXPR IS NOT NULL;"

BEFORE=$(q "SELECT COUNT(*) FROM restaurants WHERE country_code IS NOT NULL;")
q "$UPDATE_SQL" >/dev/null

[ "$(q "SELECT country_code FROM restaurants WHERE google_place_id='P_JP';")" = "JP" ] || fail "JP が入らない"
[ "$(q "SELECT country_code FROM restaurants WHERE google_place_id='P_US';")" = "US" ] || fail "US が入らない"
echo "✅ 1. shortText が 2 文字なら埋まる"

for p in P_LONGONLY P_NOCOUNTRY P_EMPTY; do
  [ -z "$(q "SELECT country_code FROM restaurants WHERE google_place_id='$p';")" ] \
    || fail "$p を埋めてしまった（推測してはいけない）"
done
echo "✅ 2. longText だけ / country 無し / 空配列 は埋めない（推測しない）"

# ★ ここが本題
[ "$(q "SELECT country_code FROM restaurants WHERE google_place_id='P_ALREADY';")" = "JP" ] \
  || fail "既に値がある行を上書きした"
echo "✅ 3. 既に値がある行は上書きしない（穴埋めであって上書きではない）"

AFTER=$(q "SELECT COUNT(*) FROM restaurants WHERE country_code IS NOT NULL;")
[ "$((AFTER - BEFORE))" = "2" ] || fail "埋めた件数が 2 ではない（$BEFORE → $AFTER）"
echo "✅ 4. 埋めたのはちょうど 2 行"

q "$UPDATE_SQL" >/dev/null
[ "$(q "SELECT COUNT(*) FROM restaurants WHERE country_code IS NOT NULL;")" = "$AFTER" ] \
  || fail "2 回目で件数が変わった（冪等でない）"
echo "✅ 5. 冪等（2 回流しても変わらない）"

echo
echo "すべて通過（5/5）"
