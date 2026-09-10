#!/usr/bin/env python3
"""#1947 アプリの検索フィードが **SNS 由来の外部埋め込みを実際に返しているか**を数える（読み取り専用）。

## 使い方（db-script-run.yml から）

    script_path: scripts/db-checks/measure_search_external_embed_share.py
    args: --schema dev
    requirements_path: scripts/20251213T0000_wikidata_food_graph/requirements.txt

    # 地点と半径を指定する（既定は 渋谷 / 梅田 / 金沢 の 3 地点・半径 500m）
    args: --schema dev --lat 35.659482 --lng 139.700553 --radius 500
    args: --schema dev --point "渋谷:35.659482,139.700553" --point "梅田:34.702485,135.495951"

    # 代表カテゴリを名指しで測る（既定は «半径内に在庫があるカテゴリ» を多い順に自動選択）
    args: --schema dev --category Q483163 --category Q1968435

    # 機械可読な出力
    args: --schema dev --out-json /tmp/embed_share.json

環境変数:
    DATABASE_URL … PostgreSQL 接続文字列（必須）

## 何を答えるスクリプトか

#1947 の最優先の未確認は «検索フィードで SNS 取り込みが再生される» が成立しているか、
つまり **アプリの検索が `render_type='external_embed'` の dish_media を実際に返しているか**
である。取り込みが保存できていることは分かっているが、**保存したものをユーザーが
検索フィードで受け取れているか**は誰も確かめていない（CLAUDE.md「「保存できた」は
納品条件ではなく、「保存したものをユーザーが使えた」が納品条件」）。

1 地点 × 1 カテゴリごとに次を出す。

| | 意味 |
| --- | --- |
| 返った行数 | 本番と同じクエリが実際に返した dish_media の行数 |
| うち外部埋め込み | その中で `render_type='external_embed'` だった行数と割合 |
| 異なり店数 | 返った行が指す restaurant の異なり数（外部埋め込みぶんも別に出す） |
| 半径内の在庫 | そもそも半径内に «使える» 投稿が何件あり、うち何件が外部埋め込みか |

**在庫と返却を並べて出すのが要**である。返却が 0 件でも、在庫が 0 なら
「まだ取り込みが足りない」、在庫が有るのに 0 なら「検索が落としている」で、
打つ手がまるで違う。片方だけ見て原因を決め打ちしないこと。

## ⚠️ 「カテゴリを指定しない場合」について

**本番の検索 API はカテゴリ必須である**（`SearchDishMediaDto.categoryId` は
`@IsString()` で optional ではない。SQL 側も `d.category_id = (SELECT category_id FROM params)`
で必ず 1 カテゴリへ絞る）。よって «カテゴリ指定なし» という経路はそもそも存在しない。

ここでは «カテゴリ指定なし» を **半径内に在庫があるカテゴリを全部まわして足し上げたもの**
として出す。これが «その地点でユーザーが取りうる全カテゴリを一通り開いたときに
何を受け取るか» に相当する。**独自の «カテゴリ無し SQL» は書かない**
（書いた瞬間に本番と違うものを測ることになる）。

## 判定を写経していないと言える理由

- 検索が返す行の判定は **1 行も書いていない**。
  `scripts/db-checks/sql/dish_media_search.sql` をそのまま実行している。
  このファイルは `api/src/v1/dish-media/dish-media-search-sql.spec.ts` が
  **実装の組み立て結果と一致することを機械検査している**自動生成物である
- 読み方とバインド値の並べ方は `dish_media_search_sql.py` から import する
  （`explain_dish_media_search.py` と共有。あちらは EXPLAIN、こちらは実行して数える）
- 「使える dish_media」の判定（在庫の数え方）も書かない。
  `dish_media_coverage_sql.usable_dish_media_conditions_sql()` 経由で
  `sql/usable_dish_media_conditions.sql`（正本 `usable-dish-media-filter.ts`）を読む
- 唯一この計測が自前で持つのは **`render_type='external_embed'` というラベル判定**だけで、
  これは判定ロジックではなく DB の CHECK 制約が持つ列挙値そのものである
  （`infra/supabase/migrations/20260824T0100_add_render_type_to_dish_media.sql`）。
  `test_measure_search_external_embed_share.py` が migration の CHECK と突き合わせている

## ⚠️ 1 回の実行結果を «割合» として読まないこと

本体クエリは最後に **Gumbel ノイズで並びを揺らして上位 limit 件だけ**返す
（`page_seed` × `user_id` × `dish_media_id` の安定乱数）。既定の limit は 5、
バケットは new / regional の 2 つなので、1 ページは最大 10 行しかない。
**1 ページぶんの «外部埋め込み 0 件» は «返っていない» の証拠にならない。**

そのため既定で `--pages` 回ぶん、決定的な page seed を変えて引き、
ページ横断で足し上げた数も出す。seed は固定文字列から作るので再実行で同じ結果になる。

## 読み取り専用である

SELECT しか実行しない。接続も readonly で張る。
接続先は **dev のみ**（`--schema` の選択肢に public を置いていない）。
本番を測るのはオーナーが `public` という語を自分から出したときだけであり、
そのときは別途指示を受ける（CLAUDE.md「DB を変更するときの規則」）。
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys

from dish_media_coverage_sql import usable_dish_media_conditions_sql
from dish_media_search_sql import DEFAULT_LIMIT, bind_search_params, load_search_sql

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

# dish_media.render_type の列挙値。判定ロジックではなく DB の CHECK 制約が持つ値そのもの。
# 正本: infra/supabase/migrations/20260824T0100_add_render_type_to_dish_media.sql
#       CHECK (render_type IN ('stored','external_embed'))
EXTERNAL_EMBED_RENDER_TYPE = "external_embed"
STORED_RENDER_TYPE = "stored"

# アプリの既定半径。app-expo/features/dishCategories/constants.ts の DEFAULT_SEARCH_RADIUS
DEFAULT_RADIUS_M = 500

# 既定で測る地点。«都心 / 大都市 / 地方都市» を 1 つずつ置く。
# 都心だけ測って «返っている» と言うと、地方で 0 件なことに気付けない。
DEFAULT_POINTS = (
    ("渋谷スクランブル交差点", 35.659482, 139.700553),
    ("大阪・梅田（大阪駅）", 34.702485, 135.495951),
    ("金沢駅（地方都市）", 36.578056, 136.647778),
)

# 半径内に在庫があるカテゴリを何個まで回すか。0 件のカテゴリは回しても 0 件なので回さない。
DEFAULT_MAX_CATEGORIES = 30

# 何ページぶん引くか（page seed を変えて引き直す回数）。上の «1 回の実行結果を…» の注記参照
DEFAULT_PAGES = 3

# page seed の素。固定なので再実行で同じ結果になる（Gumbel ノイズは seed の決定的関数）
PAGE_SEED_BASE = "measure-search-external-embed-share"

# 実在しなくてよい。疲労ペナルティ（直近 24h の impression）が
# 1 件も当たらない «初見のユーザー» を表す
SAMPLE_USER_ID = "11111111-1111-4111-8111-111111111111"


# ---------------------------------------------------------------------------
# 引数の解釈（純関数）
# ---------------------------------------------------------------------------


def parse_point(spec: str):
    """`ラベル:緯度,経度` または `緯度,経度` を (ラベル, lat, lng) にする。"""
    label, _, coords = spec.rpartition(":")
    parts = [p.strip() for p in coords.split(",")]
    if len(parts) != 2:
        raise ValueError(f"地点の書式が違う: {spec!r}（`ラベル:緯度,経度` で渡すこと）")
    try:
        lat, lng = float(parts[0]), float(parts[1])
    except ValueError:
        raise ValueError(f"緯度経度が数値でない: {spec!r}") from None
    if not -90 <= lat <= 90 or not -180 <= lng <= 180:
        raise ValueError(f"緯度経度が範囲外: {spec!r}")
    return (label.strip() or f"{lat},{lng}", lat, lng)


def resolve_points(point_specs, lat, lng):
    """`--point` と `--lat/--lng` と既定値から «測る地点» を決める。

    どちらも指定されなければ DEFAULT_POINTS。両方指定されたら両方測る。
    """
    points = [parse_point(spec) for spec in (point_specs or [])]
    if lat is not None or lng is not None:
        if lat is None or lng is None:
            raise ValueError("--lat と --lng は両方そろえて渡すこと")
        points.append((f"{lat},{lng}", lat, lng))
    return points or list(DEFAULT_POINTS)


def page_seeds(pages: int, base: str = PAGE_SEED_BASE):
    """決定的な page seed を作る。再実行で同じ結果になることが要（再現できない数字は使えない）。"""
    return [f"{base}:{i}" for i in range(1, pages + 1)]


# ---------------------------------------------------------------------------
# 集計（純関数）
# ---------------------------------------------------------------------------


def summarize(rows):
    """検索が返した行（(dish_media_id, restaurant_id, render_type) の列）を集計する。

    ⚠️ 割合の分母は «返った行数» である。0 件のときは «割合» が定義できないので None を返す。
       0.0 を返すと «返っているが外部埋め込みが 0%» と区別できなくなり、
       「まだ取り込みが足りない」と「検索が落としている」を取り違える。
    """
    total = len(rows)
    external = [r for r in rows if r[2] == EXTERNAL_EMBED_RENDER_TYPE]
    unknown = sorted(
        {r[2] for r in rows if r[2] not in (EXTERNAL_EMBED_RENDER_TYPE, STORED_RENDER_TYPE)}
    )
    return {
        "rows": total,
        "external_embed_rows": len(external),
        "external_embed_share": (len(external) / total) if total else None,
        "distinct_restaurants": len({r[1] for r in rows}),
        "distinct_external_embed_restaurants": len({r[1] for r in external}),
        "distinct_dish_media": len({r[0] for r in rows}),
        # CHECK 制約に無い値が出たら «この計測が知らない描画方法» が増えている。
        # 黙って stored 扱いに丸めると割合が静かに嘘になるので、必ず表に出す
        "unknown_render_types": unknown,
    }


def merge_summaries(summaries_with_rows):
    """カテゴリ横断（= «カテゴリ指定なし»）の集計。

    ⚠️ 割合は «割合の平均» ではなく «足した行数どうしの比» で出す。
       カテゴリごとの行数が違うので、平均を取ると小さいカテゴリが過大評価される。
    """
    rows = [r for _, rs in summaries_with_rows for r in rs]
    return summarize(rows)


def format_share(share):
    return "―" if share is None else f"{share * 100:6.1f}%"


# ---------------------------------------------------------------------------
# SQL の組み立て（判定は持たない。usable の条件は正本から読む）
# ---------------------------------------------------------------------------


def build_pool_sql() -> str:
    """半径内の «使える dish_media» を render_type 別に数える（= 在庫）。

    ⚠️ これは «検索が返すもの» ではなく «そもそも半径内にあるもの» である。
       検索の判定は本体 SQL がやる。ここは母数を出すためだけのもので、
       絞り込みは «半径内» と «使える» の 2 つしか持たない。
       «使える» の条件は usable-dish-media-filter.ts が正本（写経しない）。
    """
    return f"""
        SELECT
          dm.render_type,
          count(*)                        AS media_count,
          count(DISTINCT d.restaurant_id) AS restaurant_count,
          count(DISTINCT d.category_id)   AS category_count
        FROM restaurants r
        JOIN dishes d      ON d.restaurant_id = r.id
        JOIN dish_media dm ON dm.dish_id      = d.id
        WHERE ST_DWithin(
                r.location,
                ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                %s::double precision
              )
          {usable_dish_media_conditions_sql()}
        GROUP BY dm.render_type
        ORDER BY media_count DESC
    """


def build_categories_in_radius_sql() -> str:
    """半径内に在庫があるカテゴリを、投稿が多い順に並べる。

    «どのカテゴリを回すか» を決めるためだけのクエリ。ここでカテゴリを絞ることは
    検索の判定を変えない（回さなかったカテゴリは在庫 0 なので検索も 0 件）。
    """
    return f"""
        SELECT
          d.category_id,
          coalesce(dc.label_en, d.category_id) AS label,
          count(*) AS media_count,
          count(*) FILTER (WHERE dm.render_type = %s) AS external_embed_count
        FROM restaurants r
        JOIN dishes d      ON d.restaurant_id = r.id
        JOIN dish_media dm ON dm.dish_id      = d.id
        LEFT JOIN dish_categories dc ON dc.id = d.category_id
        WHERE ST_DWithin(
                r.location,
                ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                %s::double precision
              )
          {usable_dish_media_conditions_sql()}
        GROUP BY d.category_id, dc.label_en
        ORDER BY media_count DESC, d.category_id
    """


# 検索が返した dish_media_id に «描画方法» のラベルを貼るだけの引き当て。
# ⚠️ ここに条件を足さないこと。足した瞬間 «検索が返した行» ではなくなる
RENDER_TYPE_LOOKUP_SQL = """
    SELECT dm.id, dm.render_type
    FROM dish_media dm
    WHERE dm.id = ANY(%s::uuid[])
