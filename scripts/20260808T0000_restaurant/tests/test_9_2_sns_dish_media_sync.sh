#!/usr/bin/env bash
# =============================================================================
# #1273 9_2_sync_sns_dish_media.py の SQL を **実物の PostgreSQL 16** で検証する
# =============================================================================
#
# BigQuery / dev PostgreSQL に一切繋がず、ローカルへ使い捨ての PostgreSQL を立てて
# 「本当にその値で入るのか」「制約に当たらないか」「2 回流して増えないか」を確かめる。
#
# 表の DDL は **実物の migration ファイル**を流す。写経した DDL でテストすると、
# 本番だけが直ったときに緑のまま古い形を守り続ける（CLAUDE.md）。
# SQL 本体も tests/extract_9_2_sql.py が 9_2 のソースから抜き出したものだけを流す。
#
# 見るもの:
#   1. 入る／落ちるの内訳（catalog に居ない店・PG に無い料理カテゴリは «落として続行»）
#   2. 入った行の値が取り込み API と同じ（media_type/thumbnail_path/render_type/status）
#   3. 入った行が usable-dish-media-filter.ts の条件を通る（= アプリから見える）
#   4. 冪等（2 回流しても 1 行も増えない）
#   5. 論理削除した行を復活させない（バッチが moderation を巻き戻さない）
#   6. 既存のユーザー投稿（render_type='stored'）を 1 行も触らない
#   7. UUID 衝突ガードが、衝突しているときだけ発火する
#
# 使い方:
#   bash scripts/20260808T0000_restaurant/tests/test_9_2_sns_dish_media_sync.sh
#
# PostgreSQL のバイナリ（initdb / pg_ctl）と psql が要る。CI ではなくローカル検証用。
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGD="${PGD:-/tmp/pgdata_1273_9_2_test}"
PGPORT="${PGPORT:-55434}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
MIG="$REPO_ROOT/infra/supabase/migrations"
WORK="$(mktemp -d)"

fail() { echo "❌ $*" >&2; exit 1; }
psqlq() { psql -h /tmp -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 "$@"; }
q() { psqlq -tAq -c "SET search_path=dev; $1"; }
expect() { # expect <label> <actual> <wanted>
  [ "$2" = "$3" ] || fail "$1: 期待 $3 / 実際 $2"
  echo "  ✓ $1 = $2"
}

cleanup() {
  su postgres -c "$PGBIN/pg_ctl -D $PGD stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$PGD" "$WORK"
}
trap cleanup EXIT

# --- 使い捨て PostgreSQL -----------------------------------------------------
rm -rf "$PGD"; mkdir -p "$PGD"; chown postgres:postgres "$PGD"
su postgres -c "$PGBIN/initdb -D $PGD -U postgres --auth=trust" >/dev/null
su postgres -c "$PGBIN/pg_ctl -D $PGD -o '-p $PGPORT -k /tmp' -l $PGD/log start" >/dev/null
for _ in $(seq 1 30); do psql -h /tmp -p "$PGPORT" -U postgres -c 'select 1' >/dev/null 2>&1 && break; sleep 0.5; done

# --- 9_2 の SQL をソースから抜き出す ----------------------------------------
mkdir -p "$WORK/sql"
for name in $(python3 "$HERE/extract_9_2_sql.py" --list); do
  { python3 "$HERE/extract_9_2_sql.py" --name "$name"; echo ";"; } > "$WORK/sql/$name.sql"
done

# --- 親テーブル（9_2 が触らないもの）は最小で作る ---------------------------
# 触らない表まで実物の migration を流すと、supabase 固有の role / auth スキーマまで
# 必要になる。9_2 が **書く** 3 表だけを実物の DDL で作る。
psqlq -q <<'SQL'
CREATE SCHEMA IF NOT EXISTS dev;
SET search_path = dev;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deleted_at TIMESTAMPTZ
);
CREATE TABLE restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_place_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL
);
CREATE TABLE dish_categories (
  id TEXT PRIMARY KEY,
  label_en TEXT NOT NULL
);
CREATE TABLE dish_reviews (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), dish_id UUID, user_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
SQL

