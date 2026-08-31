#!/usr/bin/env bash
# =============================================================================
# #1706 負荷の計測が «本処理を殺さない» ことを検証する
# =============================================================================
#
# 2026-08-31、共有 DB への負荷を «見えるようにする» ために log_db_load を足した。
# ところが SQL を書き間違えており（`date_trunc(...) FILTER (...)`）、
# **その 1 文で同期が丸ごと落ちた**。計測が本処理を殺した。
#
# try/except で例外を握り潰していたのに落ちたのは、PostgreSQL では
# **1 文が失敗した時点でトランザクション全体が中断状態になり、以降の全ての文が
# 拒否される**ためである。Python 側で握り潰しても、トランザクションは死んでいる。
#
# 「おまけの処理は本処理を止めない」を、思い込みではなく機械で固定する。
#
#   bash scripts/20260808T0000_restaurant/tests/test_log_db_load.sh
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGD="${PGD:-/tmp/pgdata_1706_dbload}"
PGPORT="${PGPORT:-55445}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

fail() { echo "❌ $*" >&2; exit 1; }
cleanup() { su postgres -c "$PGBIN/pg_ctl -D $PGD stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$PGD"; }
trap cleanup EXIT

rm -rf "$PGD"; mkdir -p "$PGD"; chown postgres:postgres "$PGD"
su postgres -c "$PGBIN/initdb -D $PGD -U postgres --auth=trust" >/dev/null
su postgres -c "$PGBIN/pg_ctl -D $PGD -o '-p $PGPORT -k /tmp' -l $PGD/log start" >/dev/null
for _ in $(seq 1 20); do psql -h /tmp -p "$PGPORT" -U postgres -c 'select 1' >/dev/null 2>&1 && break; sleep 0.5; done

psql -h /tmp -p "$PGPORT" -U postgres -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS dev;
CREATE TABLE dev.canary (v INT);
SQL

export DATABASE_URL="postgresql://postgres@/postgres?host=/tmp&port=$PGPORT"
cd "$REPO_ROOT/scripts/20260808T0000_restaurant"

OUT=$(python3 - <<'PY'
import os, sys
sys.path.insert(0, os.getcwd())
import pg_sync_common as m

conn = m.connect_postgres("dev", allow_public=False)

# --- 1. 本物の計測 SQL が通り、値が取れる ---
m.log_db_load(conn, "検査")

# 計測のあとも本処理を続けられること
with conn.cursor() as c:
    c.execute("INSERT INTO canary VALUES (1)")
    c.execute("SELECT COUNT(*) FROM canary")
    after_ok = c.fetchone()[0]

# --- 2. 計測 SQL が壊れていても、本処理は続けられる（SAVEPOINT の効果）---
#     «壊れた計測» を本物と同じ入口から流し込む。
original = m.log_db_load.__globals__
broken_sql_used = False
import types, re, inspect
src = inspect.getsource(m.log_db_load)
# 本物の関数の中の SELECT を、必ず失敗する SQL に差し替えて同じ形で実行する
broken = src.replace("SELECT\n", "SELECT no_such_function(),\n", 1)
ns = dict(m.__dict__)
exec(compile(broken, "<broken>", "exec"), ns)
ns["log_db_load"](conn, "壊れた計測")
broken_sql_used = True

with conn.cursor() as c:
    c.execute("INSERT INTO canary VALUES (2)")
    c.execute("SELECT COUNT(*) FROM canary")
    after_broken = c.fetchone()[0]

print(f"{after_ok}|{after_broken}|{broken_sql_used}")
PY
) || fail "計測のあとに本処理を続けられなかった（＝計測が本処理を殺している）"

IFS='|' read -r AFTER_OK AFTER_BROKEN USED <<<"$OUT"

[ "$AFTER_OK" = "1" ] || fail "正常な計測のあとに INSERT できなかった（$AFTER_OK）"
echo "✅ 1. 計測 SQL は実際の PostgreSQL で通る（FILTER の付け先が正しい）"

[ "$USED" = "True" ] || fail "壊れた計測の経路を通っていない（テストが空回りしている）"
[ "$AFTER_BROKEN" = "2" ] || fail "壊れた計測のあとに INSERT できなかった（$AFTER_BROKEN）。トランザクションが死んでいる"
echo "✅ 2. 計測が失敗しても本処理は続く（SAVEPOINT で封じ込めている）"

echo
echo "すべて通過（2/2）"
