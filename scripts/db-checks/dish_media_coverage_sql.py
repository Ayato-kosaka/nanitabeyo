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
DEFAULT_STAGE5_DRIVER_TABLE_NAME = "stage5_driver_tmp"
DEFAULT_TOP_CELLS_LIMIT = 20

# Stage5 を一度に何セルぶんずつ集計するか。
#
# ⚠️ **これは速度の設定ではなく «共有ディスクを食い潰さない» ための設定である**（#1782）。
# dev と public は同じ Postgres インスタンスで、`temp_file_limit` は superuser でないと
# 張れない（run 36819189609 で実測）。つまり **一時ファイルを抑える手段はこれだけ**。
# 半径 20km の ST_DWithin は 1 行が数百〜千セルに当たるので、分割しないと中間結果の
# 大きさが «起点の行数 × セル数» そのままになる（起点は供給側が増えるほど増える）。
DEFAULT_CELL_BATCH_SIZE = 2_000


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


def build_area_cell_ids_sql(table_name: str = DEFAULT_AREA_CELLS_TABLE_NAME) -> str:
    """Stage5 を分割するためのセル ID の一覧（昇順）。

    ⚠️ **セルで割るのは、割っても数字が変わらないからである。** Stage5 の出力行は
    (セル, カテゴリ) で、セルはどのバッチにも 1 回しか現れない = 完全な分割になる。
    だから件数は足し算、上位 N は «各バッチの上位 N» からの再選択、カテゴリ別の
    集計はキーごとの足し算（最大値は最大値）で **一括と同じ値**になる。
    カテゴリで割ると «カテゴリ別上位 N» が崩れるので、セルで割る。
    """
    return f"SELECT s2_cell_id FROM {table_name} ORDER BY s2_cell_id"


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


def build_stage5_driver_temp_table_sql(
    driver_table_name: str = DEFAULT_STAGE5_DRIVER_TABLE_NAME,
    media_table_name: str = DEFAULT_TEMP_TABLE_NAME,
    include_jp_gate: bool = True,
) -> str:
    """Stage5 の **起点**を «これ以上小さくできない形» まで畳んだ一時テーブル。

    ## なぜ要るか（#1782 2026-10-01 の DiskFull）

    2026-09-02 に «起点を少ない側（usable dish_media）に変える» 修正を入れた
    （[run 33698994719](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/33698994719)
    で `area_cells CROSS JOIN jp_gate_categories` が 300 秒を超えたため）。
    **向きは正しかったが、«少ない側» を最小にしていなかった。**

    | 起点に残っていた無駄 | dev 実測（2026-10-01） |
    | --- | --- |
    | 同じ (店, カテゴリ) の投稿が何行も並ぶ | usable dish_media **904,118 行**（09-03 は 4,906 行） |
    | JP gate に入らないカテゴリの行まで join している | usable がある category は **2,776** / JP gate は **134** |

    半径 20km の `ST_DWithin` は 1 行が数千セルに当たるので、行数がそのまま中間結果の
    倍率になる。904,118 行 × 数千セルのハッシュ集約が溢れ、
    [run 36816039711](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/36816039711) は
    `DiskFull: could not write to file "base/pgsql_tmp/..."` で落ちた。
    ⚠️ **このインスタンスは dev と public が同居している**（#2006）。«読み取り専用だから
    安全» は一時ファイルには当てはまらない。起点を小さくするのは速度の話ではなく、
    **共有ディスクを食い潰さないための修正**である。

    ## 畳んでも数字が変わらない理由（ここが崩れたら count(*) は使えない）

    `usable_dish_media_select_sql()` の `location` は **`r.location`（店の座標）**なので、
    (restaurant_id, category_id) が決まれば location は 1 つに決まる。したがって
    `DISTINCT (restaurant_id, category_id, location)` は **(店, カテゴリ) ごとに 1 行**で、
    セル × カテゴリごとの `count(*)` は元の `count(DISTINCT t.restaurant_id)` と
    **同じ値**になる。⚠️ `location` を投稿側の列に変えたらこの等式は壊れる。
    test_dish_media_coverage_sql.py がこの前提を縛っている。

    JP gate の絞り込みもここで済ませる（Stage5 の 4 本すべてが INNER JOIN で
    同じ絞り込みをしていたので、意味は変わらない）。Stage4 は**この表を使わない**
    （あちらは全カテゴリを出すのが仕事）。

    ## `include_jp_gate=False` を使う場面（#843 2026-10-01）

    **本番の検索は JP gate を見ない。** `findDishMediaIds` は
    `d.category_id = <リクエストされたカテゴリ>` で絞るだけで、gate は
    «日本で出すカテゴリ» を選ぶ別の仕組みである。したがって
    «ユーザーの検索が返せたか» を測るときに gate で絞ると、
    **gate の外にある供給（dev 実測で usable があるカテゴリ 2,776 / gate は 134）を
    無いものとして数えてしまう**。そのときだけ `False` を渡す。
    #843 の見出し指標（coverage）は gate を分母の定義に含めるので `True` のまま。
    """
    if not include_jp_gate:
        # gate で絞らない。category_label は gate 表から来るので、ここでは NULL を置く
        # （呼び出し側が label を使わないことを前提にする。使うなら dish_categories から引くこと）。
        return (
            f"CREATE TEMP TABLE {driver_table_name} AS\n"
            "SELECT DISTINCT\n"
            "  t.restaurant_id,\n"
            "  t.category_id,\n"
            "  NULL::text AS category_label,\n"
            "  t.location\n"
            f"FROM {media_table_name} t"
        )
    return (
        f"CREATE TEMP TABLE {driver_table_name} AS\n"
        "WITH jp_gate_categories AS (\n"
        f"{jp_gate_category_select_sql()}\n"
        ")\n"
        "SELECT DISTINCT\n"
        "  t.restaurant_id,\n"
        "  c.category_id,\n"
        "  c.category_label,\n"
        "  t.location\n"
        f"FROM {media_table_name} t\n"
        "JOIN jp_gate_categories c ON c.category_id = t.category_id"
    )


