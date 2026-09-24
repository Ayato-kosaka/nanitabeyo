#!/usr/bin/env python3
"""#1947 合格線に足りない地点の 500m 圏で、**IG handle をまだ知らない店**を巡回対象にする。

## なぜこれが要るか

オーナーの合格条件は «検索結果の多い順に 70% くらいは最低でも 5 件出る»。
2026-09-22 の実測（`7_5` / カタログ `sns-2026-09-22-cat17`）:

| | |
| --- | ---: |
| 上位 70% = 219 地点のうち達成 | 120 地点（54.8%） |
| 足りない地点 | **33** |
| 必要な店数（いちばん惜しいカテゴリを 5 店にする） | **55 店** |
| そのうち «まだ呼んでいない handle» が 500m 圏にある地点 | **0 / 33** |
| **«ハンドルすら無い店» が 500m 圏にある地点** | **33 / 33（計 2,662 店）** |

**つまり合格線の律速は IG のクォータではない。** その 33 地点の近くには、呼べる handle が
1 つも残っていない。足りないのは **handle そのもの**である。巡回（#1777）の打率は約 36.8% なので、
2,662 店を巡れば 900 件前後の handle が出る見込みで、必要な 55 店に対して桁で余裕がある。

## この script がすること（IG のコールは 1 回も使わない）

1. **どの地点が足りないか**は `7_5.select_gap_points()` に聞く（判定を 2 箇所に書かない）
2. その 500m 圏で «IG handle を 1 つも知らない» 店を `restaurant_catalog` から拾う
3. `4_16.build_site_crawl_target_rows()` の行形式で `sns_site_crawl_target` へ書く（写経しない）

そのあと `4_4_crawl_official_site_igs.py --stores-run-id <この run_id>` が巡回する。

    python3 4_23_target_gap_point_stores.py --run-id gap-crawl-2026-09-22 \\
        --gap-points-delivery-run-id sns-2026-09-22-cat17
"""
from __future__ import annotations

import argparse
import importlib.util
import logging
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from common_sns import (TABLE_RESTAURANT_CATALOG,  # noqa: E402
                        TABLE_SITE_CRAWL_TARGET, TABLE_SOURCE_ACCOUNT,
                        TABLE_STORE_SITE_IG)
from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now  # noqa: E402

LOGGER = logging.getLogger(__name__)

# #1947 **一度巡って handle が出なかった店**。次の周回で «対象» に数え直さない。
#
# 2026-09-22〜23 の 3 周で巡回の打率が 36.8% → 20.5% → **10.9%** と半減し続けたのは、
# 相手が減ったからではなく **失敗した店を毎回また分母へ入れていた**からである
# （`handled` は «handle を知っている店» しか除いていなかった）。
# «巡回対象 N 店» が «これから掘れる N 店» を意味しなくなり、周回の見積もりが毎回外れた。
#
# ⚠️ `fetch_failed` は入れない。**相手側の一時的な失敗**なので、次の周回で撃ち直す価値がある
#    （#1815 と同じ «一時的な失敗を恒久的な失敗として扱わない» 規律）。
TERMINAL_CRAWL_STATUS = ("no_handle", "no_website", "robots_blocked", "website_is_ig")


def _crawled_cte(ds: str) -> str:
    """**もう巡って handle が出なかった店** の唯一の定義（`gpid` 1 列を返す SQL 片）。"""
    return f"""
      SELECT DISTINCT google_place_id AS gpid
      FROM `{ds}.{TABLE_STORE_SITE_IG}`
      WHERE status IN UNNEST(@terminal)
    """


