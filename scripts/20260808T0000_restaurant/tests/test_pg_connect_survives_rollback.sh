#!/usr/bin/env bash
# =============================================================================
# #1706 rollback しても search_path / statement_timeout が消えないことを検証する
# =============================================================================
#
# PostgreSQL の `SET`（LOCAL 無し）は **トランザクションの一部**であり、
# ROLLBACK で巻き戻る。connect_postgres が接続後に `SET search_path TO dev,public`
# を流していたため、呼び出し側が rollback() したあとに SQL を流すと
# **search_path が既定へ戻り、dev のつもりで public を触っていた**。
#
# 2026-08-31 に 9_9_maintain_restaurants.py で実際に起き、
# `VACUUM (ANALYZE) restaurants` が public.restaurants に当たった。
# statement_timeout も同時に消えており、サーバ既定の短い値へ戻っていた。
#
# **落ちない・壊れない・気付けない**種類の事故なので、機械で固定する。
# 接続時オプション（libpq の startup packet）で渡した値はセッションの既定値に
# なるので、ROLLBACK はそこへ戻る——ということを実物の PostgreSQL で確かめる。
#
#   bash scripts/20260808T0000_restaurant/tests/test_pg_connect_survives_rollback.sh
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGD="${PGD:-/tmp/pgdata_1706_searchpath}"
PGPORT="${PGPORT:-55441}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

fail() { echo "❌ $*" >&2; exit 1; }
cleanup() { su postgres -c "$PGBIN/pg_ctl -D $PGD stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$PGD"; }
trap cleanup EXIT

rm -rf "$PGD"; mkdir -p "$PGD"; chown postgres:postgres "$PGD"
su postgres -c "$PGBIN/initdb -D $PGD -U postgres --auth=trust" >/dev/null
su postgres -c "$PGBIN/pg_ctl -D $PGD -o '-p $PGPORT -k /tmp' -l $PGD/log start" >/dev/null
for _ in $(seq 1 20); do psql -h /tmp -p "$PGPORT" -U postgres -c 'select 1' >/dev/null 2>&1 && break; sleep 0.5; done

# dev と public の両方に同名の表を置き、**どちらを触ったか区別できる**ようにする。
# あわせて **ロールに短い statement_timeout を設定**して本番の条件を再現する。
# Supabase のロールには 2min が設定されており、これは接続時オプションに勝つ。
# それを知らずに «オプションで渡したから大丈夫» としたため、rollback 後の走査が
# 2 分で切られた（2026-08-31 に実測）。
psql -h /tmp -p "$PGPORT" -U postgres -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS dev;
CREATE TABLE dev.restaurants (id INT);     INSERT INTO dev.restaurants VALUES (1);
CREATE TABLE public.restaurants (id INT);  INSERT INTO public.restaurants VALUES (2), (3);
ALTER ROLE postgres SET statement_timeout = '2min';
SQL

export DATABASE_URL="postgresql://postgres@/postgres?host=/tmp&port=$PGPORT"
cd "$REPO_ROOT/scripts/20260808T0000_restaurant"

OUT=$(python3 - <<'PY'
import os, sys
sys.path.insert(0, os.getcwd())
from pg_sync_common import connect_postgres, reapply_session_settings

conn = connect_postgres("dev", allow_public=False)
with conn.cursor() as c:
    c.execute("SELECT current_schema(), current_setting('statement_timeout')")
    before = c.fetchone()

# ★ 事故の再現条件: 途中で rollback してから、続けて SQL を流す
conn.rollback()

with conn.cursor() as c:
    c.execute("SELECT current_schema(), current_setting('statement_timeout')")
    naked_row = c.fetchone()         # 張り直す «前» の値
    # 修飾しない表名がどちらへ解決されるか（dev=1行 / public=2行）
    c.execute("SELECT COUNT(*) FROM restaurants")
    rows = c.fetchone()[0]

# rollback 後に重い読み取りを続けるスクリプトはここを呼ぶ約束になっている
reapply_session_settings(conn, "dev")
with conn.cursor() as c:
    c.execute("SELECT current_schema(), current_setting('statement_timeout')")
    after = c.fetchone()

print(f"{before[0]}|{before[1]}|{after[0]}|{after[1]}|{rows}|{naked_row[1]}|{naked_row[0]}")
PY
)

IFS='|' read -r S_BEFORE T_BEFORE S_AFTER T_AFTER ROWS T_NAKED S_NAKED <<<"$OUT"

# --- 1. 接続直後は dev を向いている ---
[ "$S_BEFORE" = "dev" ] || fail "接続直後の current_schema が dev でない（$S_BEFORE）"
echo "✅ 1. 接続直後の search_path は dev"

# --- 2. ★ rollback しても dev のまま（回帰の本体）---
#   接続時オプションで渡した search_path はセッション既定になるので、
#   ROLLBACK はここへ戻る。**張り直しを忘れても public を触らない**ための保険。
[ "$S_NAKED" = "dev" ] || fail "rollback で search_path が $S_NAKED へ戻った（public を触る事故が再発する）"
echo "✅ 2. rollback しても search_path は dev のまま（接続時オプションが保険になる）"

# --- 3. ★ 修飾しない表名が dev の表に解決される（実害の直接確認）---
[ "$ROWS" = "1" ] || fail "rollback 後の 'FROM restaurants' が dev を指していない（$ROWS 行 / dev は 1 行・public は 2 行）"
echo "✅ 3. rollback 後も修飾なしの表名は dev に解決される"

# --- 4. ★ 接続直後は長い statement_timeout が効いている（ロール既定に勝つ）---
#   接続時オプションだけではロール既定（2min）に負ける。SET で上書きが要る。
[ "$T_BEFORE" != "2min" ] || fail "接続直後の statement_timeout がロール既定(2min)のまま。長い文が 2 分で切られる"
echo "✅ 4. 接続直後の statement_timeout はロール既定を上書きしている（$T_BEFORE）"

# --- 4-b. ★ rollback 後に張り直せば、必ず意図した値になる ---
#
#   rollback の «戻り先» は環境で違う（接続時オプションが勝つ環境と、ロール既定が
#   勝つ環境がある。Supabase は後者で 2min）。**どちらが勝つかに依存しない**のが
#   この設計の要点なので、テストも «戻り先» ではなく «張り直せること» を固定する。
#   参考値として、張り直す前の値は $T_NAKED だった。
[ "$T_AFTER" = "$T_BEFORE" ] || fail "reapply 後の statement_timeout が $T_AFTER（期待 $T_BEFORE）"
[ "$S_AFTER" = "dev" ] || fail "reapply 後の current_schema が $S_AFTER"
echo "✅ 4-b. rollback 後に張り直せば search_path も timeout も意図どおりになる（張り直す前: $T_NAKED）"

# --- 5. public は --allow-public 無しでは開けない（既存の不変条件）---
if python3 -c "
import os,sys; sys.path.insert(0, os.getcwd())
from pg_sync_common import connect_postgres
connect_postgres('public', allow_public=False)" 2>/dev/null; then
  fail "--allow-public 無しで public へ接続できてしまう"
fi
echo "✅ 5. public は --allow-public 無しでは開けない"

echo
echo "すべて通過（6/6）"
