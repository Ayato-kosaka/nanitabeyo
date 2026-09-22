#!/usr/bin/env python3
"""#1947 «どの発見経路の handle が、1 アカウントあたり何店の配信店を生むか» を測る。読み取りのみ。

## なぜこれが要るか

柱1（IG 収集）の速度は **Meta アプリ 1 個あたり 205 アカウント/時**で固定されている。
速くできない以上、**どの handle にその 1 コールを使うか**が唯一動かせるレバーになる。

2026-09-22 に Foursquare 経由（#1777）で 15,984 件の handle を在庫へ足したが、
«燃料として良いのか» を測らずに撃ち始めていた。過去に **候補数と実弾を混同して
593 軒 → 実際 73 件** と外している（#1970）。**撃つ前に経路ごとの歩留まりを見る。**

## 数え方（ここを間違えると «良い経路» を取り違える）

- **1 handle は «最初に発見した run» に 1 回だけ数える**（複数経路で重複発見された
  handle を両方に数えると、合計が実態より大きくなる）。
- 分母は **«呼んだ» アカウント**（`sns_account_attempt`）であって、在庫の handle 数ではない。
  在庫を分母にすると «まだ呼んでいない経路» が不当に悪く見える。
- 成果は **配信カタログに載った異なり店**。`matched` ではない（matched は同じ店を
  何度も数える。KPI は異なり店の閾値関数である）。
- **exclusive_stores** = その経路の handle «だけ» が連れてきた店。他経路と重なる店は
  その経路を止めても失われないので、«止めてよいか» はこちらで判断する。
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from common_sns import (PROVIDER_INSTAGRAM, TABLE_ACCOUNT_ATTEMPT,  # noqa: E402
                        TABLE_DISH_MEDIA_CATALOG, TABLE_POST_RAW, TABLE_SOURCE_ACCOUNT)

LOGGER = logging.getLogger("7_6")


def build_sql(ds: str) -> str:
    return f"""
    WITH src AS (
      SELECT handle, run_id, discovery_method,
             ROW_NUMBER() OVER (PARTITION BY handle ORDER BY discovered_at, run_id) AS rn
      FROM `{ds}.{TABLE_SOURCE_ACCOUNT}`
      WHERE provider = @prov AND handle IS NOT NULL
    ),
    -- ⚠️ 1 handle = 1 経路。重複発見を両方に数えると合計が在庫を超える
    route AS (SELECT handle, run_id, discovery_method FROM src WHERE rn = 1),
    att AS (
      SELECT DISTINCT handle FROM `{ds}.{TABLE_ACCOUNT_ATTEMPT}` WHERE provider = @prov
    ),
    raw AS (
      SELECT account_id AS handle, post_id
      FROM `{ds}.{TABLE_POST_RAW}` WHERE account_id IS NOT NULL
    ),
    cat AS (
      SELECT DISTINCT post_id, google_place_id
      FROM `{ds}.{TABLE_DISH_MEDIA_CATALOG}` WHERE run_id = @cat_rid
    ),
    pair AS (
      SELECT ro.run_id, ro.handle, c.google_place_id
      FROM raw r JOIN cat c ON c.post_id = r.post_id
      JOIN route ro ON ro.handle = r.handle
    ),
    -- その店を連れてきた経路が 1 本だけか（＝その経路を止めたら失う店か）
    store_routes AS (
      SELECT google_place_id, COUNT(DISTINCT run_id) AS n_routes FROM pair GROUP BY 1
    ),
    posts AS (
      SELECT ro.run_id, COUNT(*) AS posts
      FROM raw r JOIN route ro ON ro.handle = r.handle GROUP BY 1
    ),
    stores AS (
      SELECT p.run_id,
             COUNT(DISTINCT p.google_place_id) AS delivered_stores,
             COUNT(DISTINCT IF(sr.n_routes = 1, p.google_place_id, NULL)) AS exclusive_stores
      FROM pair p JOIN store_routes sr USING (google_place_id)
      GROUP BY 1
    ),
    acc AS (
      SELECT ro.run_id,
             ANY_VALUE(ro.discovery_method) AS discovery_method,
             COUNT(DISTINCT ro.handle) AS discovered,
             COUNT(DISTINCT IF(a.handle IS NOT NULL, ro.handle, NULL)) AS attempted
      FROM route ro LEFT JOIN att a ON a.handle = ro.handle
      GROUP BY 1
    )
    SELECT acc.run_id, acc.discovery_method, acc.discovered, acc.attempted,
           IFNULL(posts.posts, 0) AS posts,
           IFNULL(stores.delivered_stores, 0) AS delivered_stores,
           IFNULL(stores.exclusive_stores, 0) AS exclusive_stores
    FROM acc
    LEFT JOIN posts USING (run_id)
    LEFT JOIN stores USING (run_id)
    ORDER BY delivered_stores DESC
    """


def report(rows: list[dict], *, accounts_per_hour: float) -> None:
    """経路ごとの «1 アカウントあたり配信店» と «残りを撃ち切る時間» を出す。"""
    LOGGER.info("%-34s %9s %9s %9s %9s %9s %9s",
                "発見 run（経路）", "在庫", "呼んだ", "投稿", "配信店", "独占店", "店/アカ")
    tot = {k: 0 for k in ("discovered", "attempted", "posts", "delivered_stores", "exclusive_stores")}
    for r in rows:
        for k in tot:
            tot[k] += int(r[k] or 0)
        per = (r["delivered_stores"] / r["attempted"]) if r["attempted"] else 0.0
        LOGGER.info("%-34s %9d %9d %9d %9d %9d %9.2f",
                    (r["run_id"] or "(不明)")[:34], r["discovered"], r["attempted"],
                    r["posts"], r["delivered_stores"], r["exclusive_stores"], per)
    per_all = (tot["delivered_stores"] / tot["attempted"]) if tot["attempted"] else 0.0
    LOGGER.info("%-34s %9d %9d %9d %9d %9d %9.2f", "合計", tot["discovered"], tot["attempted"],
                tot["posts"], tot["delivered_stores"], tot["exclusive_stores"], per_all)
    LOGGER.info("")
    LOGGER.info("⚠️ «配信店» は経路間で重なる（合計は異なり店の合計ではない）。"
                "止めてよいかは «独占店» で見る。")
    LOGGER.info("⚠️ «店/アカ» は **呼んだ** アカウントあたり。在庫あたりではない。")

    # 残弾を撃ち切るのに要る時間（経路ごと）
    LOGGER.info("")
    LOGGER.info("残弾（在庫 − 呼んだ）を %.0f アカウント/時 で撃ち切るのに要る時間:", accounts_per_hour)
    for r in sorted(rows, key=lambda x: -(int(x["discovered"] or 0) - int(x["attempted"] or 0))):
        left = int(r["discovered"] or 0) - int(r["attempted"] or 0)
        if left <= 0:
            continue
        per = (r["delivered_stores"] / r["attempted"]) if r["attempted"] else None
        est = f"配信店 +{left * per:,.0f} 見込み" if per is not None else "歩留まり未測定（1 度も呼んでいない）"
        LOGGER.info("  %-34s 残 %7d 件 = %6.1f 時間  （%s）",
                    (r["run_id"] or "(不明)")[:34], left, left / accounts_per_hour, est)


def main() -> int:
    p = argparse.ArgumentParser(description="発見経路ごとの «1 アカウントあたり配信店» を測る。読み取りのみ")
    p.add_argument("--delivery-run-id", "--catalog-run-id", dest="delivery_run_id", required=True,
                   help="測る «配信» カタログの run_id（sns_dish_media_catalog.run_id）")
    p.add_argument("--accounts-per-hour", type=float, default=205.0,
                   help="Meta アプリ 1 個あたりの実効スループット（既定 205）")
    p.add_argument("--project", default="food-scroll")
    p.add_argument("--dataset", default="restaurant_recommendation")
    p.add_argument("--print-sql", action="store_true")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    sql = build_sql(f"{args.project}.{args.dataset}")
    if args.print_sql:
        print(sql)
        return 0

    from google.cloud import bigquery  # noqa: PLC0415
    from pipeline_common import BigQueryPipeline  # noqa: PLC0415
    pipeline = BigQueryPipeline()
    rows = [dict(r) for r in pipeline.execute(sql, [
        bigquery.ScalarQueryParameter("prov", "STRING", PROVIDER_INSTAGRAM),
        bigquery.ScalarQueryParameter("cat_rid", "STRING", args.delivery_run_id),
    ])]
    # ⚠️ 判定器が «判定できたか» を先に言う。配信が 0 行なら «歩留まり 0» ではなく «測定不能»
    if not rows or not any(int(r["delivered_stores"] or 0) for r in rows):
        raise SystemExit(
            f"配信カタログ run_id={args.delivery_run_id!r} に紐づく投稿が 1 件も無い。"
            f"測定不能であって «歩留まり 0» ではない。run_id を確かめること。")
    report(rows, accounts_per_hour=args.accounts_per_hour)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