# --- 9_2 が書く 3 表は **実物の migration** で作る --------------------------
for f in \
  20250802T0301_create_dishes.sql \
  20251012T0900_add_unique_on_dishes_restaurant_category_and_fix_duplicates.sql \
  20250802T0302_create_dish_media.sql \
  20251027T1500_add_video_duration_ms_to_dish_media.sql \
  20251201T0000_add_processing_status_to_dish_media.sql \
  20260823T0000_add_restaurant_recommendation_sync_metadata.sql \
  20260824T0100_add_render_type_to_dish_media.sql \
  20260824T0200_create_dish_media_external_embeddings.sql
do
  psqlq -q -c "SET search_path=dev;" -f "$MIG/$f" >/dev/null \
    || fail "migration が流せませんでした: $f"
done
# 論理削除列だけは 20260826T0100 が CONCURRENTLY を含み単体実行できないので、
# 同ファイルの dish_media 部分と同じ 1 文だけを足す（索引はこのテストに不要）。
q "ALTER TABLE dish_media ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ" >/dev/null
echo "✓ 実物の migration で dishes / dish_media / dish_media_external_embeddings を作成"

# --- 種データ ---------------------------------------------------------------
q "INSERT INTO restaurants (google_place_id, name) VALUES ('placeA','A店'),('placeB','B店')" >/dev/null
q "INSERT INTO dish_categories (id, label_en) VALUES ('Q1','ramen'),('Q2','gyoza')" >/dev/null
USER_ID="$(q "INSERT INTO users DEFAULT VALUES RETURNING id")"
DISH_A1="$(q "INSERT INTO dishes (restaurant_id, category_id, name) SELECT id,'Q1','ユーザーが付けた名前' FROM restaurants WHERE google_place_id='placeA' RETURNING id")"
# 既存のユーザー投稿（render_type='stored'）。9_2 が 1 列も触らないことを後で確かめる
q "INSERT INTO dish_media (dish_id,user_id,media_path,media_type,thumbnail_path,media_processing_status,thumbnail_processing_status)
   VALUES ('$DISH_A1','$USER_ID','gcs/original.jpg','image','gcs/thumb.jpg','completed','completed')" >/dev/null
STORED_BEFORE="$(q "SELECT md5(string_agg(id::text||media_path||thumbnail_path||render_type,'|' ORDER BY id)) FROM dish_media WHERE render_type='stored'")"

# --- staging の中身（本物の ID 生成関数で作る。写経しない）------------------
mkfixture() { # mkfixture <出力ファイル> <post_id:place:category>...
  local out="$1"; shift
  : > "$out"
  for spec in "$@"; do
    IFS=: read -r post place category <<< "$spec"
    local dmid
    dmid="$(cd "$REPO_ROOT/scripts/20260808T0000_restaurant" \
      && python3 -c "from normalization import build_dish_media_id; print(build_dish_media_id('instagram','$post'))")"
    cat >> "$out" <<EOSQL
INSERT INTO sns_dish_media_staging VALUES (
  '$dmid','instagram','$post','https://www.instagram.com/p/$post/',
  '$place','$category',NULL,'hash_$post');
EOSQL
  done
}

# p1: placeA×Q1（既にユーザーの dish がある店 × 料理）
# p2: placeA×Q2（同じ店の別料理 → dish を新規に作る）
# p3: placeB×Q1
# p4: placeZZZ（PG に居ない店）→ 落ちる
# p5: placeA×Q_UNKNOWN（PG に無い料理カテゴリ）→ 落ちる
mkfixture "$WORK/fixture1.sql" \
  p1:placeA:Q1 p2:placeA:Q2 p3:placeB:Q1 p4:placeZZZ:Q1 p5:placeA:Q_UNKNOWN

