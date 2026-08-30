#!/usr/bin/env bash
# =============================================================================
# #1706 provenance UPDATE を «変わる行だけ» に絞っても意味が変わらないことを検証する
# =============================================================================
#
# 2026-08-30 の dev 同期は、この 1 文が 62 万行を無条件に書き換えて
# 30 分の statement timeout に当たった（skip 判定の 619,329 行を含む）。
# 変わる行だけに絞ったうえで、**synced_at は全行に付く**ことを固定する。
# synced_at が欠けると «最新 catalog に居なかった行» の監査が壊れる。
#
# SQL は 9_1 のソースから抜き出す（写経しない）。
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGD="${PGD:-/tmp/pgdata_1706_prov}"
PGPORT="${PGPORT:-55437}"
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
  source_seed_id UUID,
  source_names TEXT[] NOT NULL DEFAULT '{}',
  source_row_hash TEXT,
  synced_at TIMESTAMPTZ,
  created_by_source TEXT NOT NULL DEFAULT 'user');
CREATE TABLE restaurant_sync_staging (
  google_place_id TEXT, seed_id UUID, source_names_json TEXT, row_hash TEXT);

INSERT INTO restaurants (google_place_id, source_seed_id, source_names, source_row_hash, synced_at, created_by_source) VALUES
  -- 変わらない（provenance 一致・hash 一致）→ provenance は書かれない
  ('P_SAME','11111111-1111-1111-1111-111111111111','{"のれん"}','hash-1','2020-01-01','pipeline'),
  -- hash が変わった → 書かれる
  ('P_HASH','22222222-2222-2222-2222-222222222222','{"のれん"}','hash-OLD','2020-01-01','pipeline'),
  -- source_names が変わった → 書かれる
  ('P_NAMES','33333333-3333-3333-3333-333333333333','{"ふるい"}','hash-3','2020-01-01','pipeline'),
  -- アプリ製・hash 違い → **hash は書かれないが synced_at は付く**
  ('P_USER','44444444-4444-4444-4444-444444444444','{"のれん"}',NULL,'2020-01-01','user');

INSERT INTO restaurant_sync_staging VALUES
  ('P_SAME','11111111-1111-1111-1111-111111111111','["のれん"]','hash-1'),
  ('P_HASH','22222222-2222-2222-2222-222222222222','["のれん"]','hash-NEW'),
  ('P_NAMES','33333333-3333-3333-3333-333333333333','["あたらしい"]','hash-3'),
  ('P_USER','44444444-4444-4444-4444-444444444444','["のれん"]','hash-NEW');
SQL

PROV="$(python3 "$TESTS_DIR/extract_provenance_sql.py" --which provenance)"
SYNCED="$(python3 "$TESTS_DIR/extract_provenance_sql.py" --which synced_at)"

run_sql "$PROV"

# --- 1. 変わらない行の provenance は書かれない（＝ 62 万行の空更新をしない）---
[ "$(q "SELECT synced_at FROM restaurants WHERE google_place_id='P_SAME';")" = "2020-01-01 00:00:00+00" ] \
  || fail "変わらない行を provenance UPDATE が書き換えた"
echo "✅ 1. 中身が変わらない行は provenance UPDATE の対象外"

# --- 2. hash / source_names が変わった行は書かれる ---
[ "$(q "SELECT source_row_hash FROM restaurants WHERE google_place_id='P_HASH';")" = "hash-NEW" ] \
  || fail "hash が変わった行が更新されていない"
[ "$(q "SELECT source_names[1] FROM restaurants WHERE google_place_id='P_NAMES';")" = "あたらしい" ] \
  || fail "source_names が変わった行が更新されていない"
echo "✅ 2. hash / source_names が変わった行は更新される"

# --- 3. ★ アプリ製の行に hash を刻まない（既存の不変条件を壊していない）---
[ -z "$(q "SELECT source_row_hash FROM restaurants WHERE google_place_id='P_USER';")" ] \
  || fail "アプリ製の行に source_row_hash を刻んだ"
echo "✅ 3. アプリ製の行に source_row_hash を刻まない"

# --- 4. ★ synced_at は «全行» に付く（監査が壊れない）---
run_sql "$SYNCED"
STALE=$(q "SELECT COUNT(*) FROM restaurants WHERE synced_at = '2020-01-01';")
[ "$STALE" = "0" ] || fail "synced_at が付いていない行が $STALE 件ある（監査が誤検知する）"
echo "✅ 4. synced_at は staging に居た全行へ付く"

# --- 5. 冪等（2 回目は provenance が 0 行）---
BEFORE=$(q "SELECT md5(string_agg(google_place_id||coalesce(source_row_hash,'')||array_to_string(source_names,','), '|' ORDER BY google_place_id)) FROM restaurants;")
run_sql "$PROV"; run_sql "$SYNCED"
[ "$(q "SELECT md5(string_agg(google_place_id||coalesce(source_row_hash,'')||array_to_string(source_names,','), '|' ORDER BY google_place_id)) FROM restaurants;")" = "$BEFORE" ] \
  || fail "2 回目で内容が変わった（冪等でない）"
echo "✅ 5. 冪等"

echo
echo "すべて通過（5/5）"
