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
                        TABLE_DISH_MEDIA_CATALOG, TABLE_POST_RAW, TABLE_SOURCE_ACCOUNT,
                        called_handles_sql)

LOGGER = logging.getLogger("7_6")


def build_sql(ds: str, group_col: str = "run_id") -> str:
    """`group_col`（`run_id` = 発見経路 / `account_type` = アカウントの種類）ごとに数える。

    ⚠️ 2 つの見方を別々の SQL に書かない。同じ数え方でないと «経路で見た合計» と
    «種類で見た合計» が食い違い、どちらが正か分からなくなる。
    """
    if group_col not in ("run_id", "account_type"):
        raise ValueError(f"group_col は run_id か account_type のみ: {group_col!r}")
    key = f"IFNULL(ro.{group_col}, '(不明)')" if group_col == "account_type" else f"ro.{group_col}"
    called_sql = called_handles_sql(f"{ds}.{TABLE_ACCOUNT_ATTEMPT}", f"{ds}.{TABLE_POST_RAW}",
                                    provider_param="prov")
    src_key = (f"IFNULL({group_col}, '(不明)')" if group_col == "account_type" else group_col)
    return f"""
    WITH src AS (
      SELECT handle, run_id, discovery_method, account_type,
             ROW_NUMBER() OVER (PARTITION BY handle ORDER BY discovered_at, run_id) AS rn
      FROM `{ds}.{TABLE_SOURCE_ACCOUNT}`
      WHERE provider = @prov AND handle IS NOT NULL
    ),
    -- ⚠️ 1 handle = 1 経路。重複発見を両方に数えると合計が在庫を超える
    route AS (
      SELECT handle, run_id, discovery_method, account_type FROM src WHERE rn = 1
    ),
    -- ⚠️ «呼んだ» の定義は common_sns.called_handles_sql が唯一の正。ここへ写経しない。
    att AS ({called_sql}),
    raw AS (
      SELECT account_id AS handle, post_id
      FROM `{ds}.{TABLE_POST_RAW}` WHERE account_id IS NOT NULL
    ),
    -- ⚠️ 配信カタログ側の投稿キーは **external_content_id**（`post_id` ではない。
    --    9_1 が `external_content_id: r["post_id"]` として書いている）。
    cat AS (
      SELECT DISTINCT external_content_id AS post_id, google_place_id
      FROM `{ds}.{TABLE_DISH_MEDIA_CATALOG}` WHERE run_id = @cat_rid
    ),
    pair AS (
      SELECT {key} AS k, ro.handle, c.google_place_id
      FROM raw r JOIN cat c ON c.post_id = r.post_id
      JOIN route ro ON ro.handle = r.handle
    ),
    -- その店を連れてきた群が 1 つだけか（＝その群を止めたら失う店か）
    store_routes AS (
      SELECT google_place_id, COUNT(DISTINCT k) AS n_routes FROM pair GROUP BY 1
    ),
    posts AS (
      SELECT {key} AS k, COUNT(*) AS posts
      FROM raw r JOIN route ro ON ro.handle = r.handle GROUP BY 1
    ),
    stores AS (
      SELECT p.k,
             COUNT(DISTINCT p.google_place_id) AS delivered_stores,
             COUNT(DISTINCT IF(sr.n_routes = 1, p.google_place_id, NULL)) AS exclusive_stores
      FROM pair p JOIN store_routes sr USING (google_place_id)
      GROUP BY 1
    ),
    acc AS (
      SELECT {key} AS k,
             ANY_VALUE(ro.discovery_method) AS discovery_method,
             COUNT(DISTINCT ro.handle) AS discovered,
             COUNT(DISTINCT IF(a.handle IS NOT NULL, ro.handle, NULL)) AS attempted
      FROM route ro LEFT JOIN att a ON a.handle = ro.handle
      GROUP BY 1
    ),
    -- その群が登録した handle 全部（他が先に見つけていた分も含む）。
    -- «登録 − 新規» が重複ぶん。新しい経路が本当に射程を広げたかはここで分かる。
    registered AS (
      SELECT {src_key} AS k, COUNT(DISTINCT handle) AS registered
      FROM `{ds}.{TABLE_SOURCE_ACCOUNT}` WHERE provider = @prov AND handle IS NOT NULL
      GROUP BY 1
    )
    SELECT acc.k AS run_id, acc.discovery_method,
           IFNULL(registered.registered, 0) AS registered,
           acc.discovered, acc.attempted,
           IFNULL(posts.posts, 0) AS posts,
           IFNULL(stores.delivered_stores, 0) AS delivered_stores,
           IFNULL(stores.exclusive_stores, 0) AS exclusive_stores
    FROM acc
    LEFT JOIN registered USING (k)
    LEFT JOIN posts USING (k)
    LEFT JOIN stores USING (k)
    ORDER BY delivered_stores DESC
    """


