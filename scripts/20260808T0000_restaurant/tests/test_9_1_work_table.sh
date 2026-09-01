#!/usr/bin/env bash
# =============================================================================
# #1706 作業表が «やることがある行» を 1 行も落とさず、余分も拾わないことを検証する
# =============================================================================
#
# 2026-08-31 に、この同期が **本番と共有の DB** を圧迫して障害を起こした。
# 原因は書く量ではなく **探す量**で、DML 10 文がそれぞれ 62 万行 × 62 万行を
# 突き合わせていた。0 行しか書かない文が 1 文あたり数百秒かかっていた。
#
# 対策として «全部を 1 回見て、やることがある行だけを取り出す» 形に変えた。
# **この作業表が 1 行でも取りこぼすと、その店は静かに同期されなくなる。**
# 落ちない・壊れない・気付けない類の事故なので、機械で固定する。
#
#   bash scripts/20260808T0000_restaurant/tests/test_9_1_work_table.sh
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGD="${PGD:-/tmp/pgdata_1706_work}"
PGPORT="${PGPORT:-55443}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TESTS_DIR="$REPO_ROOT/scripts/20260808T0000_restaurant/tests"

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
  name TEXT NOT NULL, address TEXT,
  source_seed_id UUID UNIQUE, source_row_hash TEXT, synced_at TIMESTAMPTZ,
  created_by_source TEXT NOT NULL DEFAULT 'user');
CREATE TABLE restaurant_sync_staging (
  seed_id UUID NOT NULL, google_place_id TEXT NOT NULL, match_method TEXT NOT NULL,
  address TEXT, row_hash TEXT NOT NULL);

-- ① 何も変わっていない → 作業表に **入らない**。62 万行の大多数がこれで、
--                        ここを外すと «全行を毎回触る» 元の形に戻る
-- ② 出所側が変わった   → 入る
-- ③ seed が付け替わった → 入る
-- ④ PG に無い（新規）   → 入る
-- ⑤〜⑦ アプリ製の行     → **常に入る**。9_1 はアプリ製の行にも provenance
--   （source_seed_id）を刻むが、source_row_hash は意図的に NULL のままにする
--   ため、hash の比較が毎回真になる。dev 実測で 2,472 行なので支障はない。
--   «触ってよいか» の判定は各文が持つ（住所の穴埋めは test_9_1_address_fill.sh）。
--   作業表の役目は «明らかにやることが無い行を落とすこと» である
INSERT INTO restaurants (google_place_id, name, address, source_seed_id, source_row_hash, created_by_source) VALUES
  ('P_SAME',      '同じ',   '東京都1', '11111111-1111-1111-1111-111111111111','h1','pipeline'),
  ('P_CHANGED',   '変わった','東京都2', '22222222-2222-2222-2222-222222222222','h2-OLD','pipeline'),
  ('P_RESEEDED',  'seed',   '東京都3', '33333333-3333-3333-3333-333333333333','h3','pipeline'),
  ('P_APP_EMPTY', 'アプリ空', NULL,     NULL, NULL, 'user'),
  ('P_APP_FILLED','アプリ有','ユーザー住所', NULL, NULL, 'user'),
  ('P_APP_BLANK', 'アプリ空2', NULL,    NULL, NULL, 'user');

INSERT INTO restaurant_sync_staging VALUES
  ('11111111-1111-1111-1111-111111111111','P_SAME','box','東京都1','h1'),
  ('22222222-2222-2222-2222-222222222222','P_CHANGED','box','東京都2','h2-NEW'),
  ('99999999-9999-9999-9999-999999999999','P_RESEEDED','box','東京都3','h3'),
  ('44444444-4444-4444-4444-444444444444','P_BRAND_NEW','box','東京都4','h4'),
  ('55555555-5555-5555-5555-555555555555','P_APP_EMPTY','box','オープンデータ住所','h5'),
  ('66666666-6666-6666-6666-666666666666','P_APP_FILLED','box','オープンデータ住所','h6'),
  ('77777777-7777-7777-7777-777777777777','P_APP_BLANK','box','   ','h7');
