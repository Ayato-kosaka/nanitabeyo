#!/usr/bin/env bash
# =============================================================================
# #1815 «日本の店ではない» の判定と、9_9_audit_foreign_rows.py の SQL を
# **実物の PostgreSQL 16** で検証する
# =============================================================================
#
# 見るもの:
#   1. PostgreSQL の正規表現方言（ARE）でも判定が BigQuery と同じ答えを出すこと
#      （`(?i)` の位置・ハングル/キリルの実体文字クラスは方言差で静かに壊れる）
#   2. **日本国内の韓国料理店を海外と判定しないこと**（新大久保・大阪・福岡の実データ）
#   3. 監査 SQL が実物のスキーマで流れること
#   4. 修復案 A（削除）が «ユーザーの痕跡がある店» を 1 行も消さないこと
#
# SQL はすべて 9_9_audit_foreign_rows.py のソースから抜き出す（写経しない）。
# 種データは restaurant_catalog から実際に採った行である。
#
# 使い方:
#   bash scripts/20260808T0000_restaurant/tests/test_9_9_foreign_rows.sh
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGD="${PGD:-/tmp/pgdata_1815_foreign_test}"
PGPORT="${PGPORT:-55436}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"

fail() { echo "❌ $*" >&2; exit 1; }
psqlq() { psql -h /tmp -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 "$@"; }
q() { psqlq -tAq -c "SET search_path=dev; $1"; }
expect() { [ "$2" = "$3" ] || fail "$1: 期待 $3 / 実際 $2"; echo "  ✓ $1 = $2"; }

cleanup() {
  su postgres -c "$PGBIN/pg_ctl -D $PGD stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$PGD" "$WORK"
}
trap cleanup EXIT

rm -rf "$PGD"; mkdir -p "$PGD"; chown postgres:postgres "$PGD"
su postgres -c "$PGBIN/initdb -D $PGD -U postgres --auth=trust" >/dev/null
su postgres -c "$PGBIN/pg_ctl -D $PGD -o '-p $PGPORT -k /tmp' -l $PGD/log start" >/dev/null
for _ in $(seq 1 30); do psql -h /tmp -p "$PGPORT" -U postgres -c 'select 1' >/dev/null 2>&1 && break; sleep 0.5; done

# --- 監査が読む表を作る -------------------------------------------------------
# 実物の migration を全部流すには supabase の role / auth スキーマが要るので、
# **監査 SQL が触る列だけ**を作る。列名・型は api/prisma/schema.prisma と同じにする。
psqlq -q <<'SQL'
CREATE SCHEMA IF NOT EXISTS dev;
SET search_path = dev;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_place_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  country_code TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  created_by_source TEXT NOT NULL DEFAULT 'user'
);
CREATE TABLE dishes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  category_id TEXT NOT NULL
);
CREATE TABLE dish_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_id UUID NOT NULL REFERENCES dishes(id),
  render_type TEXT NOT NULL DEFAULT 'stored',
  UNIQUE (id, dish_id)
);
CREATE TABLE dish_media_external_embeddings (
  dish_media_id UUID PRIMARY KEY,
  dish_id UUID NOT NULL,
  FOREIGN KEY (dish_media_id, dish_id) REFERENCES dish_media(id, dish_id)
);
CREATE TABLE dish_media_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_media_id UUID NOT NULL REFERENCES dish_media(id)
);
CREATE TABLE dish_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_id UUID NOT NULL REFERENCES dishes(id)
);
CREATE TABLE restaurant_bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id)
);
CREATE TABLE payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_media_id UUID NOT NULL REFERENCES dish_media(id)
);
SQL

# --- 種データ: restaurant_catalog から実際に採った行 --------------------------
# 「海外」= 韓国 / ロシア。「日本」= 新大久保・大阪・福岡の韓国料理店と、
# キリル文字を装飾に使う日本の店（修正前の判定はこの 11 店を海外と誤判定していた）。
psqlq -q <<'SQL'
SET search_path = dev;
INSERT INTO restaurants
  (google_place_id, name, address, country_code, latitude, longitude, created_by_source)