def build_run_sql(ds: str) -> str:
    """**収集ラウンドごと**の «1 アカウントあたり配信店»。

    経路ごとの表（`build_sql`）は «その handle を最初に見つけた run» に成果を付けるので、
    «別経路が既に知っていた handle を、あるラウンドが初めて呼んだ» 場合、そのラウンドの
    働きは別経路の行に乗る。**«そのラウンドに quota を使って良かったか» はここで見る。**
    （2026-09-22: Foursquare 経路は 15,984 件を登録したが «最初に見つけた» のは 43 件で、
      実際に呼んだ 1,488 件の成果は他経路の行へ散っていた。）
    """
    return f"""
    WITH cat AS (
      SELECT DISTINCT external_content_id AS post_id, google_place_id
      FROM `{ds}.{TABLE_DISH_MEDIA_CATALOG}` WHERE run_id = @cat_rid
    ),
    raw AS (
      SELECT run_id, post_id, account_id
      FROM `{ds}.{TABLE_POST_RAW}` WHERE account_id IS NOT NULL
    ),
    pair AS (
      SELECT r.run_id, c.google_place_id FROM raw r JOIN cat c ON c.post_id = r.post_id
    ),
    store_runs AS (
      SELECT google_place_id, COUNT(DISTINCT run_id) AS n_runs FROM pair GROUP BY 1
    )
    SELECT raw.run_id,
           COUNT(DISTINCT raw.account_id) AS accounts,
           COUNT(DISTINCT raw.post_id) AS posts,
           COUNT(DISTINCT c.google_place_id) AS delivered_stores,
           COUNT(DISTINCT IF(sr.n_runs = 1, c.google_place_id, NULL)) AS exclusive_stores
    FROM raw
    LEFT JOIN cat c ON c.post_id = raw.post_id
    LEFT JOIN store_runs sr ON sr.google_place_id = c.google_place_id
    GROUP BY 1
    ORDER BY delivered_stores DESC
    """


def report_runs(rows: list[dict], *, top: int = 25) -> None:
    LOGGER.info("")
    LOGGER.info("■ 収集ラウンドごと（«このラウンドに quota を使って良かったか»）")
    LOGGER.info("%-34s %8s %9s %8s %8s %8s",
                "収集 run", "アカウント", "投稿", "配信店", "独占店", "店/アカ")
    for r in rows[:top]:
        acc = int(r["accounts"] or 0)
        per = (int(r["delivered_stores"] or 0) / acc) if acc else 0.0
        LOGGER.info("%-34s %8d %9d %8d %8d %8.2f", (r["run_id"] or "(不明)")[:34], acc,
                    int(r["posts"] or 0), int(r["delivered_stores"] or 0),
                    int(r["exclusive_stores"] or 0), per)
    if len(rows) > top:
        LOGGER.info("  …（配信店の多い順に %d 件まで。全 %d ラウンド）", top, len(rows))
    LOGGER.info("⚠️ «独占店» はそのラウンドだけが連れてきた店。重なる店は、そのラウンドを"
                "止めても他のラウンドが拾っている。")


