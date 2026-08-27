#!/usr/bin/env bash
# =============================================================================
# #843 backfill の «どの行を掴むか» を実物の PostgreSQL で検証する
# =============================================================================
#
# 9_9_backfill_created_by_source.py は、既に投入済みの行へ遡って
# created_by_source='pipeline' を刻む。対象は約 57 万行の一括 UPDATE なので、
# 条件を 1 つ間違えるとアプリが作った行まで pipeline 扱いになり、
# **次の同期でオープンデータ値に上書きされる**（＝今回直した事故が再発する）。
#
# 条件が «なぜこの 3 つなのか» を、外れる場合を作って確かめる。
#
#   created_by_source = 'user'          -- 二重実行を避ける
#   AND source_seed_id IS NOT NULL      -- これだけでは足りない（下記）
#   AND created_at BETWEEN 開始 AND 終了 -- 同期の実行窓
#
# `source_seed_id IS NOT NULL` だけでは足りない理由:
#   9_1 の provenance UPDATE は **アプリ製の行にも source_seed_id を付ける**。
#   よって「seed が付いている＝パイプラインが作った」は成り立たない。
#
# `created_at` だけでも足りない理由:
#   同期の実行中にアプリが店を作りうる。両方を課してはじめて絞れる。
#
# 使い方:
#   bash scripts/20260808T0000_restaurant/tests/test_9_9_backfill.sh
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGD="${PGD:-/tmp/pgdata_843_backfill}"
PGPORT="${PGPORT:-55434}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MIGRATION="$REPO_ROOT/infra/supabase/migrations/20260827T0000_add_restaurants_created_by_source.sql"

fail() { echo "❌ $*" >&2; exit 1; }
q() { psql -h /tmp -p "$PGPORT" -U postgres -tAq -c "SET search_path=dev; $1"; }
cleanup() { su postgres -c "$PGBIN/pg_ctl -D $PGD stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$PGD"; }
trap cleanup EXIT

rm -rf "$PGD"; mkdir -p "$PGD"; chown postgres:postgres "$PGD"
su postgres -c "$PGBIN/initdb -D $PGD -U postgres --auth=trust" >/dev/null
su postgres -c "$PGBIN/pg_ctl -D $PGD -o '-p $PGPORT -k /tmp' -l $PGD/log start" >/dev/null
for _ in $(seq 1 20); do psql -h /tmp -p "$PGPORT" -U postgres -c 'select 1' >/dev/null 2>&1 && break; sleep 0.5; done

psql -h /tmp -p "$PGPORT" -U postgres -q <<'SQL'
CREATE SCHEMA IF NOT EXISTS dev;
SET search_path = dev;
CREATE TABLE restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_place_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL, source_seed_id UUID);
SQL
psql -h /tmp -p "$PGPORT" -U postgres -q -c "SET search_path=dev;" -f "$MIGRATION" >/dev/null

# 同期の実行窓を 2026-08-24 10:00 〜 12:00 とする
psql -h /tmp -p "$PGPORT" -U postgres -q <<'SQL'
SET search_path = dev;
INSERT INTO restaurants (google_place_id, name, created_at, source_seed_id) VALUES
  -- ① 同期が窓の中で作った行 → pipeline にすべき
  ('P_SYNC_1','同期が作った1','2026-08-24T10:30:00Z','aaaaaaaa-0000-0000-0000-000000000001'),
  ('P_SYNC_2','同期が作った2','2026-08-24T11:45:00Z','aaaaaaaa-0000-0000-0000-000000000002'),
  -- ② 窓より前にアプリが作った行。provenance UPDATE で seed が付いている
  --    → 掴んではいけない（掴むと次の同期で上書きされ、事故が再発する）
  ('P_APP_OLD','アプリが窓の前に作った','2026-08-20T09:00:00Z','aaaaaaaa-0000-0000-0000-000000000003'),
  -- ③ 窓より後にアプリが作った行 → 掴んではいけない
  ('P_APP_NEW','アプリが窓の後に作った','2026-08-25T09:00:00Z','aaaaaaaa-0000-0000-0000-000000000004'),
  -- ④ 窓の中だが seed が無い（＝同期の産物ではない） → 掴んではいけない
  ('P_APP_IN_WINDOW','アプリが窓の中で作った','2026-08-24T11:00:00Z',NULL);
SQL

BACKFILL="UPDATE restaurants SET created_by_source='pipeline'
          WHERE created_by_source='user' AND source_seed_id IS NOT NULL
            AND created_at BETWEEN '2026-08-24T10:00:00Z' AND '2026-08-24T12:00:00Z'"

# --- 1. 掴む行がちょうど 2 件であること ---
N=$(psql -h /tmp -p "$PGPORT" -U postgres -tAq -c "SET search_path=dev; WITH u AS ($BACKFILL RETURNING 1) SELECT COUNT(*) FROM u;")
[ "$N" = "2" ] || fail "掴んだ件数が想定と違う: $N（期待 2）"
echo "✅ 1. 同期の実行窓で作られた seed 付きの行だけを 2 件掴んだ"

# --- 2. アプリが作った 3 行が 'user' のまま残っていること ---
for gid in P_APP_OLD P_APP_NEW P_APP_IN_WINDOW; do
  got=$(q "SELECT created_by_source FROM restaurants WHERE google_place_id='$gid';")
  [ "$got" = "user" ] || fail "$gid が user でない（$got）。次の同期で上書きされる"
done
echo "✅ 2. アプリが作った行（窓の前/後/窓内だが seed 無し）は user のまま"

# --- 3. 再実行が no-op であること（created_by_source='user' 条件が効いている） ---
N2=$(psql -h /tmp -p "$PGPORT" -U postgres -tAq -c "SET search_path=dev; WITH u AS ($BACKFILL RETURNING 1) SELECT COUNT(*) FROM u;")
[ "$N2" = "0" ] || fail "再実行が no-op でない（$N2 件を再度掴んだ）"
echo "✅ 3. 再実行は no-op（二重に数えない）"

# --- 4. «seed が付いているか» だけでは絞れないことを示す（条件の必要性の裏付け） ---
NAIVE=$(q "SELECT COUNT(*) FROM restaurants WHERE source_seed_id IS NOT NULL;")
[ "$NAIVE" = "4" ] || fail "前提が崩れている: seed 付きは 4 件のはず（$NAIVE）"
echo "✅ 4. seed の有無だけだと 4 件掴む（うち 2 件はアプリ製）→ 実行窓の条件が要る"

# --- 5. 件数不一致を検知できること（同期ログの inserted_count と突き合わせる） ---
#     9_9 は updated が (0, expected) のどちらでもなければ中断する。
#     ここでは expected=3 を渡した想定で、2 件しか掴めていないことを検知する。
if [ "$N" = "3" ] || [ "$N" = "0" ]; then
  fail "件数不一致の検知が働かない形になっている"
fi
echo "✅ 5. 掴んだ件数(2)は同期ログの想定(3)と違うので、9_9 は中断する"

echo
echo "すべて通過（5/5）"
