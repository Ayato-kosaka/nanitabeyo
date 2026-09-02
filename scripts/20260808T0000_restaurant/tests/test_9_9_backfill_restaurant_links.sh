#!/usr/bin/env bash
# =============================================================================
# #1706 取りこぼした restaurant_links の埋め直しを、実物の PostgreSQL で検証する
# =============================================================================
#
# 2026-09-02 の本番投入で、新規 547,941 店のリンクが 1 本も入らなかった。
# 埋め直しは «消さずに足すだけ» なので事故の幅は小さいが、対象の絞り方を
# 間違えると (a) 埋め直せない (b) 既にあるものを二重に持つ の 2 つが起きる。
#
# SQL は 9_1 / 9_9 のソースから抜き出す（写経しない）。
#
#   bash scripts/20260808T0000_restaurant/tests/test_9_9_backfill_restaurant_links.sh
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGD="${PGD:-/tmp/pgdata_1706_backfill_links}"
PGPORT="${PGPORT:-55441}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TESTS_DIR="$REPO_ROOT/scripts/20260808T0000_restaurant/tests"

fail() { echo "❌ $*" >&2; exit 1; }
q() { psql -h /tmp -p "$PGPORT" -U postgres -tAq -c "SET search_path=dev; $1"; }
run_sql() { psql -h /tmp -p "$PGPORT" -U postgres -q -v ON_ERROR_STOP=1 -c "SET search_path=dev; $1" >/dev/null; }

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
  created_by_source TEXT NOT NULL,
  source_row_hash TEXT);
CREATE TABLE restaurant_links (
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, value TEXT NOT NULL, source TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, kind, value));
-- 本番の staging と同じ形（埋め直しはここから対象を集める）
CREATE TABLE restaurant_sync_staging (
  google_place_id TEXT, phone TEXT, website TEXT, social_urls_json TEXT, row_hash TEXT);

INSERT INTO restaurants (google_place_id, created_by_source, source_row_hash) VALUES
  ('P_LOST',    'pipeline', 'h1'),   -- ★ 取りこぼした行（埋める）
  ('P_HAS',     'pipeline', 'h2'),   -- 既に open_data のリンクを持つ（触らない）
  ('P_NOTHING', 'pipeline', 'h3'),   -- catalog 側に入れるものが無い（回を空回りさせない）
  ('P_APP',     'user',     NULL),   -- アプリ製（対象外）
  ('P_USERLINK','pipeline', 'h4');   -- ユーザーが足したリンクだけ持つ（open_data は無い＝埋める）

INSERT INTO restaurant_sync_staging VALUES
  ('P_LOST',     '03-1111-1111', 'https://lost.example.com',
   '["https://instagram.com/lost"]', 'h1'),
  ('P_HAS',      '03-2222-2222', 'https://has.example.com',  '[]', 'h2'),
  ('P_NOTHING',  NULL,           NULL,                        '[]', 'h3'),
  ('P_APP',      '03-3333-3333', 'https://app.example.com',   '[]', 'hA'),
  ('P_USERLINK', '03-4444-4444', NULL,                        '[]', 'h4');
SQL

RID_LOST=$(q "SELECT id FROM restaurants WHERE google_place_id='P_LOST';")
RID_HAS=$(q "SELECT id FROM restaurants WHERE google_place_id='P_HAS';")
RID_APP=$(q "SELECT id FROM restaurants WHERE google_place_id='P_APP';")
RID_USERLINK=$(q "SELECT id FROM restaurants WHERE google_place_id='P_USERLINK';")

run_sql "
INSERT INTO restaurant_links (restaurant_id, kind, value, source) VALUES
  ('$RID_HAS','phone','03-2222-2222','open_data'),                   -- 既にある
  ('$RID_APP','phone','03-3333-3333','open_data'),                   -- アプリ製の行
  ('$RID_USERLINK','website','https://user.example.com','user');     -- ユーザー追加