def _load(fname: str, name: str):
    spec = importlib.util.spec_from_file_location(name, HERE / fname)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def build_sql(ds: str, *, radius_m: int) -> str:
    """足りない地点の 500m 圏で «handle を知らない・サイトがある» 店を返す。

    ⚠️ 座標は `7_5` と同じサンプルカタログ run から引く（別 run を混ぜると
    «2,662 店» と実際の対象がずれる）。
    """
    return f"""
    WITH pts AS (
      SELECT google_place_id AS pid, ANY_VALUE(location) AS location
      FROM `{ds}.{TABLE_RESTAURANT_CATALOG}`
      WHERE run_id = @geo_rid AND google_place_id IN UNNEST(@gap_pts)
      GROUP BY google_place_id
    ),
    stores AS (
      SELECT google_place_id, ANY_VALUE(name) AS name, ANY_VALUE(website) AS website,
             ANY_VALUE(location) AS location
      FROM `{ds}.{TABLE_RESTAURANT_CATALOG}`
      WHERE run_id = @geo_rid
      GROUP BY google_place_id
    ),
    -- handle を 1 つでも知っている店は巡回しない（#1777 の巡回は handle を «掘る» ため）
    handled AS (
      SELECT DISTINCT discovery_seed_place_id AS gpid
      FROM `{ds}.{TABLE_SOURCE_ACCOUNT}` WHERE discovery_seed_place_id IS NOT NULL
    ),
    -- 一度巡って handle が出なかった店も除く（定義は `_crawled_cte` の 1 箇所だけ）
    crawled AS ({_crawled_cte(ds)})
    SELECT s.google_place_id, s.name, s.website
    FROM stores s
    JOIN pts p ON ST_DWithin(p.location, s.location, {int(radius_m)})
    LEFT JOIN handled h ON h.gpid = s.google_place_id
    LEFT JOIN crawled c ON c.gpid = s.google_place_id
    WHERE h.gpid IS NULL AND c.gpid IS NULL
      AND s.website IS NOT NULL AND s.website != ''
    GROUP BY s.google_place_id, s.name, s.website
    """


def build_unreachable_sql(ds: str, *, radius_m: int) -> str:
    """**巡回では絶対に届かない店**（handle 未知 かつ 公式サイトが無い）を数える。

    «巡回対象が N 店» だけを報告すると «あと N 店あるから大丈夫» に読める。
    実際には巡回を一巡した時点でその N は 0 になり、**サイトの無い店だけが残る**。
    残りの大きさを一緒に出さないと «次にどの経路が要るか» の判断材料にならない。
    """
    return f"""
    WITH pts AS (
      SELECT google_place_id AS pid, ANY_VALUE(location) AS location
      FROM `{ds}.{TABLE_RESTAURANT_CATALOG}`
      WHERE run_id = @geo_rid AND google_place_id IN UNNEST(@gap_pts)
      GROUP BY google_place_id
    ),
    stores AS (
      SELECT google_place_id, ANY_VALUE(website) AS website, ANY_VALUE(location) AS location
      FROM `{ds}.{TABLE_RESTAURANT_CATALOG}`
      WHERE run_id = @geo_rid
      GROUP BY google_place_id
    ),
    handled AS (
      SELECT DISTINCT discovery_seed_place_id AS gpid
      FROM `{ds}.{TABLE_SOURCE_ACCOUNT}` WHERE discovery_seed_place_id IS NOT NULL
    ),
    crawled AS ({_crawled_cte(ds)}),
    near AS (
      SELECT DISTINCT s.google_place_id, s.website, c.gpid IS NOT NULL AS done
      FROM stores s
      JOIN pts p ON ST_DWithin(p.location, s.location, {int(radius_m)})
      LEFT JOIN handled h ON h.gpid = s.google_place_id
      LEFT JOIN crawled c ON c.gpid = s.google_place_id
      WHERE h.gpid IS NULL
    ),
    has_site AS (SELECT *, website IS NOT NULL AND website != '' AS site FROM near)
    SELECT
      COUNT(*) AS no_handle_total,
      COUNTIF(site) AS with_website,
      COUNTIF(NOT site) AS without_website,
      -- **もう巡ったが handle が出なかった**分。ここを分けないと «まだ N 店ある» と誤読する
      COUNTIF(site AND done) AS already_crawled,
      COUNTIF(site AND NOT done) AS crawlable_now
    FROM has_site
    """