SQL

# TEMP 表は psql のセッションが終わると消える。検査は複数回に分けて引くので、
# **TEMP と ON COMMIT DROP だけを外して**通常の表として作る。
# 中身の条件（＝取りこぼしの有無）はソースのまま検査する。
strip_temp() { sed -e 's/CREATE TEMP TABLE/CREATE TABLE/'; }
# 本番は «全体»（*_all）を作ってから回ごとの部分集合へ写す。ここでは 1 回で
# 全部を処理する形（chunks=1）と同じになるよう、そのまま別名へ写す。
alias_all() { psql -h /tmp -p "$PGPORT" -U postgres -q -v ON_ERROR_STOP=1 \
  -c "SET search_path=dev; DROP TABLE IF EXISTS restaurant_sync_$1; CREATE TABLE restaurant_sync_$1 AS SELECT * FROM restaurant_sync_${1}_all;" >/dev/null; }

WORK="$(python3 "$TESTS_DIR/extract_work_table_sql.py" --which work | strip_temp)"
psql -h /tmp -p "$PGPORT" -U postgres -q -v ON_ERROR_STOP=1 -c "SET search_path=dev; $WORK" >/dev/null
alias_all work

GOT=$(q "SELECT string_agg(google_place_id, ',' ORDER BY google_place_id) FROM restaurant_sync_work;")
WANT="P_APP_BLANK,P_APP_EMPTY,P_APP_FILLED,P_BRAND_NEW,P_CHANGED,P_RESEEDED"

# --- 1. ★ やることがある行を 1 行も落とさない ---
for gid in P_CHANGED P_RESEEDED P_BRAND_NEW P_APP_EMPTY; do
  case ",$GOT," in *",$gid,"*) ;; *) fail "$gid が作業表から漏れた（この店は静かに同期されなくなる）";; esac
done
echo "✅ 1. 変更・seed付替・新規・住所の穴、いずれも取りこぼさない"

# --- 2. ★ 変わっていない行は入れない（これが負荷対策の本体）---
case ",$GOT," in *",P_SAME,"*) fail "変わっていない行が作業表に入った（62 万行を毎回触ることになる）";; esac
echo "✅ 2. 変わっていない行は入らない"

# --- 3. アプリ製の行は常に入る（provenance を刻むため。件数は小さい）---
for gid in P_APP_EMPTY P_APP_FILLED P_APP_BLANK; do
  case ",$GOT," in *",$gid,"*) ;; *) fail "$gid が漏れた（provenance が刻まれなくなる）";; esac
done
echo "✅ 3. アプリ製の行は provenance のために入る（dev 実測 2,472 行）"

[ "$GOT" = "$WANT" ] || fail "作業表の中身が想定と違う: got=$GOT want=$WANT"
echo "✅ 4. 対象はちょうど 6 行（7 行中 1 行が素通り）"