# --- 実行 1 回目 -------------------------------------------------------------
run_sync() { # run_sync <fixtureファイル> <出力ファイル>
  psqlq -tAq -f - > "$2" <<EOSQL
SET search_path = dev;
BEGIN;
\i $WORK/sql/SQL_CREATE_STAGING.sql
\i $1
\echo PLAN
\i $WORK/sql/SQL_COUNT_PLAN.sql
\echo COLLISION
\i $WORK/sql/SQL_COUNT_UUID_COLLISION.sql
\echo DISHES
\i $WORK/sql/SQL_INSERT_DISHES.sql
\i $WORK/sql/SQL_CREATE_PLAN.sql
\echo APPLY
\i $WORK/sql/SQL_COUNT_APPLY.sql
\i $WORK/sql/SQL_INSERT_DISH_MEDIA.sql
\i $WORK/sql/SQL_INSERT_EMBEDDINGS.sql
\echo USABLE
\i $WORK/sql/SQL_COUNT_USABLE.sql
COMMIT;
EOSQL
}
section() { sed -n "/^$1\$/{n;p;q;}" "$2"; }

echo "--- 1 回目 ---"
run_sync "$WORK/fixture1.sql" "$WORK/out1.txt"
expect "内訳(staged/落ちた店/落ちた分類/入る)" "$(section PLAN "$WORK/out1.txt")" "5|1|1|1|1|3"
expect "UUID 衝突" "$(section COLLISION "$WORK/out1.txt")" "0"
expect "適用計画(insert/既存/別料理据え置き)" "$(section APPLY "$WORK/out1.txt")" "3|0|0"
expect "アプリから使える行" "$(section USABLE "$WORK/out1.txt")" "3"
expect "dish_media(external_embed)" "$(q "SELECT COUNT(*) FROM dish_media WHERE render_type='external_embed'")" "3"
expect "dish_media_external_embeddings" "$(q "SELECT COUNT(*) FROM dish_media_external_embeddings")" "3"

# --- 入った値が取り込み API と同じか ----------------------------------------
echo "--- 値の検査 ---"
expect "media_path は NULL"        "$(q "SELECT COUNT(*) FROM dish_media WHERE render_type='external_embed' AND media_path IS NULL")" "3"
expect "media_type='image'"        "$(q "SELECT COUNT(*) FROM dish_media WHERE render_type='external_embed' AND media_type='image'")" "3"
expect "thumbnail_path='' (空文字)" "$(q "SELECT COUNT(*) FROM dish_media WHERE render_type='external_embed' AND thumbnail_path=''")" "3"
expect "media_processing_status='completed'" "$(q "SELECT COUNT(*) FROM dish_media WHERE render_type='external_embed' AND media_processing_status='completed' AND thumbnail_processing_status='completed'")" "3"
expect "user_id は NULL"           "$(q "SELECT COUNT(*) FROM dish_media WHERE render_type='external_embed' AND user_id IS NULL")" "3"
expect "embed_status='unknown'"    "$(q "SELECT COUNT(*) FROM dish_media_external_embeddings WHERE embed_status='unknown' AND last_verified_at IS NULL")" "3"
expect "playback_status='unknown'" "$(q "SELECT COUNT(*) FROM dish_media_external_embeddings WHERE playback_status='unknown' AND playback_reason IS NULL")" "3"
expect "dmee.dish_id は dish_media と一致" "$(q "SELECT COUNT(*) FROM dish_media_external_embeddings e JOIN dish_media m ON m.id=e.dish_media_id WHERE m.dish_id<>e.dish_id")" "0"
expect "新規 dish は name=NULL"    "$(q "SELECT COUNT(*) FROM dishes WHERE data_origin='restaurant_recommendation' AND name IS NULL")" "2"
expect "既存 dish の名前を触らない" "$(q "SELECT name FROM dishes WHERE id='$DISH_A1'")" "ユーザーが付けた名前"
expect "既存 dish の data_origin"  "$(q "SELECT data_origin FROM dishes WHERE id='$DISH_A1'")" "user_or_google"
expect "ユーザー投稿(stored)は無傷" "$(q "SELECT md5(string_agg(id::text||media_path||thumbnail_path||render_type,'|' ORDER BY id)) FROM dish_media WHERE render_type='stored'")" "$STORED_BEFORE"

