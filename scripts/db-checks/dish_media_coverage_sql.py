"""#1782 coverage 計測（measure_dish_media_coverage.py）が使う SQL の組み立て。

DB 接続を一切持たない純関数だけを置く。**usable dish_media の判定条件はここに 1 箇所だけ
書く**（店提案の実クエリ `api/src/v1/dish-media/dish-media.repository.ts` の
`findDishMediaIds` / `base_candidates` CTE から抽出したもの。#1782 設計調査 §「usable
dish_media」参照）。measure_dish_media_coverage.py 側では条件を書き下さず、ここの関数を
呼ぶだけにすること。判定条件が変わったら、直す場所はここだけにする。

test_dish_media_coverage_sql.py が「5 条件が全部 SQL に出ているか」を機械検査する。

area（S2セル）と category（JP gate）の定義も同じ理由でここへ1箇所だけ置く。
どちらも新しい定義を作らず、既存の定義（3_4_build_restaurant_catalog.py の
`--service-cell-level` / 8_1_validate_catalogs.py の `target_categories` CTE）に
合わせている。S2セルの計算自体（座標→セルID）はPostgreSQLにS2関数が無いため
Python側（measure_dish_media_coverage.py が呼ぶ normalization.s2_cell_id()）で行い、
ここでは計算結果を受け取る一時テーブルのDDL/INSERTだけを組み立てる。
"""

from __future__ import annotations

# 3_4_build_restaurant_catalog.py の `--service-cell-level` 既定値と合わせる
# （coverage の分母となる S2 セルは、BigQuery 側の restaurant_service_cell_catalog と
# 同じ粒度でなければ比較できない。test_dish_media_coverage_sql.py が値の一致を
# ソース同士の突き合わせで検査する）。
DEFAULT_S2_LEVEL = 14
DEFAULT_RADIUS_M = 20_000
DEFAULT_MIN_RESTAURANTS = 5
DEFAULT_TEMP_TABLE_NAME = "usable_dish_media_tmp"
DEFAULT_AREA_CELLS_TABLE_NAME = "area_cells_tmp"

# 8_1_validate_catalogs.py の `target_categories` CTE
# （`dish_dataset.dish_category_features_catalog` を feature_type/feature_key/score>0 で
# 絞る条件）と同じ JP gate の定義。BigQuery 側テーブルはそのまま参照できないため、
# PostgreSQL へ同期された `dish_category_features`
# （infra/supabase/migrations/20251224T0003_create_dish_category_features.sql）を
# 同じ条件で絞る。条件の値（'gate' / 'region:country:JP'）は8_1側と2箇所独立に
# 存在するため、test_dish_media_coverage_sql.py が両ファイルの文字列一致を検査する。
JP_GATE_FEATURE_TYPE = "gate"
JP_GATE_FEATURE_KEY = "region:country:JP"

# dish-media.repository.ts の base_candidates CTE と同じ 4 条件（WHERE で書けるもの）。
# 5 条件目の「dish の category_id が検索カテゴリと一致」は WHERE ではなく、
# usable_dish_media_select_sql() が dishes を JOIN して d.category_id を選択列に
# 出すことで表現している（=「そのカテゴリの dish に紐づく投稿だけを対象にする」）。
USABLE_DISH_MEDIA_CONDITIONS = (
    # #1513 論理削除済みの投稿は対象外 — dish-media.repository.ts:236
    "dm.deleted_at IS NULL",
    # #1257 実体（GCS original）が届いていない投稿は対象外 — dish-media.repository.ts:251
    "dm.media_processing_status = 'completed'",
    # #1511 退会したユーザーの投稿は対象外 — dish-media.repository.ts:240-244
    "NOT EXISTS (\n"
    "    SELECT 1 FROM users u\n"
    "    WHERE u.id = dm.user_id AND u.deleted_at IS NOT NULL\n"
    "  )",
    # #1641 埋め込みの枠で再生不能と分かっている投稿は対象外 — dish-media.repository.ts:269-273
    "NOT EXISTS (\n"
    "    SELECT 1 FROM dish_media_external_embeddings dmee\n"
    "    WHERE dmee.dish_media_id = dm.id AND dmee.playback_status = 'not_playable'\n"
    "  )",
)


