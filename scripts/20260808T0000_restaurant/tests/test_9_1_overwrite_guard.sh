#!/usr/bin/env bash
# =============================================================================
# #843 「アプリが作った行を同期が上書きしない」ことを実物の PostgreSQL で検証する
# =============================================================================
#
# 2026-08-24 の dev 同期で、アプリが作った 7 行が name / 座標 / image_url /
# image_path / address_components / plus_code をオープンデータ値で上書きされた。
#
# 原因は 9_1 の値 UPDATE が `s.existing_restaurant_id IS NULL` を
# 「上書きしてよい行か」の判定に使っていたこと。この値が入るのは 1_2 が撮った
# スナップショットに載っていた行だけなので、1_2 → 9_1 の間（実測 40 時間）に
# アプリが作った行は「新規行」と誤認される。
#
# このテストは **旧ガードで事故が再現すること** と、**新ガードで再現しないこと**
# の両方を確かめる。片方だけだと「たまたま通っている」のか区別が付かない。
#
# あわせて次も見る:
#   ・pipeline 行はオープンデータの更新に追随する（更新が黙って止まっていない）
#   ・backfill 忘れの検知が、忘れているときだけ発火する
#   ・CHECK 制約が想定外の値を弾く
#   ・migration が冪等（apply-migration.sh は from_file 以降を毎回全部流す）
#
# 使い方:
#   bash scripts/20260808T0000_restaurant/tests/test_9_1_overwrite_guard.sh
#
# PostgreSQL のバイナリ（initdb / pg_ctl）と psql が要る。CI ではなくローカル検証用。
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGD="${PGD:-/tmp/pgdata_843_test}"
PGPORT="${PGPORT:-55433}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MIGRATION="$REPO_ROOT/infra/supabase/migrations/20260827T0000_add_restaurants_created_by_source.sql"

fail() { echo "❌ $*" >&2; exit 1; }
q() { psql -h /tmp -p "$PGPORT" -U postgres -tAq -c "SET search_path=dev; $1"; }

cleanup() {
  su postgres -c "$PGBIN/pg_ctl -D $PGD stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$PGD"
}
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
  google_place_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL, name_language_code TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL, longitude DOUBLE PRECISION NOT NULL,
  image_url TEXT NOT NULL, image_path TEXT, address_components JSONB NOT NULL, plus_code JSONB,
  -- #1881 値 UPDATE をソースから抜き出して流すので、**その SQL が触る列は全部要る**。
  -- 簡略化した写経をやめた時点で、器も本物へ寄せる必要が出た。
  address TEXT, country_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), source_seed_id UUID,
  source_names TEXT[] NOT NULL DEFAULT '{}', source_row_hash TEXT, synced_at TIMESTAMPTZ);
CREATE TABLE restaurant_sync_staging (
  seed_id UUID, existing_restaurant_id UUID, google_place_id TEXT, name TEXT,
  name_language_code TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
  image_url TEXT, image_path TEXT, address_components_json TEXT, plus_code_json TEXT,
  address TEXT, country_code TEXT,
  source_names_json TEXT, row_hash TEXT, match_method TEXT);

-- ① スナップショットに載っていた店 / ② 窓の間にアプリが作った店（事故った形）
INSERT INTO restaurants (id, google_place_id, name, name_language_code, latitude, longitude, image_url, address_components)
VALUES ('11111111-1111-1111-1111-111111111111','PLACE_IN_SNAPSHOT','スナップショットに居た店','ja',35.0,139.0,
        'https://app/in-snapshot.jpg','[{"types":["country"],"shortText":"JP"}]');
INSERT INTO restaurants (id, google_place_id, name, name_language_code, latitude, longitude, image_url, image_path, address_components)
VALUES ('22222222-2222-2222-2222-222222222222','PLACE_MADE_BY_APP','アプリが窓の間に作った店','ja',35.5,139.5,
        'https://app/user-photo.jpg','gs://app/user.jpg','[{"types":["country"],"shortText":"JP"}]');
