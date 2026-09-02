#!/usr/bin/env bash
# =============================================================================
# #1681 restaurant_links の «消す» が、消してはいけないものを消さないことを検証する
# =============================================================================
#
# 9_1 は出所側で値が変わったとき、古い open_data のリンクを消してから入れ直す。
# 消す処理を入れた以上、**消してはいけないものが消えないこと**を実物の
# PostgreSQL で押さえる。ここが壊れると «元あったデータが欠ける» に直結する。
#
# SQL は 9_1 のソースから抜き出す（写経しない）。
#
#   bash scripts/20260808T0000_restaurant/tests/test_9_1_restaurant_links.sh
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGD="${PGD:-/tmp/pgdata_1681_links}"
PGPORT="${PGPORT:-55435}"
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
  source_row_hash TEXT);
CREATE TABLE restaurant_links (
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, value TEXT NOT NULL, source TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, kind, value));
-- #1706 ⚠️ 作業表は本物と同じ列を持たせる。**pg_id / pg_row_hash を省かない。**
-- これは «同期が書き込む前» のスナップショットで、リンクの SQL はこちらを見る。
-- 2026-09-02 の本番投入では、この 2 列をテストの作業表が持っていなかったため、
-- 「新規行に 1 本もリンクが入らない」欠陥を 6/6 緑のまま通してしまった。
CREATE TABLE restaurant_sync_work (
  google_place_id TEXT, phone TEXT, website TEXT, social_urls_json TEXT, row_hash TEXT,
  pg_id UUID, pg_row_hash TEXT);

INSERT INTO restaurants (google_place_id, source_row_hash) VALUES
  ('PLACE_IN_STAGING', 'hash-OLD'),      -- hash が動く = リンクを見直す
  ('PLACE_NOT_IN_STAGING', 'hash-X'),
  ('PLACE_UNCHANGED', 'hash-SAME'),      -- hash が同じ = 触らない
  -- 「新規 INSERT」が直前に入れたばかりの行。**その INSERT が
  -- source_row_hash = s.row_hash を既に書いている**ので、restaurants 側を
  -- 見比べると «一致» になる。作業表側は pg_id / pg_row_hash が NULL。
  ('PLACE_NEW', 'hash-NEW-ROW');

-- 今回の catalog: 電話が新しい番号へ変わり、Instagram は据え置き
INSERT INTO restaurant_sync_work
  (google_place_id, phone, website, social_urls_json, row_hash, pg_id, pg_row_hash) VALUES
  ('PLACE_IN_STAGING', '03-1111-1111', 'https://new.example.com',
   '["https://instagram.com/keep"]', 'hash-NEW',
   (SELECT id FROM restaurants WHERE google_place_id='PLACE_IN_STAGING'), 'hash-OLD'),
  -- hash が変わっていない店。catalog には電話があるが、**触ってはいけない**
  ('PLACE_UNCHANGED', '03-7777-7777', NULL, '[]', 'hash-SAME',
   (SELECT id FROM restaurants WHERE google_place_id='PLACE_UNCHANGED'), 'hash-SAME'),
  -- 新規行。作業表を作った時点では PG に居なかったので pg_* は NULL
  ('PLACE_NEW', '03-2222-2222', 'https://new-shop.example.com',
   '["https://instagram.com/newshop"]', 'hash-NEW-ROW', NULL, NULL);
SQL

RID_IN=$(q "SELECT id FROM restaurants WHERE google_place_id='PLACE_IN_STAGING';")
RID_OUT=$(q "SELECT id FROM restaurants WHERE google_place_id='PLACE_NOT_IN_STAGING';")
RID_UNCHANGED=$(q "SELECT id FROM restaurants WHERE google_place_id='PLACE_UNCHANGED';")

run_sql "
INSERT INTO restaurant_links (restaurant_id, kind, value, source) VALUES
  ('$RID_IN','phone','03-9999-9999','open_data'),          -- 古い電話（消えるべき）
  ('$RID_IN','instagram','https://instagram.com/keep','open_data'), -- 今も在る（残る）
  ('$RID_IN','website','https://user-added.example.com','user'),    -- ユーザー追加（残る）
  ('$RID_IN','phone','03-0000-0000','owner'),              -- オーナー追加（残る）
  ('$RID_OUT','phone','03-8888-8888','open_data'),         -- staging に居ない店（残る）
  ('$RID_UNCHANGED','phone','03-6666-6666','open_data');   -- hash 同じ（触らない）
"

DELETE_SQL="$(python3 "$TESTS_DIR/extract_links_sql.py" --which delete)"
INSERT_SQL="$(python3 "$TESTS_DIR/extract_links_sql.py" --which insert)"

apply_once() { run_sql "$DELETE_SQL"; run_sql "$INSERT_SQL"; }
apply_once