# --- 実行 2 回目（冪等）------------------------------------------------------
echo "--- 2 回目（冪等）---"
run_sync "$WORK/fixture1.sql" "$WORK/out2.txt"
expect "適用計画(insert/既存/別料理据え置き)" "$(section APPLY "$WORK/out2.txt")" "0|3|0"
expect "dish_media は増えない"      "$(q "SELECT COUNT(*) FROM dish_media WHERE render_type='external_embed'")" "3"
expect "embeddings は増えない"      "$(q "SELECT COUNT(*) FROM dish_media_external_embeddings")" "3"
expect "dishes は増えない"          "$(q "SELECT COUNT(*) FROM dishes")" "3"

# --- 論理削除した行を復活させない --------------------------------------------
echo "--- 論理削除（通報対応）を巻き戻さない ---"
q "UPDATE dish_media SET deleted_at=now() WHERE id=(SELECT dish_media_id FROM dish_media_external_embeddings WHERE external_content_id='p1')" >/dev/null
run_sync "$WORK/fixture1.sql" "$WORK/out3.txt"
expect "削除済みのまま"             "$(q "SELECT COUNT(*) FROM dish_media WHERE deleted_at IS NOT NULL")" "1"
expect "使える行が 1 減る"          "$(section USABLE "$WORK/out3.txt")" "2"

# --- 同じ投稿が別の料理へ来たときは動かさない -------------------------------
echo "--- 同じ投稿の分類が変わっても既存の紐づけを動かさない ---"
mkfixture "$WORK/fixture2.sql" p3:placeB:Q2
run_sync "$WORK/fixture2.sql" "$WORK/out4.txt"
expect "別料理据え置き"             "$(section APPLY "$WORK/out4.txt")" "0|0|1"
expect "dish_media は増えない"      "$(q "SELECT COUNT(*) FROM dish_media WHERE render_type='external_embed'")" "3"
expect "p3 は元の料理のまま"        "$(q "SELECT c.category_id FROM dish_media_external_embeddings e JOIN dishes c ON c.id=e.dish_id WHERE e.external_content_id='p3'")" "Q1"

# --- UUID 衝突ガード ---------------------------------------------------------
echo "--- UUID 衝突ガード ---"
COLLIDE_ID="$(cd "$REPO_ROOT/scripts/20260808T0000_restaurant" \
  && python3 -c "from normalization import build_dish_media_id; print(build_dish_media_id('instagram','p9'))")"
q "INSERT INTO dish_media (id,dish_id,user_id,media_path,media_type,thumbnail_path,media_processing_status,thumbnail_processing_status)
   VALUES ('$COLLIDE_ID','$DISH_A1','$USER_ID','gcs/u.jpg','image','gcs/ut.jpg','completed','completed')" >/dev/null
mkfixture "$WORK/fixture3.sql" p9:placeA:Q1
COLLISION="$(psqlq -tAq -f - <<EOSQL
SET search_path = dev;
BEGIN;
\i $WORK/sql/SQL_CREATE_STAGING.sql
\i $WORK/fixture3.sql
\i $WORK/sql/SQL_COUNT_UUID_COLLISION.sql
ROLLBACK;
EOSQL
)"
expect "ユーザー投稿との衝突を検出" "$COLLISION" "1"

echo
echo "✅ 9_2 の SQL は実物の PostgreSQL 16 と実物の migration で全項目を通りました"