"

TARGET_SQL="$(python3 "$TESTS_DIR/extract_links_sql.py" --which backfill_target)"
INSERT_SQL="$(python3 "$TESTS_DIR/extract_links_sql.py" --which insert)"

# 本番は TEMP テーブルだが、psql は文ごとに別トランザクションではないので
# 通常テーブルとして作り、名前だけ本番と揃える。
apply_once() {
  run_sql "SET client_min_messages=warning; DROP TABLE IF EXISTS restaurant_link_backfill_all, restaurant_sync_work;"
  run_sql "${TARGET_SQL/CREATE TEMP TABLE/CREATE TABLE}"
  run_sql "CREATE TABLE restaurant_sync_work AS SELECT * FROM restaurant_link_backfill_all;"
  run_sql "$INSERT_SQL"
}
apply_once

TARGETS=$(q "SELECT COUNT(*) FROM restaurant_link_backfill_all;")

# --- 1. ★ 取りこぼした行が埋まる ---
[ "$(q "SELECT COUNT(*) FROM restaurant_links WHERE restaurant_id='$RID_LOST' AND source='open_data';")" = "3" ] \
  || fail "取りこぼした行に電話・サイト・SNS の 3 本が入っていない"
echo "✅ 1. 取りこぼした pipeline の行に、電話・サイト・SNS が入る"

# --- 2. 既に open_data のリンクを持つ行は対象にしない ---
[ "$(q "SELECT COUNT(*) FROM restaurant_links WHERE restaurant_id='$RID_HAS';")" = "1" ] \
  || fail "既にリンクを持つ行を触った（website まで足している）"
echo "✅ 2. 既に open_data のリンクを持つ行は触らない"

# --- 3. ★ アプリ製の行は対象にしない ---
[ "$(q "SELECT COUNT(*) FROM restaurant_links WHERE restaurant_id='$RID_APP';")" = "1" ] \
  || fail "アプリ製の行へリンクを足した"
echo "✅ 3. アプリ製（created_by_source <> 'pipeline'）の行は触らない"

# --- 4. ユーザーが足したリンクは消えず、open_data が足される ---
[ "$(q "SELECT COUNT(*) FROM restaurant_links WHERE restaurant_id='$RID_USERLINK' AND source='user';")" = "1" ] \
  || fail "ユーザーが足したリンクが消えた（埋め直しは消してはいけない）"
[ "$(q "SELECT COUNT(*) FROM restaurant_links WHERE restaurant_id='$RID_USERLINK' AND source='open_data' AND value='03-4444-4444';")" = "1" ] \
  || fail "ユーザー由来しか無い行へ open_data の電話が入っていない"
echo "✅ 4. ユーザーのリンクは残り、open_data が足される"

# --- 5. 入れるものが無い店は対象に含めない（回を空回りさせない） ---
[ "$(q "SELECT COUNT(*) FROM restaurant_link_backfill_all WHERE google_place_id='P_NOTHING';")" = "0" ] \
  || fail "電話もサイトも SNS も無い店を対象に入れている"
echo "✅ 5. 入れるものが 1 つも無い店は対象に含めない（対象 $TARGETS 件）"

# --- 6. ★ 冪等（2 回流しても増えない・対象が空になる） ---
BEFORE=$(q "SELECT COUNT(*) FROM restaurant_links;")
apply_once
[ "$(q "SELECT COUNT(*) FROM restaurant_links;")" = "$BEFORE" ] \
  || fail "2 回目で件数が変わった（冪等でない）"
[ "$(q "SELECT COUNT(*) FROM restaurant_link_backfill_all;")" = "0" ] \
  || fail "2 回目でも対象が残っている（埋めたのに対象から外れていない）"
echo "✅ 6. 冪等（2 回目は対象 0 件・$BEFORE 件のまま）"

echo
echo "すべて通過（6/6）"