-- ⚠️ **列名を明示する。** 位置指定の VALUES にしていたため、列を 1 つ足しただけで
--    すべての値がずれ、関係のないテストが «前提が崩れている» で落ちた（2026-09-23 に踏んだ）。
INSERT INTO restaurant_sync_staging
  (seed_id, existing_restaurant_id, google_place_id, name, name_language_code,
   latitude, longitude, image_url, image_path, address_components_json, plus_code_json,
   address, country_code, source_names_json, row_hash, match_method)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','PLACE_IN_SNAPSHOT','オープンデータ名A','ja',35.0,139.0,'',NULL,'[]',NULL,NULL,NULL,'["overture"]','hash-A','box_unique_strict'),
  ('aaaaaaaa-0000-0000-0000-000000000002',NULL,'PLACE_MADE_BY_APP','オープンデータ名B','ja',35.5,139.5,'',NULL,'[]',NULL,NULL,NULL,'["overture"]','hash-B','box_unique_strict'),
  ('aaaaaaaa-0000-0000-0000-000000000003',NULL,'PLACE_BRAND_NEW','オープンデータ名C','ja',36.0,140.0,'',NULL,'[]',NULL,NULL,NULL,'["overture"]','hash-C','box_unique_strict');
SQL

# --- 1. 旧ガードで事故が «再現すること» を確かめる（再現しないならテストが無意味） ---
BROKEN=$(psql -h /tmp -p "$PGPORT" -U postgres -tAq <<'SQL'
SET search_path = dev;
BEGIN;
UPDATE restaurants r SET name = s.name, image_url = s.image_url, image_path = s.image_path
FROM restaurant_sync_staging s
WHERE r.google_place_id = s.google_place_id
  AND s.existing_restaurant_id IS NULL
  AND r.source_row_hash IS DISTINCT FROM s.row_hash;
SELECT name FROM restaurants WHERE google_place_id = 'PLACE_MADE_BY_APP';
ROLLBACK;
SQL
)
[ "$BROKEN" = "オープンデータ名B" ] || fail "旧ガードで事故が再現しない（テストの前提が崩れている）: '$BROKEN'"
echo "✅ 1. 旧ガードで事故を再現した（アプリの行がオープンデータ名で潰れる）"

# --- 2. migration を当てる（＋冪等性） ---
psql -h /tmp -p "$PGPORT" -U postgres -q -c "SET search_path=dev;" -f "$MIGRATION" >/dev/null
ERRS=$(psql -h /tmp -p "$PGPORT" -U postgres -q -c "SET search_path=dev;" -f "$MIGRATION" 2>&1 | grep -ci error || true)
[ "$ERRS" = "0" ] || fail "migration が冪等でない（2回目で $ERRS 件のエラー）"
echo "✅ 2. migration は冪等（2回流してエラー 0）"

# --- 3. 新ガード: INSERT が pipeline を刻み、UPDATE がアプリ行を触らない ---
psql -h /tmp -p "$PGPORT" -U postgres -q <<'SQL'
SET search_path = dev;
INSERT INTO restaurants (id, google_place_id, name, name_language_code, latitude, longitude,
  image_url, image_path, address_components, plus_code, source_seed_id, source_names,
  source_row_hash, synced_at, created_by_source)
SELECT gen_random_uuid(), s.google_place_id, s.name,
  s.name_language_code, s.latitude, s.longitude, s.image_url, s.image_path,
  s.address_components_json::jsonb,
  CASE WHEN s.plus_code_json IS NULL THEN NULL ELSE s.plus_code_json::jsonb END,
  s.seed_id, ARRAY(SELECT jsonb_array_elements_text(s.source_names_json::jsonb)),
  s.row_hash, CURRENT_TIMESTAMP, 'pipeline'
FROM restaurant_sync_staging s
ON CONFLICT (google_place_id) DO NOTHING;

UPDATE restaurants r SET name = s.name, image_url = s.image_url, image_path = s.image_path,
  address_components = s.address_components_json::jsonb
