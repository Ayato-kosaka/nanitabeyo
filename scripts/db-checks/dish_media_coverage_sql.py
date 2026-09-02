"""#1782 coverage 計測（measure_dish_media_coverage.py）が使う SQL の組み立て。

DB 接続を一切持たない純関数だけを置く。**usable dish_media の判定条件はここに 1 箇所だけ
書く**（店提案の実クエリ `api/src/v1/dish-media/dish-media.repository.ts` の
`findDishMediaIds` / `base_candidates` CTE から抽出したもの。#1782 設計調査 §「usable
dish_media」参照）。measure_dish_media_coverage.py 側では条件を書き下さず、ここの関数を
呼ぶだけにすること。判定条件が変わったら、直す場所はここだけにする。

test_dish_media_coverage_sql.py が「5 条件が全部 SQL に出ているか」を機械検査する。
"""

from __future__ import annotations

DEFAULT_GRID_DEGREE = 0.1
DEFAULT_RADIUS_M = 20_000
DEFAULT_MIN_RESTAURANTS = 5
DEFAULT_TEMP_TABLE_NAME = "usable_dish_media_tmp"

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


def build_area_centers_sql(grid_degree: float = DEFAULT_GRID_DEGREE) -> str:
    """restaurants の座標を grid_degree 度グリッドへスナップした重心（=「area」の代表点）。

    measure_map_pins_distribution.py の `FLOOR(lat/cell)` と同じグリッド化。
    """
    return (
        "SELECT\n"
        f"  FLOOR(latitude / {grid_degree}) * {grid_degree}  AS grid_lat,\n"
        f"  FLOOR(longitude / {grid_degree}) * {grid_degree} AS grid_lng,\n"
        "  avg(latitude)  AS center_lat,\n"
        "  avg(longitude) AS center_lng,\n"
        "  count(*)       AS restaurant_count\n"
        "FROM restaurants\n"
        "GROUP BY 1, 2"
    )


def build_area_center_count_sql(grid_degree: float = DEFAULT_GRID_DEGREE) -> str:
    """Stage5 の分母（area セル数）だけを安く数える。CROSS JOIN は要らない。"""
    return f"SELECT count(*) FROM (\n{build_area_centers_sql(grid_degree)}\n) AS area_centers"


def build_dish_category_count_sql() -> str:
    """Stage5 の分母（カテゴリ数）だけを安く数える。"""
    return "SELECT count(*) FROM dish_categories"


def _stage5_base_sql(
    grid_degree: float,
    radius_m: float,
    table_name: str,
) -> str:
    """Stage5 の `area(grid) × dish_category` 集計本体（HAVING / ORDER BY を持たない）。

    店提案と同じ半径検索（ST_DWithin）を area の代表点（重心）へ回す形。
    build_stage5_coverage_sql() と build_shortage_cells_sql() の両方がこれを土台にする
    （HAVING の有無だけが違いで、集計そのものを二重に書かない）。
    """
    return (
        "WITH area_centers AS (\n"
        f"{build_area_centers_sql(grid_degree)}\n"
        ")\n"
        "SELECT\n"
        "  ac.grid_lat,\n"
        "  ac.grid_lng,\n"
        "  ac.restaurant_count,\n"
        "  c.id AS category_id,\n"
        "  c.label_en AS category_label,\n"
        "  count(DISTINCT t.restaurant_id) AS restaurants_with_usable_media\n"
        "FROM area_centers ac\n"
        "CROSS JOIN dish_categories c\n"
        f"LEFT JOIN {table_name} t\n"
        "  ON t.category_id = c.id\n"
        " AND ST_DWithin(\n"
        "       t.location,\n"
        "       ST_SetSRID(ST_MakePoint(ac.center_lng, ac.center_lat), 4326)::geography,\n"
        f"       {radius_m}\n"
        "     )\n"
        "GROUP BY ac.grid_lat, ac.grid_lng, ac.restaurant_count, c.id, c.label_en"
    )


def build_stage5_coverage_sql(
    grid_degree: float = DEFAULT_GRID_DEGREE,
    radius_m: float = DEFAULT_RADIUS_M,
    table_name: str = DEFAULT_TEMP_TABLE_NAME,
) -> str:
    """Stage5: `area(grid) × dish_category` の全セルの coverage（HAVING なし）。"""
    return (
        _stage5_base_sql(grid_degree, radius_m, table_name)
        + "\nORDER BY restaurants_with_usable_media ASC, ac.grid_lat, ac.grid_lng, c.id"
    )


def build_shortage_cells_sql(
    grid_degree: float = DEFAULT_GRID_DEGREE,
    radius_m: float = DEFAULT_RADIUS_M,
    min_restaurants: int = DEFAULT_MIN_RESTAURANTS,
    table_name: str = DEFAULT_TEMP_TABLE_NAME,
) -> str:
    """不足セル一覧: usable dish_media を持つ店舗が min_restaurants 未満の area × category。"""
    return (
        _stage5_base_sql(grid_degree, radius_m, table_name)
        + f"\nHAVING count(DISTINCT t.restaurant_id) < {min_restaurants}"
        + "\nORDER BY restaurants_with_usable_media ASC, ac.grid_lat, ac.grid_lng, c.id"
    )