VALUES
  -- 韓国（ハングル）
  ('kr1','돈까스하우스','252-1 Yangsang-dong','JP',37.342,126.852,'pipeline'),
  -- 韓国（ローマ字だけ。文字の根拠は効かず、住所の形と矩形で拾う）
  ('kr2','Cafe Place','20 Yonsei-ro','JP',37.558,126.937,'pipeline'),
  ('kr3','Starbucks','Yongsan Dong 2 Ga N Seoul Tower','JP',37.551,126.988,'pipeline'),
  -- 韓国（ソウルの日本料理店。店名に «の» が入るので «文字» の根拠は無効になるが矩形で拾う）
  ('kr4','우동선-うどん膳','경기도 이천시 중리동 194-9','JP',37.280,127.444,'pipeline'),
  -- 鬱陵島（韓国。日本の矩形の «外» ではないので座標だけでは分からない）
  ('kr5','우리식당','152 Ulleungsunhwan-ro, Ulleung-eup','JP',37.497,130.910,'pipeline'),
  -- ロシア沿海地方
  ('ru1','Культура Пивная','улица Суханова 6','JP',43.118,131.891,'pipeline'),
  -- ここから下は **日本の店**。1 行も海外と判定してはいけない
  ('jp1','하남돼지집-ハナムデジジップ新大久保イケメン通り店','東京都','JP',35.699,139.703,'pipeline'),
  ('jp2','정낙지-ジョンナッチ/ナッコプセ/大阪/堀江/韓国料理','西区北堀江1-13-21','JP',34.673,135.494,'pipeline'),
  ('jp3','포장마차거리','Nakasu, 1 Chome−8−8 仲柳ビル','JP',33.590,130.409,'pipeline'),
  ('jp4','ＢＡＲ　ＢＯＯＴ　ＣＡМＰ','熊本県八代市本町一丁目７－１２','JP',32.506,130.604,'pipeline'),
  ('jp5','吉野家寒川一之宮店','2-Сhōme-12-15 Ichinomiya','JP',35.368,139.384,'pipeline'),
  ('jp6','Cafe Cheonghak-dong','2 Chome-11-20 Ueno','JP',35.709,139.771,'pipeline'),
  ('jp7','Café DIOR Kansai Airport','Sennan-gun, Tajiri-cho, 1 Senshukukonaka','JP',34.434,135.244,'pipeline'),
  ('jp8','居酒屋　対馬屋','長崎県対馬市厳原町大手橋1068番地','JP',34.203,129.291,'pipeline'),
  ('jp9','さこん','長崎県佐世保市上京町6-11','JP',33.170,129.722,'pipeline'),
  -- ユーザーが旅行先で登録した海外店。海外だが «修復対象» にはしない
  ('user_kr','ソウルのカフェ','서울 강남구 테헤란로 1','KR',37.500,127.036,'user');
SQL

# --- 1. 判定（PostgreSQL 方言）------------------------------------------------
# 判定は common_sns から取り出す（写経しない）
FOREIGN_SQL="$(SCRIPT_DIR="$HERE/.." python3 -c '
import os, sys
sys.path.insert(0, os.environ["SCRIPT_DIR"])
from common_sns import foreign_restaurant_sql
print(foreign_restaurant_sql(name="r.name", address="r.address",
                             country_code="r.country_code",
                             latitude="r.latitude", longitude="r.longitude",
                             dialect="postgres"))')"

MISCLASSIFIED_JP="$(q "SELECT COALESCE(string_agg(r.google_place_id, ','), '')
  FROM restaurants r WHERE r.google_place_id LIKE 'jp%' AND $FOREIGN_SQL")"
expect "日本の店を海外と誤判定した数" "$MISCLASSIFIED_JP" ""

MISSED_FOREIGN="$(q "SELECT COALESCE(string_agg(r.google_place_id, ','), '')
  FROM restaurants r
  WHERE (r.google_place_id LIKE 'kr%' OR r.google_place_id LIKE 'ru%')
    AND NOT $FOREIGN_SQL")"