def usable_dish_media_select_sql() -> str:
    """usable dish_media を1行1件で列挙する SELECT（dish_media_id, restaurant_id, category_id, location）。

    Stage4/Stage5 はどちらもこの SELECT を一時テーブルへ materialize した結果を使う
    （呼ぶのはここから作る一時テーブルの構築 SQL 経由のみで、この関数自体を
    Stage4/Stage5 が個別に埋め込むことはしない）。
    """
    where_clause = "\n  AND ".join(USABLE_DISH_MEDIA_CONDITIONS)
    return (
        "SELECT\n"
        "  dm.id AS dish_media_id,\n"
        "  d.restaurant_id AS restaurant_id,\n"
        "  d.category_id AS category_id,\n"
        "  r.location AS location\n"
        "FROM dish_media dm\n"
        "JOIN dishes d ON d.id = dm.dish_id\n"
        "JOIN restaurants r ON r.id = d.restaurant_id\n"
        f"WHERE {where_clause}"
    )


def build_usable_dish_media_temp_table_sql(
    table_name: str = DEFAULT_TEMP_TABLE_NAME,
) -> str:
    return f"CREATE TEMP TABLE {table_name} AS\n{usable_dish_media_select_sql()}"


def build_usable_dish_media_temp_index_sql(
    table_name: str = DEFAULT_TEMP_TABLE_NAME,
) -> list[str]:
    return [
        f"CREATE INDEX ON {table_name} USING GIST (location)",
        f"CREATE INDEX ON {table_name} (category_id)",
    ]


def build_stage1_total_restaurants_sql() -> str:
    """Stage1: 店舗マスターの母数。"""
    return "SELECT count(*) AS total_restaurants FROM restaurants"


def build_stage2_restaurant_links_sql() -> str:
    """Stage2: kind ごとの、外部リンクを持つ店舗数。"""
    return (
        "SELECT rl.kind, count(DISTINCT rl.restaurant_id) AS restaurants_with_link\n"
        "FROM restaurant_links rl\n"
        "GROUP BY rl.kind\n"
        "ORDER BY restaurants_with_link DESC"
    )


def build_stage4_category_coverage_sql(
    table_name: str = DEFAULT_TEMP_TABLE_NAME,
) -> str:
    """Stage4: 地理条件を外した、category ごとの usable dish_media を持つ店舗数。

    usable_dish_media_temp_table_sql() で作った一時テーブルを読むだけで、
    条件（WHERE）を書き下さない。
    """
    return (
        "SELECT category_id, count(DISTINCT restaurant_id) AS restaurants_with_usable_media\n"
        f"FROM {table_name}\n"
        "GROUP BY category_id\n"
        "ORDER BY restaurants_with_usable_media DESC"
    )


def build_restaurant_locations_sql() -> str:
    """area(S2セル)化のため、restaurants の座標を1件ずつ読み出す。

    PostgreSQL には BigQuery の `S2_CELLIDFROMPOINT` に相当する関数が無いため、
    セル化そのものは Python 側（`scripts/20260808T0000_restaurant/normalization.py`
    の `s2_cell_id()`。BigQuery `S2_CELLIDFROMPOINT` と同じ符号付きINT64表現）で行う。
    """
    return "SELECT latitude, longitude FROM restaurants"


def build_area_cells_temp_table_sql(table_name: str = DEFAULT_AREA_CELLS_TABLE_NAME) -> str:
    """Python 側で集計した S2 セルごとの重心・店舗数を受け取る一時テーブル。

    `s2_cell_id` は BigQuery の `S2_CELLIDFROMPOINT` と同じ符号付き INT64 なので BIGINT。
    """
    return (
        f"CREATE TEMP TABLE {table_name} (\n"
        "  s2_cell_id BIGINT PRIMARY KEY,\n"
        "  center_lat DOUBLE PRECISION NOT NULL,\n"
        "  center_lng DOUBLE PRECISION NOT NULL,\n"
        "  restaurant_count INTEGER NOT NULL\n"
        ")"
    )


def build_area_cells_insert_sql(table_name: str = DEFAULT_AREA_CELLS_TABLE_NAME) -> str:
    """psycopg2.extras.execute_values と組み合わせて使う INSERT テンプレート。"""
    return (
        f"INSERT INTO {table_name} (s2_cell_id, center_lat, center_lng, restaurant_count)\n"
        "VALUES %s"
    )