def report(rows: list[dict], *, accounts_per_hour: float, label: str = "発見 run（経路）",
           with_burn: bool = True) -> None:
    """経路ごとの «1 アカウントあたり配信店» と «残りを撃ち切る時間» を出す。"""
    LOGGER.info("%-30s %8s %8s %8s %9s %8s %8s %8s",
                label, "登録", "新規", "呼んだ", "投稿", "配信店", "独占店", "店/アカ")
    tot = {k: 0 for k in ("registered", "discovered", "attempted", "posts",
                          "delivered_stores", "exclusive_stores")}
    for r in rows:
        for k in tot:
            tot[k] += int(r[k] or 0)
        per = (r["delivered_stores"] / r["attempted"]) if r["attempted"] else 0.0
        LOGGER.info("%-30s %8d %8d %8d %9d %8d %8d %8.2f",
                    (r["run_id"] or "(不明)")[:30], r["registered"], r["discovered"],
                    r["attempted"], r["posts"], r["delivered_stores"],
                    r["exclusive_stores"], per)
    per_all = (tot["delivered_stores"] / tot["attempted"]) if tot["attempted"] else 0.0
    LOGGER.info("%-30s %8d %8d %8d %9d %8d %8d %8.2f", "合計", tot["registered"],
                tot["discovered"], tot["attempted"], tot["posts"],
                tot["delivered_stores"], tot["exclusive_stores"], per_all)
    LOGGER.info("")
    LOGGER.info("⚠️ «配信店» は経路間で重なる（合計は異なり店の合計ではない）。"
                "止めてよいかは «独占店» で見る。")
    LOGGER.info("⚠️ «店/アカ» は **呼んだ** アカウントあたり。在庫あたりではない。")
    LOGGER.info("⚠️ «登録» はその run が入れた handle 全部、«新規» はその run が最初に見つけた分。"
                "差が大きい経路は、射程を広げずに同じ handle を入れ直しただけである。")
    LOGGER.info("⚠️ «呼んだ» は台帳（#1815 以降）＋投稿のある handle。**呼んで 1 枚も返さず、"
                "台帳より前だった handle は数えられない**（古い経路ほど過小になる）。")

    if not with_burn:
        return
    # 残弾を撃ち切るのに要る時間（群ごと）
    LOGGER.info("")
    LOGGER.info("残弾（在庫 − 呼んだ）を %.0f アカウント/時 で撃ち切るのに要る時間:", accounts_per_hour)
    for r in sorted(rows, key=lambda x: -(int(x["discovered"] or 0) - int(x["attempted"] or 0))):  # noqa: E501
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
    p.add_argument("--top-runs", type=int, default=25, help="収集ラウンドの表に出す件数")
    p.add_argument("--print-sql", action="store_true")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    sql = build_sql(f"{args.project}.{args.dataset}")
    if args.print_sql:
        print(sql)
        print(build_run_sql(f"{args.project}.{args.dataset}"))
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

    run_rows = [dict(r) for r in pipeline.execute(build_run_sql(f"{args.project}.{args.dataset}"), [
        bigquery.ScalarQueryParameter("cat_rid", "STRING", args.delivery_run_id),
    ])]
    report_runs(run_rows, top=args.top_runs)

    # ③ アカウントの種類ごと（«次の 1 コールを誰に使うか» の答えはここに出る）
    type_rows = [dict(r) for r in pipeline.execute(
        build_sql(f"{args.project}.{args.dataset}", "account_type"), [
            bigquery.ScalarQueryParameter("prov", "STRING", PROVIDER_INSTAGRAM),
            bigquery.ScalarQueryParameter("cat_rid", "STRING", args.delivery_run_id),
        ])]
    LOGGER.info("")
    LOGGER.info("■ アカウントの種類ごと（残弾の «質»）")
    report(type_rows, accounts_per_hour=args.accounts_per_hour, label="account_type")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
