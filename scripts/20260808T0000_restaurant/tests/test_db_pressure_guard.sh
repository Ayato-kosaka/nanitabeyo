#!/usr/bin/env bash
# =============================================================================
# #1706 «他人を止めていたら自分から降りる» が本当に働くことを検証する
# =============================================================================
#
# 2026-08-31 に共有 DB を圧迫して本番と dev の両方を止めたとき、私が持っていた
# 守りは **時間の上限だけ**だった。時間内に収まっていても他人が待たされていれば
# 止めるべきなのに、«他人が困っているか» を一度も見ていなかった。
#
# 誰も見ていない時間帯に流すなら、自分で気付いて降りるしかない。
# **発火しない見張りは無いのと同じ**なので、実際にロック待ちを作って確かめる。
#
#   bash scripts/20260808T0000_restaurant/tests/test_db_pressure_guard.sh
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGD="${PGD:-/tmp/pgdata_1706_pressure}"
PGPORT="${PGPORT:-55447}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

fail() { echo "❌ $*" >&2; exit 1; }
cleanup() {
  [ -n "${BLOCKER_PID:-}" ] && kill "$BLOCKER_PID" 2>/dev/null || true
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
CREATE TABLE dev.restaurants (id INT PRIMARY KEY, name TEXT);
INSERT INTO dev.restaurants VALUES (1, 'のれん');
SQL

export DATABASE_URL="postgresql://postgres@/postgres?host=/tmp&port=$PGPORT"
cd "$REPO_ROOT/scripts/20260808T0000_restaurant"

# --- 1. 誰も困っていないときは発火しない（偽陽性で同期を止めない）---
QUIET=$(python3 - <<'PY'
import os, sys
sys.path.insert(0, os.getcwd())
from pg_sync_common import connect_postgres, check_db_pressure
conn = connect_postgres("dev", allow_public=False)
harmful, reason = check_db_pressure(conn)
print(f"{harmful}|{reason}")
PY
)
[ "${QUIET%%|*}" = "False" ] || fail "誰も困っていないのに発火した（$QUIET）"
echo "✅ 1. 誰も困っていなければ発火しない"

# --- 2. ★ 実際にロック待ちを作ると発火する ---
#     行を掴んだまま放置するセッションを立て、もう 1 本が同じ行を待つ状態を作る。
psql -h /tmp -p "$PGPORT" -U postgres -q <<'SQL' &
SET search_path=dev;
BEGIN;
UPDATE restaurants SET name='掴んだまま' WHERE id=1;
SELECT pg_sleep(30);
COMMIT;
SQL
HOLDER=$!
sleep 2
psql -h /tmp -p "$PGPORT" -U postgres -q -c "SET search_path=dev; UPDATE restaurants SET name='待たされる' WHERE id=1;" &
BLOCKER_PID=$!
sleep 2

BUSY=$(python3 - <<'PY'
import os, sys
sys.path.insert(0, os.getcwd())
from pg_sync_common import connect_postgres, check_db_pressure
conn = connect_postgres("dev", allow_public=False)
harmful, reason = check_db_pressure(conn)
print(f"{harmful}|{reason}")
PY
)
kill "$HOLDER" 2>/dev/null || true
kill "$BLOCKER_PID" 2>/dev/null || true
BLOCKER_PID=""

[ "${BUSY%%|*}" = "True" ] || fail "ロック待ちがあるのに発火しなかった（$BUSY）。見張りが働いていない"
echo "✅ 2. ロック待ちが出たら発火する: ${BUSY#*|}"

echo
echo "すべて通過（2/2）"