def build_stage5_driver_temp_index_sql(
    driver_table_name: str = DEFAULT_STAGE5_DRIVER_TABLE_NAME,
) -> list[str]:
    return [
        f"CREATE INDEX ON {driver_table_name} USING GIST (location)",
        f"CREATE INDEX ON {driver_table_name} (category_id)",
    ]


def build_stage5_driver_count_sql(
    driver_table_name: str = DEFAULT_STAGE5_DRIVER_TABLE_NAME,
) -> str:
    """畳んだ起点の行数（«何をどれだけ小さくできたか» をログに出すため）。"""
    return f"SELECT count(*) FROM {driver_table_name}"


def _stage5_matched_sql(
    radius_m: float,
    area_table_name: str,
    driver_table_name: str,
    batched: bool = False,
) -> str:
    """Stage5 集計本体。畳んだ起点（(店, カテゴリ) 1 行）から半径内の area_cell を引く。

    INNER JOIN のため、この SELECT には usable dish_media が半径内に 1 件も無い
    area × category は最初から現れない（coverageが0の組み合わせは、呼び出し側が
    「全組み合わせ数 − この結果の行数」で引き算して出す。0件を1行ずつ列挙しない）。
    ⚠️ **この集計は 1 回だけ評価する。** 件数バケット・上位セル・惜しいセル・カテゴリ別は
    {@link build_stage5_matched_rows_sql} が返す行から {@link Stage5Accumulator} が作る
    （以前は 4 本のクエリに分けており、同じ集計を 4 回評価していた。run 36820246635）。

    ⚠️ `count(*)` でよい理由と、JP gate の絞り込みをここに書かない理由は
    {@link build_stage5_driver_temp_table_sql} にある。
    """
    return (
        "SELECT\n"
        "  ac.s2_cell_id,\n"
        "  t.category_id,\n"
        "  count(*) AS restaurants_with_usable_media\n"
        f"FROM {driver_table_name} t\n"
        f"JOIN {area_table_name} ac\n"
        "  ON ST_DWithin(\n"
        "       t.location,\n"
        f"       {_area_cell_point_expr('ac')},\n"
        f"       {radius_m}\n"
        "     )\n"
        # バッチ実行では «このバッチのセルだけ» へ絞る（%(cell_ids)s は呼び出し側がバインドする）
        + ("WHERE ac.s2_cell_id = ANY(%(cell_ids)s::bigint[])\n" if batched else "")
        + "GROUP BY ac.s2_cell_id, t.category_id"
    )