FROM restaurant_sync_staging s
WHERE r.google_place_id = s.google_place_id
  AND r.created_by_source = 'pipeline'
  AND r.source_row_hash IS DISTINCT FROM s.row_hash;
SQL

[ "$(q "SELECT name FROM restaurants WHERE google_place_id='PLACE_MADE_BY_APP';")" = "アプリが窓の間に作った店" ] \
  || fail "アプリが作った行の name が上書きされた"
[ "$(q "SELECT image_url FROM restaurants WHERE google_place_id='PLACE_MADE_BY_APP';")" = "https://app/user-photo.jpg" ] \
  || fail "アプリが作った行の image_url が上書きされた"
[ "$(q "SELECT image_path FROM restaurants WHERE google_place_id='PLACE_MADE_BY_APP';")" = "gs://app/user.jpg" ] \
  || fail "アプリが作った行の image_path が上書きされた"
[ "$(q "SELECT created_by_source FROM restaurants WHERE google_place_id='PLACE_BRAND_NEW';")" = "pipeline" ] \
  || fail "新規行に pipeline が刻まれていない"
echo "✅ 3. 新ガードではアプリの行が丸ごと保たれ、新規行は pipeline になる"

# --- 4. 逆向き: pipeline 行はオープンデータの更新に追随する（黙って止まらない） ---
#
# ⚠️ **値 UPDATE は 9_1 のソースから抜き出す。写経しない。**
#    2026-09-23 まで、ここは `UPDATE ... SET name = s.name ...` と簡略化して写経しており、
#    本番へ «中身が同じ行は書き直さない» 条件を足しても **テストは 1 度も通らないまま緑**だった。
VALUE_UPDATE_SQL="$(python3 "$REPO_ROOT/scripts/20260808T0000_restaurant/tests/extract_value_update_sql.py")"

psql -h /tmp -p "$PGPORT" -U postgres -q <<SQL
SET search_path = dev;
UPDATE restaurant_sync_staging SET name='オープンデータ名C（改名後）', row_hash='hash-C2'
WHERE google_place_id='PLACE_BRAND_NEW';
$VALUE_UPDATE_SQL;
SQL
[ "$(q "SELECT name FROM restaurants WHERE google_place_id='PLACE_BRAND_NEW';")" = "オープンデータ名C（改名後）" ] \
  || fail "pipeline 行がオープンデータの更新に追随していない（更新が黙って止まっている）"
echo "✅ 4. pipeline 行はオープンデータの更新に追随する"

# --- 4-b. #1881 **ハッシュだけが違い、中身が同じ行は書き直さない** ---
#
# dev で «全行のハッシュが変わったが値はほとんど同じ» が起きたとき、62 万行を全部
# 書き直して 6 時間コースになった。ハッシュは «見に行くべきか» の篩であって
# «書くべきか» ではない。ここが 0 行でなければ、その直しは効いていない。
q "UPDATE restaurant_sync_staging SET row_hash='hash-C3' WHERE google_place_id='PLACE_BRAND_NEW';" >/dev/null
# ⚠️ `SET search_path` のコマンド出力が混ざるので **最後の 1 行だけ**を取る
CHANGED="$(psql -h /tmp -p "$PGPORT" -U postgres -t -A -q <<SQL | tail -1
SET search_path = dev;
WITH touched AS (
$VALUE_UPDATE_SQL
  RETURNING 1
)
SELECT count(*) FROM touched;
SQL
)"
[ "$CHANGED" = "0" ] \
  || fail "中身が同じ行を $CHANGED 行書き直した（#1881 の «書く行を減らす» が効いていない）"
echo "✅ 4-b. ハッシュだけが違う行は書き直さない（#1881）"

# --- 5. backfill 忘れの検知は、忘れているときだけ発火する ---
#
# 判定 SQL は 9_1 のソースから抜き出す。**写経しない。**
# 2026-08-29 に、写経した旧判定（source_seed_id の有無だけ）が本物とずれたまま
# 緑になり、dev の同期が 2,115 件で止まった。
DETECT_SQL="$(python3 "$REPO_ROOT/scripts/20260808T0000_restaurant/tests/extract_backfill_detect_sql.py")"