"""


# ---------------------------------------------------------------------------
# 実行
# ---------------------------------------------------------------------------


def fetch_search_rows(cur, sql, names, *, lat, lng, radius, category_id, limit, seed):
    """本番と同じクエリを 1 ページぶん実行し、(dish_media_id, restaurant_id, render_type) を返す。"""
    params = bind_search_params(
        names,
        user_id=SAMPLE_USER_ID,
        lat=lat,
        lng=lng,
        radius=radius,
        category_id=category_id,
        limit=limit,
        page_seed=seed,
    )
    # psycopg2 は %s を使うので $n を戻す。SQL 本体には手を入れない
    cur.execute(_to_pyformat(sql), params)
    columns = [c.name for c in cur.description]
    dish_media_idx = columns.index("dish_media_id")
    restaurant_idx = columns.index("restaurant_id")
    rows = [(str(r[dish_media_idx]), str(r[restaurant_idx])) for r in cur.fetchall()]
    if not rows:
        return []

    cur.execute(RENDER_TYPE_LOOKUP_SQL, ([r[0] for r in rows],))
    render_types = {str(i): t for i, t in cur.fetchall()}
    return [(dm, rest, render_types.get(dm)) for dm, rest in rows]


def _to_pyformat(sql: str) -> str:
    """`$1, $2 …` を psycopg2 の `%s` に戻す。

    `load_search_sql()` が `?` → `$n` にするのは «並び順を数えて検査する» ためで、
    実行するときは位置パラメータのまま %s で渡せばよい（順番は params.json のまま）。
    ⚠️ SQL 本体に `%` は現れない（現れたら psycopg2 が書式指定と誤読するので、
       ここで検出して止める）。
    """
    if "%" in sql:
        raise SystemExit(
            "❌ SQL に % が含まれている。psycopg2 の書式指定と衝突するので、"
            "そのままでは実行できない（実装側で % を使い始めたということなので、"
            "このスクリプトの渡し方を見直すこと）"
        )
    return re.sub(r"\$\d+", "%s", sql)


def measure_point(cur, sql, names, point, *, radius, limit, pages, categories, max_categories):
    label, lat, lng = point
    logger.info("")
    logger.info("=" * 78)
    logger.info("# %s（%.6f, %.6f）半径 %s m", label, lat, lng, f"{radius:,}")
    logger.info("=" * 78)

    # --- 在庫（母数）------------------------------------------------------
    cur.execute(build_pool_sql(), (lng, lat, radius))
    pool_rows = cur.fetchall()
    pool = {
        rt: {"media": m, "restaurants": rc, "categories": cc}
        for rt, m, rc, cc in pool_rows
    }
    pool_total = sum(v["media"] for v in pool.values())
    pool_external = pool.get(EXTERNAL_EMBED_RENDER_TYPE, {}).get("media", 0)
    logger.info("")
    logger.info("## 半径内の在庫（«使える dish_media»。検索を通す前の母数）")
    if pool_total == 0:
        logger.info("   0 件。この地点はそもそも投稿が無い")
    else:
        for rt, v in sorted(pool.items(), key=lambda kv: -kv[1]["media"]):
            logger.info(
                "   %-16s 投稿 %8s 件 / 店 %7s / カテゴリ %5s",
                rt,
                f'{v["media"]:,}',
                f'{v["restaurants"]:,}',
                f'{v["categories"]:,}',
            )
        logger.info(
            "   → 外部埋め込みは在庫の %s（%s / %s 件）",
            format_share(pool_external / pool_total).strip(),
            f"{pool_external:,}",
            f"{pool_total:,}",
        )

    # --- 回すカテゴリを決める --------------------------------------------
    cur.execute(
        build_categories_in_radius_sql(),
        (EXTERNAL_EMBED_RENDER_TYPE, lng, lat, radius),
    )
    in_radius = cur.fetchall()
    if categories:
        wanted = set(categories)
        targets = [row for row in in_radius if row[0] in wanted]
        missing = sorted(wanted - {row[0] for row in in_radius})
        for cid in missing:
            # 名指しされたカテゴリは在庫が無くても回す（«0 件だった» ことが答えになる）
            targets.append((cid, cid, 0, 0))
        truncated = 0
    else:
        targets = in_radius[:max_categories]
        truncated = max(0, len(in_radius) - max_categories)

    logger.info("")
    logger.info(
        "## 検索の実測（本番と同じ SQL・limit %s・page seed を %s 通り）", limit, pages
    )
    if truncated:
        # ⚠️ 黙って切らない。切ったことを書かないと «全部見た» と読まれる
        logger.info(
            "   ⚠️ 半径内に在庫のあるカテゴリ %s 件のうち、投稿の多い %s 件だけ回す"
            "（残り %s 件は測っていない。--max-categories で広げられる）",
            f"{len(in_radius):,}",
            f"{len(targets):,}",
            f"{truncated:,}",
        )
    if not targets:
        logger.info("   回すカテゴリが無い（半径内に在庫が 1 件も無い）")
        return {
            "label": label,
            "lat": lat,
            "lng": lng,
            "radius_m": radius,
            "pool": pool,
            "categories": [],
            "no_category": summarize([]),
        }

    logger.info("")
    logger.info(
        "   %-12s %-24s %6s %6s %8s %6s %6s",
        "category_id",
        "label",
        "在庫",
        "返却",
        "うち埋込",
        "割合",
        "店数",
    )
    logger.info("   " + "-" * 74)

    per_category = []
    all_rows = []
    for category_id, category_label, stock, stock_external in targets:
        rows = []
        for seed in page_seeds(pages):
            rows.extend(
                fetch_search_rows(
                    cur,
                    sql,
                    names,
                    lat=lat,
                    lng=lng,
                    radius=radius,
                    category_id=category_id,
                    limit=limit,
                    seed=seed,
                )
            )
        summary = summarize(rows)
        summary.update(
            {
                "category_id": category_id,
                "label": category_label,
                "stock_media": stock,
                "stock_external_embed_media": stock_external,
                "pages": pages,
            }
        )
        per_category.append(summary)
        all_rows.append((category_id, rows))
        logger.info(
            "   %-12s %-24.24s %6s %6s %8s %6s %6s%s",
            category_id,
            category_label,
            f"{stock:,}({stock_external:,})",
            f'{summary["rows"]:,}',
            f'{summary["external_embed_rows"]:,}',
            format_share(summary["external_embed_share"]).strip(),
            f'{summary["distinct_restaurants"]:,}',
            "  ⚠️ 在庫に埋込があるのに返っていない"
            if stock_external > 0 and summary["external_embed_rows"] == 0
            else "",
        )
        if summary["unknown_render_types"]:
            logger.info(
                "        ⚠️ 知らない render_type が返った: %s",
                ", ".join(summary["unknown_render_types"]),
            )

    no_category = merge_summaries(all_rows)
    logger.info("   " + "-" * 74)
    logger.info(
        "   %-37s %6s %8s %6s %6s",
        "【カテゴリ指定なし = 上の全カテゴリ合計】",
        f'{no_category["rows"]:,}',
        f'{no_category["external_embed_rows"]:,}',
        format_share(no_category["external_embed_share"]).strip(),
        f'{no_category["distinct_restaurants"]:,}',
    )
    logger.info(
        "   外部埋め込みを返した異なり店数: %s 店",
        f'{no_category["distinct_external_embed_restaurants"]:,}',
    )

    return {
        "label": label,
        "lat": lat,
        "lng": lng,
        "radius_m": radius,
        "pool": pool,
        "categories": per_category,
        "no_category": no_category,
        "categories_in_radius": len(in_radius),
        "categories_measured": len(targets),
        "categories_not_measured": truncated,
    }


def report_verdict(results):
    """«返っているのか» に 1 行で答える。数字の羅列で終わらせない。"""
    logger.info("")
    logger.info("=" * 78)
    logger.info("# 結論")
    logger.info("=" * 78)

    for r in results:
        pool_external = r["pool"].get(EXTERNAL_EMBED_RENDER_TYPE, {}).get("media", 0)
        returned = r["no_category"]["external_embed_rows"]
        if pool_external == 0:
            verdict = "在庫が 0 件（取り込みがこの地点に届いていない。検索の問題ではない）"
        elif returned == 0:
            verdict = (
                f"⚠️ 在庫 {pool_external:,} 件あるのに **1 件も返っていない**"
                "（検索が落としている疑い）"
            )
        else:
            verdict = (
                f"返っている（{returned:,} 行 / "
                f"{format_share(r['no_category']['external_embed_share']).strip()}）"
            )
        logger.info("  %-26.26s %s", r["label"], verdict)

    logger.info("")
    logger.info(
        "⚠️ «返っていない» が出た地点は、在庫の投稿 1 件を選んで "
        "usable-dish-media-filter.ts の 4 条件を 1 つずつ当てて原因を特定すること"
        "（media_processing_status / users.deleted_at / playback_status / deleted_at）。"
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    # ⚠️ public（本番）は選択肢に置かない。オーナーが public という語を自分から
    #    出したときにだけ触れる対象である（CLAUDE.md「DB を変更するときの規則」）
    parser.add_argument("--schema", default="dev", choices=["dev"])
    parser.add_argument("--lat", type=float, help="測る地点の緯度（--lng と対で渡す）")
    parser.add_argument("--lng", type=float, help="測る地点の経度（--lat と対で渡す）")
    parser.add_argument(
        "--point",
        action="append",
        dest="points",
        metavar="ラベル:緯度,経度",
        help="複数地点を測る。繰り返し指定できる",
    )
    parser.add_argument(
        "--radius",
        type=int,
        default=DEFAULT_RADIUS_M,
        help=f"検索半径（メートル）。既定 {DEFAULT_RADIUS_M}（アプリの DEFAULT_SEARCH_RADIUS）",
    )
    parser.add_argument(
        "--category",
        action="append",
        dest="categories",
        help="測るカテゴリ ID。省略すると半径内に在庫があるカテゴリを多い順に自動選択",
    )
    parser.add_argument(
        "--max-categories",
        type=int,
        default=DEFAULT_MAX_CATEGORIES,
        help=f"自動選択するカテゴリ数の上限。既定 {DEFAULT_MAX_CATEGORIES}",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_LIMIT,
        help=f"1 ページの返却件数。既定 {DEFAULT_LIMIT}（Remote Config の既定値）",
    )
    parser.add_argument(
        "--pages",
        type=int,
        default=DEFAULT_PAGES,
        help=f"page seed を変えて何ページぶん引くか。既定 {DEFAULT_PAGES}",
    )
    parser.add_argument("--out-json", help="結果を JSON で書き出す先")
    args = parser.parse_args()

    try:
        points = resolve_points(args.points, args.lat, args.lng)
    except ValueError as e:
        logger.error("❌ %s", e)
        return 1

    if args.pages < 1 or args.limit < 1:
        logger.error("❌ --pages と --limit は 1 以上で渡すこと")
        return 1

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    # psycopg2 はモジュール読み込み時ではなく main() の中で import する
    # （DB 不要のユニットテストを CI で回せるようにするため）
    import psycopg2

    sql, names = load_search_sql()

    results = []
    conn = psycopg2.connect(database_url)
    try:
        conn.set_session(readonly=True)
        with conn.cursor() as cur:
            cur.execute(f'SET search_path TO "{args.schema}", extensions')
            cur.execute("SELECT current_user, current_database()")
            user, database = cur.fetchone()
            logger.info(
                "接続先: user=%s db=%s schema=%s（読み取り専用）", user, database, args.schema
            )
            for point in points:
                results.append(
                    measure_point(
                        cur,
                        sql,
                        names,
                        point,
                        radius=args.radius,
                        limit=args.limit,
                        pages=args.pages,
                        categories=args.categories,
                        max_categories=args.max_categories,
                    )
                )
    finally:
        conn.close()

    report_verdict(results)

    if args.out_json:
        with open(args.out_json, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "schema": args.schema,
                    "radius_m": args.radius,
                    "limit": args.limit,
                    "pages": args.pages,
                    "points": results,
                },
                f,
                ensure_ascii=False,
                indent=2,
            )
        logger.info("")
        logger.info("JSON を書き出した: %s", args.out_json)

    return 0


if __name__ == "__main__":
    sys.exit(main())
