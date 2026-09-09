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

from pathlib import Path

# 3_4_build_restaurant_catalog.py の `--service-cell-level` 既定値と合わせる
# （coverage の分母となる S2 セルは、BigQuery 側の restaurant_service_cell_catalog と
# 同じ粒度でなければ比較できない。test_dish_media_coverage_sql.py が値の一致を
# ソース同士の突き合わせで検査する）。
DEFAULT_S2_LEVEL = 14
DEFAULT_RADIUS_M = 20_000
DEFAULT_MIN_RESTAURANTS = 5
DEFAULT_TEMP_TABLE_NAME = "usable_dish_media_tmp"
DEFAULT_AREA_CELLS_TABLE_NAME = "area_cells_tmp"
DEFAULT_TOP_CELLS_LIMIT = 20


def _area_cell_point_expr(alias: str = "") -> str:
    """area_cells_tmp の代表点(center_lat/center_lng)を geography の点として表す式。

    GiST 式索引の定義（テーブル自身を指すので alias 無し）と、JOIN 条件（alias 付き）の
    両方がこの関数を通す。PostgreSQL は式索引を列参照ベースで突き合わせるため、
    alias の有無はあっても列そのものが一致していれば索引は使われる。
    """
    prefix = f"{alias}." if alias else ""
    return f"ST_SetSRID(ST_MakePoint({prefix}center_lng, {prefix}center_lat), 4326)::geography"


# 8_1_validate_catalogs.py の `target_categories` CTE
# （`dish_dataset.dish_category_features_catalog` を feature_type/feature_key/score>0 で
# 絞る条件）と同じ JP gate の定義。BigQuery 側テーブルはそのまま参照できないため、
# PostgreSQL へ同期された `dish_category_features`
# （infra/supabase/migrations/20251224T0003_create_dish_category_features.sql）を
# 同じ条件で絞る。条件の値（'gate' / 'region:country:JP'）は8_1側と2箇所独立に
# 存在するため、test_dish_media_coverage_sql.py が両ファイルの文字列一致を検査する。
JP_GATE_FEATURE_TYPE = "gate"
JP_GATE_FEATURE_KEY = "region:country:JP"

# 「使える dish_media」の判定は **本番コードが正本**であり、ここには持たない。
#
# #1782 完了条件 3「usable dish_media の判定が本番コードから抜き出されており、
# **二重定義になっていない**」。以前はこの位置に 4 条件を手で書き写して持っており、
# 添えてあった行番号コメント（dish-media.repository.ts:236 等）は #1798 と #1666 で
# 行が動いた時点で既に指していなかった。**計測側が古い判定のまま緑を出し続けると、
# 「Google を外せるか」の判断材料が静かに嘘になる。**
#
# 正本は api/src/v1/dish-media/usable-dish-media-filter.ts で、
# usable-dish-media-filter.spec.snapshot.spec.ts が下のファイルへ書き出し、
# 内容が一致することを機械検査している（#1629 の SQL 写経事故と同じ作法）。
#
# ⚠️ 5 条件目の「dish の category_id が検索カテゴリと一致」だけは WHERE ではなく、
#    usable_dish_media_select_sql() が dishes を JOIN して d.category_id を選択列に
#    出すことで表現している（= そのカテゴリの dish に紐づく投稿だけを対象にする）。
USABLE_CONDITIONS_SQL_PATH = (
    Path(__file__).resolve().parent / "sql" / "usable_dish_media_conditions.sql"
)


def usable_dish_media_conditions_sql() -> str:
    """本番の判定（WHERE の末尾へ連結できる AND 始まりの断片）を読む。

    ⚠️ ここで条件を書き足さない・書き換えないこと。変えるなら本番側を変えて
       スナップショットを書き出し直す（ファイル先頭のコメントに手順がある）。
    """
    if not USABLE_CONDITIONS_SQL_PATH.exists():
        raise SystemExit(
            f"❌ {USABLE_CONDITIONS_SQL_PATH} がない。"
            " UPDATE_RESTAURANT_SQL_SNAPSHOT=1 pnpm --filter api exec jest "
            "usable-dish-media-filter.spec.snapshot  で書き出すこと"
        )
    lines = [
        line
        for line in USABLE_CONDITIONS_SQL_PATH.read_text(encoding="utf-8").splitlines()
        if not line.lstrip().startswith("--")
    ]
    return "\n".join(lines).strip()