expect "海外の店を見落とした数" "$MISSED_FOREIGN" ""

# --- 2. 監査 SQL が実物のスキーマで流れる -------------------------------------
python3 "$HERE/extract_9_9_foreign_sql.py" --name SQL_COUNTS > "$WORK/counts.sql"
FOREIGN_RESTAURANTS="$(psqlq -tAq -c "SET search_path=dev;" -f "$WORK/counts.sql" | head -1 | cut -d'|' -f2)"
expect "監査が数えた海外の店（ユーザー登録の 1 店を含む）" "$FOREIGN_RESTAURANTS" "7"

python3 "$HERE/extract_9_9_foreign_sql.py" --name SQL_USER_TRACES > "$WORK/traces.sql"
psqlq -q -c "SET search_path=dev;" -f "$WORK/traces.sql" >/dev/null
echo "  ✓ SQL_USER_TRACES が流れた"

python3 "$HERE/extract_9_9_foreign_sql.py" --name SQL_UNSAFE_COUNT > "$WORK/safe.sql"
python3 "$HERE/extract_9_9_foreign_sql.py" --name REPAIR_FIX_COUNTRY_STATEMENTS > "$WORK/fix.sql"

# --- 3. 修復案 A が «ユーザーの痕跡がある店» を消さない -----------------------
# kr1 に dish_media といいねを付ける。kr2 は素のまま。
DISH_KR1="$(q "INSERT INTO dishes (restaurant_id, category_id)
  SELECT id,'Q1' FROM restaurants WHERE google_place_id='kr1' RETURNING id")"
MEDIA_KR1="$(q "INSERT INTO dish_media (dish_id, render_type) VALUES ('$DISH_KR1','external_embed') RETURNING id")"
q "INSERT INTO dish_media_external_embeddings (dish_media_id, dish_id) VALUES ('$MEDIA_KR1','$DISH_KR1')" >/dev/null
q "INSERT INTO dish_media_likes (dish_media_id) VALUES ('$MEDIA_KR1')" >/dev/null
DISH_KR2="$(q "INSERT INTO dishes (restaurant_id, category_id)
  SELECT id,'Q1' FROM restaurants WHERE google_place_id='kr2' RETURNING id")"
MEDIA_KR2="$(q "INSERT INTO dish_media (dish_id, render_type) VALUES ('$DISH_KR2','external_embed') RETURNING id")"
q "INSERT INTO dish_media_external_embeddings (dish_media_id, dish_id) VALUES ('$MEDIA_KR2','$DISH_KR2')" >/dev/null

SAFE_ROW="$(psqlq -tAq -c "SET search_path=dev;" -f "$WORK/safe.sql")"
expect "修復対象 / 消してよい店" "$SAFE_ROW" "6|5"

python3 "$HERE/extract_9_9_foreign_sql.py" --name REPAIR_DELETE_STATEMENTS > "$WORK/del.sql"
psqlq -q <<SQL
SET search_path = dev;
BEGIN;
$(cat "$WORK/del.sql")
CREATE TEMP TABLE _after AS
  SELECT (SELECT count(*) FROM restaurants) AS r,
         (SELECT count(*) FROM dish_media)  AS m;
\copy (SELECT r, m FROM _after) TO '$WORK/after.csv' CSV
ROLLBACK;
SQL
expect "削除後に残る restaurants / dish_media" "$(cat "$WORK/after.csv")" "11,1"

# --- 4. 修復案 B（country_code 訂正）が流れる --------------------------------
psqlq -q <<SQL
SET search_path = dev;
BEGIN;
$(cat "$WORK/fix.sql")
\copy (SELECT count(*) FROM restaurants WHERE country_code <> 'JP') TO '$WORK/fixed.csv' CSV
ROLLBACK;
SQL
expect "訂正後に country_code<>'JP' の店" "$(cat "$WORK/fixed.csv")" "7"

echo "✅ #1815 判定と監査 SQL は実物の PostgreSQL 16 で期待どおりに動く"
