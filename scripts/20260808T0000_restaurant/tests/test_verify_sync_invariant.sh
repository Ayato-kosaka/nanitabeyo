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
  image_url TEXT NOT NULL, image_path TEXT, source_row_hash TEXT,
  address TEXT, country_code TEXT,
  created_by_source TEXT NOT NULL DEFAULT 'user');

-- 正常な «同期後» の姿。アプリ製の行は
--   ・住所と国コードが埋まっている（意図した穴埋め。ここで赤くしてはいけない）
--   ・画像は自分のものを保っている
--   ・row_hash は付いていない
INSERT INTO restaurants (google_place_id, image_url, image_path, source_row_hash, address, country_code, created_by_source) VALUES
  ('P_PIPE',      '',                  NULL,                'h1', '東京都1',       'JP', 'pipeline'),
  -- 正常なアプリ製の行（画像は image_url で持つ）
  ('P_APP',       'https://app/u.jpg', 'gs://app/u.jpg',    NULL, '穴埋めした住所', 'JP', 'user'),
  -- ★ 正常なアプリ製の行（**image_url は空で image_path だけ**）。
  --   image_url は DEPRECATED（20251112T1100）で、いまのアプリはこう書く。
  --   dev 実測 40 件が全てこの形だった。**これを事故と呼んではいけない。**
  ('P_APP_PATH',  '',                  'gs://app/path.jpg', NULL, '穴埋めした住所', 'JP', 'user');
SQL

# 本番の検査 SQL をソースから抜き出す（写経しない）
SQL_TEXT=$(python3 - "$REPO_ROOT" <<'PY'
import re, sys
from pathlib import Path
src = (Path(sys.argv[1]) / "scripts/20260808T0000_restaurant/9_9_verify_sync_result.py").read_text(encoding="utf-8")
hits = re.findall(r'"""\s*(SELECT\s+COUNT\(\*\) FILTER[^"]*?source_row_hash IS NOT NULL[^"]*?)"""', src, re.S)
if len(hits) != 1:
    sys.exit(f"検査SQLを一意に取れませんでした（{len(hits)}件）")
print(hits[0])
PY
)

run_check() { q "$SQL_TEXT;" | tr '|' ' '; }

# --- 1. ★ 正常な «同期後» の姿で発火しない ---
#     意図した穴埋め（住所・国コード）でも、image_path だけの行でも発火しないこと。
#     旧検査はどちらでも赤くなった。
read -r WIPED PATH_ONLY HASHED <<<"$(run_check)"
[ "$WIPED" = "0" ] || fail "正常な状態で発火した（media_wiped=$WIPED）。誤検知が残っている"
[ "$PATH_ONLY" = "1" ] || fail "image_path だけの行を数えられていない（$PATH_ONLY）"
echo "✅ 1. 意図した穴埋めでも image_path だけの行でも発火しない"

# --- 2. ★ image_url が空でも image_path があれば «正常» と扱う ---
#     2026-09-01 にここを «事故» と判定して誤検知した。dev 実測 40 件が全てこの形で、
#     **全件が image_path を持っていた**（＝アプリが正常に作った行）。
echo "✅ 2. image_url が空でも image_path があれば事故ではない（実測 40 件がこの形）"

# --- 3. ★ 画像が丸ごと消えたら発火する ---
#     表示値 UPDATE がアプリ製の行を掴むと catalog の値（url='' / path=NULL）が入る。
#     2026-08-24 に実際に起きた事故の形。
q "UPDATE restaurants SET image_url='', image_path=NULL WHERE google_place_id='P_APP';" >/dev/null
read -r WIPED PATH_ONLY HASHED <<<"$(run_check)"
[ "$WIPED" = "1" ] || fail "画像が丸ごと消えたのに発火しない（上書き事故を見逃す）"
echo "✅ 3. image_url も image_path も無くなったら発火する"

# --- 4. row_hash は数えるだけ（過去の版が付けた足あとで、0 にはできない）---
q "UPDATE restaurants SET source_row_hash='legacy' WHERE google_place_id='P_APP_PATH';" >/dev/null
read -r WIPED PATH_ONLY HASHED <<<"$(run_check)"
[ "$HASHED" = "1" ] || fail "row_hash 付きの行を数えられていない"
echo "✅ 4. row_hash は数えられる（増減を人が見るための情報）"

echo
echo "すべて通過（4/4）"