def build_area_cell_count_sql(table_name: str = DEFAULT_AREA_CELLS_TABLE_NAME) -> str:
    """Stage5 の分母（area セル数）だけを安く数える。CROSS JOIN は要らない。"""
    return f"SELECT count(*) FROM {table_name}"


def jp_gate_category_select_sql() -> str:
    """JP gate（8_1_validate_catalogs.py の `target_categories` CTE と同じ条件）を
    通過した dish_category だけを列挙する。

    BigQuery 側の実体は `dish_dataset.dish_category_features_catalog` だが、
    PostgreSQL には `dish_category_features` として同期されている
    （infra/supabase/migrations/20251224T0003_create_dish_category_features.sql）。
    """
    return (
        "SELECT c.id AS category_id, c.label_en AS category_label\n"
        "FROM dish_categories c\n"
        "WHERE EXISTS (\n"
        "  SELECT 1 FROM dish_category_features f\n"
        "  WHERE f.dish_category_id = c.id\n"
        f"    AND f.feature_type = '{JP_GATE_FEATURE_TYPE}'\n"
        f"    AND f.feature_key = '{JP_GATE_FEATURE_KEY}'\n"
        "    AND f.score > 0\n"
        ")"
    )


def build_jp_gate_category_count_sql() -> str:
    """Stage5 の分母（JP gate を通過したカテゴリ数）だけを安く数える。"""
    return f"SELECT count(*) FROM (\n{jp_gate_category_select_sql()}\n) AS jp_gate_categories"


def _stage5_base_sql(
    radius_m: float,
    area_table_name: str,
    media_table_name: str,
) -> str:
    """Stage5 の `area(S2セル) × JP gate dish_category` 集計本体（HAVING / ORDER BY を持たない）。

    店提案と同じ半径検索（ST_DWithin）を area の代表点（S2セル内の重心）へ回す形。
    build_stage5_coverage_sql() と build_shortage_cells_sql() の両方がこれを土台にする
    （HAVING の有無だけが違いで、集計そのものを二重に書かない）。
    """
    return (
        "WITH jp_gate_categories AS (\n"
        f"{jp_gate_category_select_sql()}\n"
        ")\n"
        "SELECT\n"
        "  ac.s2_cell_id,\n"
        "  ac.restaurant_count,\n"
        "  c.category_id,\n"
        "  c.category_label,\n"
        "  count(DISTINCT t.restaurant_id) AS restaurants_with_usable_media\n"
        f"FROM {area_table_name} ac\n"
        "CROSS JOIN jp_gate_categories c\n"
        f"LEFT JOIN {media_table_name} t\n"
        "  ON t.category_id = c.category_id\n"
        " AND ST_DWithin(\n"
        "       t.location,\n"
        "       ST_SetSRID(ST_MakePoint(ac.center_lng, ac.center_lat), 4326)::geography,\n"
        f"       {radius_m}\n"
        "     )\n"
        "GROUP BY ac.s2_cell_id, ac.restaurant_count, c.category_id, c.category_label"
    )


def build_stage5_coverage_sql(
    radius_m: float = DEFAULT_RADIUS_M,
    area_table_name: str = DEFAULT_AREA_CELLS_TABLE_NAME,
    media_table_name: str = DEFAULT_TEMP_TABLE_NAME,
) -> str:
    """Stage5: `area(S2セル) × JP gate dish_category` の全セルの coverage（HAVING なし）。"""
    return (
        _stage5_base_sql(radius_m, area_table_name, media_table_name)
        + "\nORDER BY restaurants_with_usable_media ASC, ac.s2_cell_id, c.category_id"
    )


def build_shortage_cells_sql(
    radius_m: float = DEFAULT_RADIUS_M,
    min_restaurants: int = DEFAULT_MIN_RESTAURANTS,
    area_table_name: str = DEFAULT_AREA_CELLS_TABLE_NAME,
    media_table_name: str = DEFAULT_TEMP_TABLE_NAME,
) -> str:
    """不足セル一覧: usable dish_media を持つ店舗が min_restaurants 未満の area × category。"""
    return (
        _stage5_base_sql(radius_m, area_table_name, media_table_name)
        + f"\nHAVING count(DISTINCT t.restaurant_id) < {min_restaurants}"
        + "\nORDER BY restaurants_with_usable_media ASC, ac.s2_cell_id, c.category_id"
    )