def main() -> int:
    configure_logging()
    p = argparse.ArgumentParser(
        description="合格線に足りない地点の 500m 圏で handle 未知の店を巡回対象にする")
    p.add_argument("--run-id", default=None)
    p.add_argument("--gap-points-delivery-run-id", required=True,
                   help="sns_dish_media_catalog の run_id（どの地点が足りないかの基準）")
    p.add_argument("--gap-top-pct", type=int, default=70)
    p.add_argument("--gap-target-pct", type=int, default=70)
    p.add_argument("--project", default="food-scroll")
    p.add_argument("--dataset", default="restaurant_recommendation")
    p.add_argument("--dry-run", action="store_true", help="件数だけ出して書き込まない")
    args = p.parse_args()
    run_id = require_run_id(args.run_id)

    from google.cloud import bigquery  # noqa: PLC0415
    pipeline = BigQueryPipeline()
    m75 = _load("7_5_measure_rank_coverage.py", "m75")
    m416 = _load("4_16_target_near_cells.py", "m416")
    m74 = m75._load_7_4()

    # ⚠️ reachable_only=False。«撃てる弾がある地点» ではなく «足りない地点» 全部が対象である
    #    （弾が無いからこそ handle を掘りに行く）。
    points = m75.select_gap_points(pipeline, delivery_run_id=args.gap_points_delivery_run_id,
                                   top_pct=args.gap_top_pct, target_pct=args.gap_target_pct,
                                   reachable_only=False)
    LOGGER.info("合格線（上位 %d%% の %d%%）に足りない地点 = %d 件",
                args.gap_top_pct, args.gap_target_pct, len(points))
    if not points:
        raise SystemExit("足りない地点が 0 件（既に達成している）。巡回の対象も無い。")

    ds = f"{args.project}.{args.dataset}"
    rows = [dict(r) for r in pipeline.execute(
        build_sql(ds, radius_m=m74.RADIUS_M), [
            bigquery.ScalarQueryParameter("geo_rid", "STRING", m74.SAMPLE_CATALOG_RUN_ID),
            bigquery.ArrayQueryParameter("gap_pts", "STRING", points),
            bigquery.ArrayQueryParameter("terminal", "STRING", list(TERMINAL_CRAWL_STATUS)),
        ])]
    LOGGER.info("巡回対象（handle 未知・サイトあり・**まだ巡っていない**）= **%d 店**（半径 %dm）",
                len(rows), m74.RADIUS_M)

    # ⚠️ «巡回で届く分» だけを見て «まだ余地がある» と読まない。届かない分を必ず併記する。
    u = [dict(r) for r in pipeline.execute(build_unreachable_sql(ds, radius_m=m74.RADIUS_M), [
        bigquery.ScalarQueryParameter("geo_rid", "STRING", m74.SAMPLE_CATALOG_RUN_ID),
        bigquery.ArrayQueryParameter("gap_pts", "STRING", points),
        bigquery.ArrayQueryParameter("terminal", "STRING", list(TERMINAL_CRAWL_STATUS)),
    ])]
    if u:
        tot = int(u[0].get("no_handle_total") or 0)
        wo = int(u[0].get("without_website") or 0)
        LOGGER.info("  内訳: handle 未知 %d 店 = サイトあり %d ＋ **サイト無し %d**",
                    tot, int(u[0].get("with_website") or 0), wo)
        LOGGER.info("    サイトありの内訳: **これから巡れる %d** ＋ もう巡って handle が出なかった %d",
                    int(u[0].get("crawlable_now") or 0), int(u[0].get("already_crawled") or 0))
        LOGGER.info("  ⚠️ **サイト無しの %d 店には巡回が届かない。** 一巡したら別の経路が要る", wo)
    if not rows:
        raise SystemExit(
            "対象が 0 店。**«巡回しても無駄» ではなく «サイトを持つ handle 未知の店が無い»** である。"
            "ここは店台帳そのものが薄いので、発見でも収集でも届かない。")
    if args.dry_run:
        LOGGER.info("--dry-run のため書き込みません")
        return 0

    now_iso = utc_now().isoformat()
    target_rows = m416.build_site_crawl_target_rows(rows, run_id, now_iso)
    with pipeline.step(run_id, "4_23_target_gap_point_stores", parameters={
        "gap_points_delivery_run_id": args.gap_points_delivery_run_id,
        "points": len(points), "radius_m": m74.RADIUS_M,
    }, repo_root=None) as result:
        pipeline.execute(m416.CREATE_SITE_CRAWL_TARGET_SQL.replace(
            "__TABLE__", pipeline.table(TABLE_SITE_CRAWL_TARGET)))
        pipeline.delete_run_rows(TABLE_SITE_CRAWL_TARGET, run_id)
        n = pipeline.load_json_rows(TABLE_SITE_CRAWL_TARGET, target_rows)
        result["rows"] = n
    LOGGER.info("次: 4_4_crawl_official_site_igs.py --stores-run-id %s", run_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
