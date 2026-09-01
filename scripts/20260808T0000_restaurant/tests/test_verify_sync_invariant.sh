#!/usr/bin/env bash
# =============================================================================
# #1706 «アプリ製の行が同期に踏まれていないか» の検査が正しく働くことを検証する
# =============================================================================
#
# この検査はもともと «アプリ製の行に address/country_code が入っていたら異常»
# だった。同期がアプリ製の行に一切触らなかった時代はそれで正しかった。
#
# いまはオーナー承認のうえで **意図的に 2 つ埋めている**（住所の穴埋め 1-a と、
# その行自身の address_components からの country_code）。そのため旧検査は
# **正しい振る舞いで赤くなる**。2026-09-01 の dev 同期で実際に赤くなった。
#
# 赤いのが常態になった検査は、そのうち誰も読まなくなる。そこで «値があるか»
# ではなく **«ユーザーのものが catalog のもので潰されていないか»** を見る形へ
# 変えた。**その新しい検査が、壊れたときにちゃんと赤くなるか**を確かめる。
#
#   bash scripts/20260808T0000_restaurant/tests/test_verify_sync_invariant.sh
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGD="${PGD:-/tmp/pgdata_1706_verify}"
PGPORT="${PGPORT:-55449}"
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
  google_place_id TEXT UNIQUE NOT NULL,
  image_url TEXT NOT NULL, source_row_hash TEXT,
  address TEXT, country_code TEXT,
  created_by_source TEXT NOT NULL DEFAULT 'user');

-- 正常な «同期後» の姿。アプリ製の行は
--   ・住所と国コードが埋まっている（意図した穴埋め。ここで赤くしてはいけない）
--   ・画像は自分のものを保っている
--   ・row_hash は付いていない
INSERT INTO restaurants (google_place_id, image_url, source_row_hash, address, country_code, created_by_source) VALUES
  ('P_PIPE', '',                    'h1',  '東京都1',      'JP', 'pipeline'),
  ('P_APP',  'https://app/u.jpg',   NULL,  '穴埋めした住所', 'JP', 'user');
SQL

# 本番の検査 SQL をソースから抜き出す（写経しない）
SQL_TEXT=$(python3 - "$REPO_ROOT" <<'PY'
import re, sys
from pathlib import Path
src = (Path(sys.argv[1]) / "scripts/20260808T0000_restaurant/9_9_verify_sync_result.py").read_text(encoding="utf-8")
hits = re.findall(r'"""\s*(SELECT\s+--[^"]*?source_row_hash IS NOT NULL[^"]*?)"""', src, re.S)
if len(hits) != 1:
    sys.exit(f"検査SQLを一意に取れませんでした（{len(hits)}件）")
print(hits[0])
PY
)

run_check() { q "$SQL_TEXT;" | tr '|' ' '; }

# --- 1. ★ 意図した穴埋めがあっても発火しない（旧検査はここで赤くなった）---
read -r HASHED BLANKED <<<"$(run_check)"
[ "$HASHED" = "0" ] && [ "$BLANKED" = "0" ] \
  || fail "正常な状態で発火した（hashed=$HASHED blanked=$BLANKED）。旧検査と同じ誤りが残っている"
echo "✅ 1. 住所・国コードが埋まっていても発火しない（意図した穴埋めを事故と呼ばない）"

# --- 2. ★ アプリ製の行に row_hash が付いたら発火する ---
q "UPDATE restaurants SET source_row_hash='leaked' WHERE google_place_id='P_APP';" >/dev/null
read -r HASHED BLANKED <<<"$(run_check)"
[ "$HASHED" = "1" ] || fail "アプリ製の行に row_hash が付いたのに発火しない（見張りが働いていない）"
echo "✅ 2. アプリ製の行に row_hash が付いたら発火する"
q "UPDATE restaurants SET source_row_hash=NULL WHERE google_place_id='P_APP';" >/dev/null

# --- 3. ★ アプリ製の行の画像が catalog の空文字で潰されたら発火する ---
#     2026-08-24 に実際に起きた «表示値 UPDATE がアプリ製の行を掴む» 事故の形。
q "UPDATE restaurants SET image_url='' WHERE google_place_id='P_APP';" >/dev/null
read -r HASHED BLANKED <<<"$(run_check)"
[ "$BLANKED" = "1" ] || fail "アプリ製の行の画像が空になったのに発火しない（上書き事故を見逃す）"
echo "✅ 3. アプリ製の行の画像が潰されたら発火する"

echo
echo "すべて通過（3/3）"