# --- 5. ★ 素通りした行に «やり残し» が無いことを、条件の裏返しで確かめる ---
#   作業表に入らなかった行が本当に «何もすることが無い» のかを、
#   同じ条件の否定で数える。0 でなければ取りこぼしがある。
LEFTOVER=$(q "
  SELECT COUNT(*) FROM restaurant_sync_staging s
  JOIN restaurants r ON r.google_place_id = s.google_place_id
  LEFT JOIN restaurant_sync_work w ON w.google_place_id = s.google_place_id
  WHERE w.google_place_id IS NULL
    AND ( r.source_seed_id IS DISTINCT FROM s.seed_id
       OR r.source_row_hash IS DISTINCT FROM s.row_hash
       OR (r.created_by_source <> 'pipeline' AND r.address IS NULL
           AND NULLIF(btrim(s.address), '') IS NOT NULL) );")
[ "$LEFTOVER" = "0" ] || fail "作業表から漏れたのにやることが残っている行が $LEFTOVER 件ある"
echo "✅ 5. 素通りした行にやり残しは無い"

# --- 6. ★ 新規行は pg_id が NULL（INSERT の判定に使う）---
[ "$(q "SELECT COUNT(*) FROM restaurant_sync_work WHERE pg_id IS NULL;")" = "1" ] \
  || fail "新規行の pg_id が NULL になっていない（INSERT の判定が壊れる）"
echo "✅ 6. 新規行だけ pg_id が NULL"

# --- 7. 付替の抽出（seed は同じで place_id が変わった行）---
MOVED="$(python3 "$TESTS_DIR/extract_work_table_sql.py" --which moved | strip_temp)"
q "UPDATE restaurant_sync_staging SET google_place_id='P_MOVED_NEW' WHERE seed_id='11111111-1111-1111-1111-111111111111';" >/dev/null
psql -h /tmp -p "$PGPORT" -U postgres -q -v ON_ERROR_STOP=1 -c "SET search_path=dev; $MOVED" >/dev/null
alias_all moved
[ "$(q "SELECT string_agg(pg_google_place_id, ',') FROM restaurant_sync_moved;")" = "P_SAME" ] \
  || fail "place_id が変わった行を拾えていない"
echo "✅ 7. seed が同じで place_id が変わった行だけを拾う"


# --- 8. ★ 人手 override で直した行の provenance を消さない（順序の契約）---
#
# 作業表にする前、«provenance 解除» は `r.google_place_id <> s.google_place_id`
# で引いていた。«付替» が先に走って place_id を合わせるので、直した行は条件から
# **自然に外れて**いた。作業表は «実行前» の状態で作るので、その自然に外れるが
# 効かない。条件を書き忘れると、直した直後の行の provenance を消してしまう。
#
# 落ちない・壊れない・気付けない類なので、実物の PostgreSQL で固定する。
psql -h /tmp -p "$PGPORT" -U postgres -q -v ON_ERROR_STOP=1 <<'SQL'
SET search_path = dev;
TRUNCATE restaurants, restaurant_sync_staging, restaurant_sync_work, restaurant_sync_moved, restaurant_sync_work_all, restaurant_sync_moved_all;
-- seed は同じだが place_id が変わった行を 1 つ作り、人手 override を宣言する
INSERT INTO restaurants (google_place_id, name, source_seed_id, source_row_hash, created_by_source)
VALUES ('P_OLD_ID','付替対象','88888888-8888-8888-8888-888888888888','h8','pipeline');
INSERT INTO restaurant_sync_staging VALUES
  ('88888888-8888-8888-8888-888888888888','P_NEW_ID','manual_override','東京都8','h8');
SQL
psql -h /tmp -p "$PGPORT" -U postgres -q -v ON_ERROR_STOP=1 \
  -c "SET search_path=dev; DROP TABLE IF EXISTS restaurant_sync_moved_all; $MOVED" >/dev/null
alias_all moved

OVERRIDE_FIX="$(python3 "$TESTS_DIR/extract_work_table_sql.py" --which override_fix)"
UNLINK="$(python3 "$TESTS_DIR/extract_work_table_sql.py" --which unlink)"

# 本番と同じ順序で流す: 付替 → provenance 解除
q "$OVERRIDE_FIX;" >/dev/null
q "$UNLINK;" >/dev/null

[ "$(q "SELECT google_place_id FROM restaurants;")" = "P_NEW_ID" ] \
  || fail "人手 override の付替が効いていない"
[ -n "$(q "SELECT source_seed_id FROM restaurants;")" ] \
  || fail "人手 override で直した行の provenance を消した（次の同期で不整合になる）"
echo "✅ 8. 人手 override で直した行の provenance は消さない"

echo
echo "すべて通過（8/8）"