# 同期の実行窓。本番では restaurant_pg_sync_logs から引く（9_1 / 9_9 共通）。
WIN_FROM="2026-08-24 00:00:00+00"
WIN_TO="2026-08-24 23:59:59+00"
detect() {
  # %s を前から順に窓の両端で埋める（psycopg2 が渡すのと同じ形にする）
  local sql
  sql="$(printf '%s' "$DETECT_SQL" \
    | sed "0,/%s/s//'$WIN_FROM'/" \
    | sed "0,/%s/s//'$WIN_TO'/")"
  q "$sql"
}

q "UPDATE restaurants SET created_at='2026-08-24 12:00:00+00' WHERE google_place_id='PLACE_BRAND_NEW';" >/dev/null
[ "$(detect)" = "0" ] || fail "backfill 済みなのに検知が発火した（偽陽性）"

# 5-b. **アプリが作った行は、source_seed_id を持っていても発火させない。**
#      9_1 の provenance UPDATE はアプリ製の行にも seed を刻む。旧判定はこれを
#      backfill 漏れと誤認し、dev の同期を恒久的に止めた（実測 2,115 件）。
q "UPDATE restaurants SET source_seed_id=gen_random_uuid() WHERE google_place_id='PLACE_MADE_BY_APP';" >/dev/null
[ "$(detect)" = "0" ] || fail "アプリ製の行（実行窓の外）を backfill 漏れと誤検知した"

# 5-c. 実行窓の中で作られた行が 'user' のままなら、発火する
q "UPDATE restaurants SET created_by_source='user' WHERE google_place_id='PLACE_BRAND_NEW';" >/dev/null
[ "$(detect)" != "0" ] || fail "backfill 忘れを検知できていない（素通りする検査）"
q "UPDATE restaurants SET created_by_source='pipeline' WHERE google_place_id='PLACE_BRAND_NEW';" >/dev/null

# 5-d. ⚠️ #1881 **アプリが «実行窓の中» で作った行でも発火させない。**
#      5-b は窓の外の行しか見ていなかったため、この形を通していた。実際に dev で
#      9_1 が止まっている（08-29 にユーザーが作った店を、09-01 の同期の provenance
#      UPDATE が設計どおり刻み、この検査が backfill 漏れと誤認した）。
#      見分けは source_row_hash。**パイプラインが中身を書いていない行は NULL のまま。**
q "UPDATE restaurants SET created_at='2026-08-24 12:00:00+00', source_row_hash=NULL
   WHERE google_place_id='PLACE_MADE_BY_APP';" >/dev/null
[ "$(detect)" = "0" ] || fail "アプリ製の行（実行窓の中）を backfill 漏れと誤検知した（#1881）"

# 5-e. 逆向き: パイプラインが INSERT した行（source_row_hash あり）が窓の中で
#      'user' のままなら、**これまでどおり発火する**。5-d で検査を緩めすぎていない。
q "UPDATE restaurants SET created_by_source='user' WHERE google_place_id='PLACE_BRAND_NEW';" >/dev/null
[ "$(detect)" != "0" ] || fail "本物の backfill 忘れを見落とした（検査を緩めすぎ・#1881）"
q "UPDATE restaurants SET created_by_source='pipeline' WHERE google_place_id='PLACE_BRAND_NEW';" >/dev/null

echo "✅ 5. backfill 忘れの検知は、忘れているときだけ発火する（アプリ製の行は窓の内外どちらでも発火しない）"

# --- 6. CHECK 制約が想定外の値を弾く ---
if psql -h /tmp -p "$PGPORT" -U postgres -q -c \
   "SET search_path=dev; UPDATE restaurants SET created_by_source='google';" >/dev/null 2>&1; then
  fail "CHECK 制約が想定外の値を通してしまう"
fi
echo "✅ 6. CHECK 制約が想定外の値を弾く"

echo
echo "すべて通過（6/6）"
