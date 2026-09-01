#!/usr/bin/env bash
# =============================================================================
# #1706 古い row_hash の掃除が «消してよいものだけ» を消すことを検証する
# =============================================================================
#
# アプリ製の行に残った row_hash は、過去の版の同期が付けた名残である。放置すると
# その行の created_by_source が 'pipeline' へ変わった瞬間、値 UPDATE の条件が
# 最初から偽になり、**その行だけオープンデータの更新が永久に届かなくなる**。
#
# ただし消してよいのは **アプリ製の行の row_hash だけ**である。
#   ・パイプライン製の hash を消すと、次の同期が 62 万行を全部書き直す
#   ・source_seed_id は «どの seed が根拠か» の記録なので残す
#   ・表示値には一切触らない
#
#   bash scripts/20260808T0000_restaurant/tests/test_9_9_clear_user_row_hash.sh
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGD="${PGD:-/tmp/pgdata_1706_clearhash}"
PGPORT="${PGPORT:-55451}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

fail() { echo "❌ $*" >&2; exit 1; }
q() { psql -h /tmp -p "$PGPORT" -U postgres -tAq -c "SET search_path=dev; $1"; }
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
  google_place_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  image_url TEXT NOT NULL, image_path TEXT,
  source_seed_id UUID, source_row_hash TEXT,
  created_by_source TEXT NOT NULL DEFAULT 'user');
INSERT INTO restaurants (google_place_id, name, image_url, image_path, source_seed_id, source_row_hash, created_by_source) VALUES
  -- ① パイプライン製 → **消してはいけない**（消すと次の同期が全行を書き直す）
  ('P_PIPE', 'パイプライン', '', NULL, '11111111-1111-1111-1111-111111111111', 'h-pipe', 'pipeline'),
  -- ② アプリ製 × 古い hash あり → 消す。seed と表示値は残す
  ('P_APP_H','アプリ',      'https://app/u.jpg', 'gs://app/u.jpg', '22222222-2222-2222-2222-222222222222', 'h-legacy', 'user'),
  -- ③ アプリ製 × hash 無し → 何もしない
  ('P_APP_N','アプリ2',     'https://app/v.jpg', 'gs://app/v.jpg', NULL, NULL, 'user');
SQL

CLEAR_SQL=$(python3 - "$REPO_ROOT" <<'PY'
import sys
from pathlib import Path
mod = (Path(sys.argv[1]) / "scripts/20260808T0000_restaurant/9_9_clear_user_row_hash.py").read_text(encoding="utf-8")
start = mod.index('CLEAR_SQL = """') + len('CLEAR_SQL = """')
print(mod[start:mod.index('"""', start)])
PY
)

N=$(psql -h /tmp -p "$PGPORT" -U postgres -tAq -c "SET search_path=dev; WITH u AS ($CLEAR_SQL RETURNING 1) SELECT COUNT(*) FROM u;")

# --- 1. 掴むのはアプリ製 × hash ありの 1 行だけ ---
[ "$N" = "1" ] || fail "掴んだ件数が想定と違う: $N（期待 1）"
echo "✅ 1. 対象はアプリ製 × hash ありの 1 行だけ"

# --- 2. ★ パイプライン製の hash は残っている（消すと次の同期が全行を書き直す）---
[ "$(q "SELECT source_row_hash FROM restaurants WHERE google_place_id='P_PIPE';")" = "h-pipe" ] \
  || fail "パイプライン製の hash を消した（次の同期が 62 万行を書き直すことになる）"
echo "✅ 2. パイプライン製の hash は消さない"

# --- 3. ★ アプリ製の seed と表示値は残っている ---
[ -n "$(q "SELECT source_seed_id FROM restaurants WHERE google_place_id='P_APP_H';")" ] \
  || fail "source_seed_id まで消した（どの seed が根拠か追えなくなる）"
[ "$(q "SELECT name FROM restaurants WHERE google_place_id='P_APP_H';")" = "アプリ" ] \
  || fail "表示値を書き換えた"
[ "$(q "SELECT image_path FROM restaurants WHERE google_place_id='P_APP_H';")" = "gs://app/u.jpg" ] \
  || fail "画像を書き換えた"
echo "✅ 3. seed と表示値（店名・画像）はそのまま"

# --- 4. 冪等（2 回目は 0 行）---
N2=$(psql -h /tmp -p "$PGPORT" -U postgres -tAq -c "SET search_path=dev; WITH u AS ($CLEAR_SQL RETURNING 1) SELECT COUNT(*) FROM u;")
[ "$N2" = "0" ] || fail "2 回目も掴んだ（冪等でない）"
echo "✅ 4. 冪等（2 回目は 0 行）"

echo
echo "すべて通過（4/4）"