def usable_dish_media_select_sql() -> str:
    """usable dish_media を1行1件で列挙する SELECT（dish_media_id, restaurant_id, category_id, location）。

    Stage4/Stage5 はどちらもこの SELECT を一時テーブルへ materialize した結果を使う
    （呼ぶのはここから作る一時テーブルの構築 SQL 経由のみで、この関数自体を
    Stage4/Stage5 が個別に埋め込むことはしない）。
    """
    return (
        "SELECT\n"
        "  dm.id AS dish_media_id,\n"
        "  d.restaurant_id AS restaurant_id,\n"
        "  d.category_id AS category_id,\n"
        "  r.location AS location\n"
        "FROM dish_media dm\n"
        "JOIN dishes d ON d.id = dm.dish_id\n"
        "JOIN restaurants r ON r.id = d.restaurant_id\n"
        # 断片は AND で始まるので、常に真の述語をひとつ置いてから連結する
        "WHERE 1=1\n  " + usable_dish_media_conditions_sql()
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


def build_area_cells_temp_index_sql(
    table_name: str = DEFAULT_AREA_CELLS_TABLE_NAME,
) -> list[str]:
    """Stage5 が usable dish_media 側から半径検索を投げる相手（area_cells）の索引。

    Stage5 は usable dish_media（高々数千行）を起点に `ST_DWithin` を area_cells
    （十万行オーダー）へ投げる向きに変えたため、GiST 式索引が無いと全 area_cells を
    毎回スキャンする（起点行数 × セル数のネステッドループ）。索引の式は
    `_area_cell_point_expr()` で JOIN 条件と共有し、ズレによる索引の不使用を防ぐ。
    """
    return [f"CREATE INDEX ON {table_name} USING GIST (({_area_cell_point_expr()}))"]


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


def _stage5_matched_sql(
    radius_m: float,
    area_table_name: str,
    media_table_name: str,
) -> str:
    """Stage5 集計本体。usable dish_media を起点に、半径内の area_cell を引く向き。

    以前は `area_cells CROSS JOIN jp_gate_categories`（分母全体。dev実測で1,686万行）を
    先に作ってから usable dish_media を LEFT JOIN していたため、中身が入らない
    組み合わせまで全部 ST_DWithin を評価しており、300秒のstatement_timeoutで
    QueryCanceled になった（run: 33698994719）。usable dish_media は dev実測で
    4,906行しかなく、coverageが非ゼロになり得るのはこの行が近くにある組み合わせだけ
    なので、起点をこちら（少ない側）に変える。

    INNER JOIN のため、この SELECT には usable dish_media が半径内に 1 件も無い
    area × category は最初から現れない（coverageが0の組み合わせは、呼び出し側が
    「全組み合わせ数 − この結果の行数」で引き算して出す。0件を1行ずつ列挙しない）。
    build_stage5_summary_sql() と build_stage5_top_cells_sql() の両方がこれを
    CTE として土台にする（集計そのものを二重に書かない）。
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
        f"FROM {media_table_name} t\n"
        "JOIN jp_gate_categories c ON c.category_id = t.category_id\n"
        f"JOIN {area_table_name} ac\n"
        "  ON ST_DWithin(\n"
        "       t.location,\n"
        f"       {_area_cell_point_expr('ac')},\n"
        f"       {radius_m}\n"
        "     )\n"
        "GROUP BY ac.s2_cell_id, ac.restaurant_count, c.category_id, c.category_label"
    )


def build_stage5_summary_sql(
    radius_m: float = DEFAULT_RADIUS_M,
    min_restaurants: int = DEFAULT_MIN_RESTAURANTS,
    area_table_name: str = DEFAULT_AREA_CELLS_TABLE_NAME,
    media_table_name: str = DEFAULT_TEMP_TABLE_NAME,
) -> str:
    """Stage5: coverage が非ゼロの area × category を、min_restaurants 基準でバケット集計する。

    16.8M 行を1行ずつ返す代わりに、`>= min_restaurants` / `< min_restaurants` の
    2バケットの件数だけを返す。coverageが0の件数は呼び出し側が全組み合わせ数から
    このクエリの `covered_total` を引いて出す。
    """
    return (
        "WITH matched AS (\n"
        f"{_stage5_matched_sql(radius_m, area_table_name, media_table_name)}\n"
        ")\n"
        "SELECT\n"
        f"  count(*) FILTER (WHERE restaurants_with_usable_media >= {min_restaurants})"
        " AS covered_at_or_above_min,\n"
        f"  count(*) FILTER (WHERE restaurants_with_usable_media < {min_restaurants})"
        " AS covered_below_min,\n"
        "  count(*) AS covered_total\n"
        "FROM matched"
    )


def build_stage5_shortfall_cells_sql(
    top_n: int = DEFAULT_TOP_CELLS_LIMIT,
    radius_m: float = DEFAULT_RADIUS_M,
    min_restaurants: int = DEFAULT_MIN_RESTAURANTS,
    area_table_name: str = DEFAULT_AREA_CELLS_TABLE_NAME,
    media_table_name: str = DEFAULT_TEMP_TABLE_NAME,
) -> str:
    """#1782 完了条件2: **あと少しで成立する** area × category を、惜しい順に出す。

    ⚠️ 「不足セル」を素直に «閾値に満たない全部» と読むと 16,467,553 行になる
       （dev 実測: 0 店舗 16,389,774 + 1〜4 店舗 77,779）。**一覧にしても打ち手は決まらない。**

    打ち手が決まるのは «1 件以上あるが閾値に届いていない» セルである。ここは投稿が
    あと 1〜4 件増えれば成立に変わる。0 店舗のセルは «そのエリアにその料理の店を
    見つけるところから» なので、投稿の追加では動かず、性質が違う（#1273 の担当）。

    多い順に並べるのは «いちばん惜しいものから潰す» ため。
    """
    return (
        _stage5_matched_sql(radius_m, area_table_name, media_table_name)
        + f"\nHAVING count(DISTINCT t.restaurant_id) < {min_restaurants}"
        + "\nORDER BY restaurants_with_usable_media DESC, ac.s2_cell_id, c.category_id"
        + f"\nLIMIT {top_n}"
    )


def build_stage5_shortfall_by_category_sql(
    top_n: int = DEFAULT_TOP_CELLS_LIMIT,
    radius_m: float = DEFAULT_RADIUS_M,
    min_restaurants: int = DEFAULT_MIN_RESTAURANTS,
    area_table_name: str = DEFAULT_AREA_CELLS_TABLE_NAME,
    media_table_name: str = DEFAULT_TEMP_TABLE_NAME,
) -> str:
    """#1782 完了条件2: 惜しいセルをカテゴリ単位でまとめる（«どの料理から手を付けるか»）。

    セル一覧はエリアの粒度が細かすぎて（S2 level 14 = 約 1.3km 四方）、
    隣接セルが同じ店を見るので同じ行が並ぶ。**打ち手はカテゴリ単位で決まる**ので、
    «惜しいセルを最も多く抱えているカテゴリ» を出す。
    """
    return (
        "WITH matched AS (\n"
        f"{_stage5_matched_sql(radius_m, area_table_name, media_table_name)}\n"
        ")\n"
        "SELECT\n"
        "  category_id,\n"
        "  category_label,\n"
        f"  count(*) FILTER (WHERE restaurants_with_usable_media < {min_restaurants})"
        " AS shortfall_cells,\n"
        f"  count(*) FILTER (WHERE restaurants_with_usable_media >= {min_restaurants})"
        " AS covered_cells,\n"
        "  max(restaurants_with_usable_media) AS best_cell_restaurants\n"
        "FROM matched\n"
        "GROUP BY category_id, category_label\n"
        f"HAVING count(*) FILTER (WHERE restaurants_with_usable_media < {min_restaurants}) > 0\n"
        "ORDER BY shortfall_cells DESC, category_id\n"
        f"LIMIT {top_n}"
    )


def build_stage5_top_cells_sql(
    top_n: int = DEFAULT_TOP_CELLS_LIMIT,
    radius_m: float = DEFAULT_RADIUS_M,
    area_table_name: str = DEFAULT_AREA_CELLS_TABLE_NAME,
    media_table_name: str = DEFAULT_TEMP_TABLE_NAME,
) -> str:
    """Stage5: coverage（usable dish_media を持つ店舗数）が多い順に上位 top_n 件。"""
    return (
        _stage5_matched_sql(radius_m, area_table_name, media_table_name)
        + "\nORDER BY restaurants_with_usable_media DESC, ac.s2_cell_id, c.category_id"
        + f"\nLIMIT {top_n}"
    )