def build_stage5_matched_rows_sql(
    radius_m: float = DEFAULT_RADIUS_M,
    area_table_name: str = DEFAULT_AREA_CELLS_TABLE_NAME,
    driver_table_name: str = DEFAULT_STAGE5_DRIVER_TABLE_NAME,
    batched: bool = False,
) -> str:
    """Stage5 の集計を **1 回だけ**評価し、(セル, カテゴリ, 店舗数) をそのまま返す。

    ## なぜ 1 回にするのか（#1782 2026-10-01）

    以前はこの集計を土台に **4 本のクエリ**（件数バケット / 上位セル / 惜しいセル /
    カテゴリ別）を投げていた。SQL としては «同じ集計を 1 箇所に書く» を守れていたが、
    **実行は 4 回**で、dev 実測ではバッチあたり 4 回 × 63 バッチ = 252 回の重い集計になり、
    [run 36820246635](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/36820246635) は
    **65 分経っても終わらなかった**。dev と public は同じインスタンスなので
    （[#2006](https://github.com/Ayato-kosaka/nanitabeyo/issues/2006)）、
    **4 倍の仕事は 4 倍の迷惑**である。

    1 回だけ評価して行を受け取り、4 つの出し方は Python 側（{@link aggregate_stage5_rows}）
    で作る。⚠️ **定義はこの関数（= `_stage5_matched_sql`）に 1 箇所だけ残る。**
    閾値や並べ替えを SQL と Python の 2 箇所へ書かないため、SQL 側には
    `HAVING` も `ORDER BY` も `LIMIT` も置かない。

    ## 行数

    返るのは «coverage が非ゼロの (セル, カテゴリ)» だけ（INNER JOIN なので 0 件は出ない）。
    `category_label` と `restaurant_count` は**ここに含めない**（それぞれ 134 行 /
    125,834 行の引き当て表から Python 側で付ける。1 行ごとに文字列を運ばない）。
    """
    return _stage5_matched_sql(radius_m, area_table_name, driver_table_name, batched)


def build_area_cell_restaurant_counts_sql(
    table_name: str = DEFAULT_AREA_CELLS_TABLE_NAME,
) -> str:
    """セルごとの店舗数の引き当て表（1 行ごとに運ばないため、まとめて 1 回取る）。"""
    return f"SELECT s2_cell_id, restaurant_count FROM {table_name}"


class Stage5Accumulator:
    """Stage5 の 4 つの出し方を、**1 回の集計結果から**作る（#1782 2026-10-01）。

    以前は «件数バケット / 上位セル / 惜しいセル / カテゴリ別» を **SQL 4 本**で出していた。
    同じ重い集計を 4 回評価することになり、dev では 65 分でも終わらなかった
    （[run 36820246635](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/36820246635)）。

    ⚠️ **閾値と並べ替えはここだけに書く。** SQL 側には `HAVING` / `ORDER BY` / `LIMIT` を
    置かない（2 箇所に書くとずれ、片方だけ直ったときにテストが緑のまま嘘を守る）。

    ⚠️ **バッチをまたいで足せるのは、セルで割っているからである。** Stage5 の出力行は
    (セル, カテゴリ) で、セルはどのバッチにも 1 回しか現れない = 完全な分割なので、
    件数は足し算、上位 N は «各バッチの上位 N» からの再選択、カテゴリ別はキーごとの
    足し算（最大値は最大値）で **一括と同じ値**になる。
    """

    def __init__(self, min_restaurants: int = DEFAULT_MIN_RESTAURANTS, top_n: int = DEFAULT_TOP_CELLS_LIMIT):
        self.min_restaurants = min_restaurants
        self.top_n = top_n
        self.covered_at_or_above_min = 0
        self.covered_below_min = 0
        self.covered_total = 0
        self._top: list[tuple] = []
        self._shortfall: list[tuple] = []
        # category_id -> [shortfall_cells, covered_cells, best_cell_restaurants]
        self._by_category: dict[str, list[int]] = {}

    @staticmethod
    def _order_key(row: tuple) -> tuple:
        """SQL の `ORDER BY restaurants_with_usable_media DESC, s2_cell_id, category_id` と同じ鍵。"""
        s2_cell_id, category_id, count = row
        return (-count, s2_cell_id, category_id)

    def add_rows(self, rows) -> None:
        """1 バッチぶんの `(s2_cell_id, category_id, restaurants_with_usable_media)` を足す。"""
        for row in rows:
            _, category_id, count = row
            self.covered_total += 1
            entry = self._by_category.setdefault(category_id, [0, 0, 0])
            if count >= self.min_restaurants:
                self.covered_at_or_above_min += 1
                entry[1] += 1
            else:
                self.covered_below_min += 1
                entry[0] += 1
                self._shortfall.append(row)
            entry[2] = max(entry[2], count)
            self._top.append(row)
        # ⚠️ 上位 N だけ残して捨てる（全行を抱えない。dev では 600 万行オーダーになる）
        self._top = sorted(self._top, key=self._order_key)[: self.top_n]
        self._shortfall = sorted(self._shortfall, key=self._order_key)[: self.top_n]

    def top_cells(self) -> list[tuple]:
        return list(self._top)

    def shortfall_cells(self) -> list[tuple]:
        return list(self._shortfall)

    def shortfall_by_category(self) -> list[tuple]:
        """«惜しいセルを最も多く抱えているカテゴリ» 順。惜しいセルが 0 のカテゴリは出さない。"""
        rows = [
            (category_id, shortfall, covered, best)
            for category_id, (shortfall, covered, best) in self._by_category.items()
            if shortfall > 0
        ]
        return sorted(rows, key=lambda row: (-row[1], row[0]))[: self.top_n]