# --- 1. 出所で消えた古い open_data の値は消える ---
[ "$(q "SELECT COUNT(*) FROM restaurant_links WHERE restaurant_id='$RID_IN' AND value='03-9999-9999';")" = "0" ] \
  || fail "出所から消えた古い open_data の電話が残っている"
echo "✅ 1. 出所で変わった古い open_data のリンクは消える"

# --- 2. ★ ユーザー / オーナーが足したリンクは消えない ---
[ "$(q "SELECT COUNT(*) FROM restaurant_links WHERE restaurant_id='$RID_IN' AND source='user';")" = "1" ] \
  || fail "ユーザーが足したリンクを消した"
[ "$(q "SELECT COUNT(*) FROM restaurant_links WHERE restaurant_id='$RID_IN' AND source='owner';")" = "1" ] \
  || fail "オーナーが足したリンクを消した"
echo "✅ 2. ユーザー / オーナーのリンクは、catalog に無くても消えない"

# --- 3. staging に居ない店のリンクは触らない ---
[ "$(q "SELECT COUNT(*) FROM restaurant_links WHERE restaurant_id='$RID_OUT';")" = "1" ] \
  || fail "今回の catalog に居ない店のリンクを消した"
echo "✅ 3. 今回の catalog に載らなかった店のリンクは触らない"

# --- 4. 新しい値が入り、据え置きの値も残る ---
[ "$(q "SELECT COUNT(*) FROM restaurant_links WHERE restaurant_id='$RID_IN' AND kind='phone' AND value='03-1111-1111' AND source='open_data';")" = "1" ] \
  || fail "新しい電話が入っていない"
[ "$(q "SELECT COUNT(*) FROM restaurant_links WHERE restaurant_id='$RID_IN' AND kind='instagram' AND value='https://instagram.com/keep';")" = "1" ] \
  || fail "据え置きの Instagram が消えた"
[ "$(q "SELECT COUNT(*) FROM restaurant_links WHERE restaurant_id='$RID_IN' AND kind='website' AND value='https://new.example.com' AND source='open_data';")" = "1" ] \
  || fail "新しい website が入っていない"
echo "✅ 4. 新しい値が入り、据え置きの値はそのまま残る"

# --- 5. 冪等（2 回流しても件数が変わらない） ---
BEFORE=$(q "SELECT COUNT(*) FROM restaurant_links;")
apply_once
[ "$(q "SELECT COUNT(*) FROM restaurant_links;")" = "$BEFORE" ] \
  || fail "2 回目で件数が変わった（冪等でない）"
echo "✅ 5. 冪等（2 回流しても $BEFORE 件のまま）"

# --- 6. ★ row_hash が変わっていない店のリンクは調べ直さない ---
#      catalog には別の電話があるが、hash が同じなら触らない（62万店の再走査を避ける）
[ "$(q "SELECT COUNT(*) FROM restaurant_links WHERE restaurant_id='$RID_UNCHANGED' AND value='03-6666-6666';")" = "1" ] \
  || fail "hash が同じ店の既存リンクを消した"
[ "$(q "SELECT COUNT(*) FROM restaurant_links WHERE restaurant_id='$RID_UNCHANGED' AND value='03-7777-7777';")" = "0" ] \
  || fail "hash が同じ店へリンクを入れた（走査を絞れていない）"
echo "✅ 6. row_hash が同じ店は調べ直さない"

# --- 7. ★ 直前に INSERT された新規行にも、リンクが入る ---
#
#     2026-09-02 の本番投入で **新規 547,941 店の電話・サイト・SNS が 0 件**に
#     なった。リンクの SQL が `r.source_row_hash` を見ていたためである。
#     この文より前に走る «新規 INSERT» が `source_row_hash = s.row_hash` を
#     書いているので、新規行は必ず «一致» と判定されて弾かれていた。
#     （アプリ製の行は source_row_hash が NULL のまま入るので、そちらだけ
#     リンクが付き、全体では «入っている» ように見えて気付けなかった。）
#
#     正しい比較相手は、作業表が持つ «書く前» の pg_row_hash である。
RID_NEW=$(q "SELECT id FROM restaurants WHERE google_place_id='PLACE_NEW';")
[ "$(q "SELECT COUNT(*) FROM restaurant_links WHERE restaurant_id='$RID_NEW' AND kind='phone' AND value='03-2222-2222';")" = "1" ] \
  || fail "新規行に電話が入っていない（r.source_row_hash を見ていないか確認）"
[ "$(q "SELECT COUNT(*) FROM restaurant_links WHERE restaurant_id='$RID_NEW' AND kind='website' AND value='https://new-shop.example.com';")" = "1" ] \
  || fail "新規行に website が入っていない"
[ "$(q "SELECT COUNT(*) FROM restaurant_links WHERE restaurant_id='$RID_NEW' AND kind='instagram';")" = "1" ] \
  || fail "新規行に SNS が入っていない"
echo "✅ 7. 直前に INSERT された新規行にもリンクが入る"

echo
echo "すべて通過（7/7）"
