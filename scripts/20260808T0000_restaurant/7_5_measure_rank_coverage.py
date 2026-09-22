#!/usr/bin/env python3
"""#1947 «検索結果の多い順に、何番まで 5 店が出るか» を測る。読み取りのみ。

## なぜこれが要るか

オーナーの合格条件（2026-09-22）:

> 検索結果多い順に 70% くらいは最低でも 5 件出てもらわないと困る

`7_4` は 313 地点を**均等に**扱う（`pct_zero`）。だが 313 地点は
`FARM_FINGERPRINT` で無作為に採った «飲食店のある場所» なので、
**渋谷も、店が 3 軒しかない町も同じ 1 票**になる。ユーザーは店が多い所に多く居るので、
«均等に見た全滅率» と «ユーザーが踏む確率» は別物である。

この script は **濃い順に並べたときの累積カバー率**を出す。
「上位 X% までなら条件を満たす」を直接答えるためのもの。

## 物差しは 7_4 と同一（写経しない）

地点の定義（313・`restaurant-2026-08-23`・`country_code='JP'`・FARM_FINGERPRINT 順）、
半径 500m、134 カテゴリのゲートは **`7_4` と `common_sns` から import する**。
ここで定義し直すと、2 つの物差しが静かにずれる。

## 2 つの見方を両方出す（どちらか一方では答えにならない）

| 見方 | 1 件 = | 「5 件出る」とは |
| --- | --- | --- |
| **セル** | 1 回の検索 = (地点 × カテゴリ) | そのカテゴリで 5 店返る |
| **地点** | 1 つの場所 | 5 店返るカテゴリが 1 つ以上ある |
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import logging
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from common_sns import (TABLE_DISH_MEDIA_CATALOG, TABLE_RESTAURANT_CATALOG,  # noqa: E402
                        TABLE_SOURCE_ACCOUNT, TABLE_ACCOUNT_ATTEMPT,
                        kpi_gate_category_sql)

LOGGER = logging.getLogger("7_5")


def _load_7_4():
    """物差しの定数を 7_4 から借りる（数字を 2 箇所に書かない）。"""
    spec = importlib.util.spec_from_file_location(
        "m74", HERE / "7_4_measure_neighborhood_313.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def build_sql(ds: str, dish_ds: str, *, sample_n: int, sample_run: str, radius_m: int) -> str:
    """地点ごと・セルごとの生の行を返す（集計は Python 側でやる）。"""
    # ⚠️ 相関サブクエリで «その地点の 500m 圏» を数えない。BigQuery は
    #    「Correlated subqueries that reference other tables are not supported」で落ちる
    #    （2026-09-22 に踏んだ）。地点×店を 1 度 JOIN で展開してから GROUP BY する。
    return f"""
    WITH gate AS ({kpi_gate_category_sql(dish_ds, key_param=None)}),
    pts AS (
      SELECT google_place_id AS pid, location
      FROM `{ds}.{TABLE_RESTAURANT_CATALOG}`
      WHERE run_id = @sample_catalog_run_id AND country_code = 'JP'
      ORDER BY FARM_FINGERPRINT(google_place_id) LIMIT {int(sample_n)}
    ),
    -- GEOGRAPHY は DISTINCT に置けないので «店の異なり» を取ってから座標を付ける
    store_loc AS (
      SELECT google_place_id, ANY_VALUE(location) AS location
      FROM `{ds}.{TABLE_RESTAURANT_CATALOG}`
      WHERE run_id = @sample_catalog_run_id
      GROUP BY google_place_id
    ),
    delivered AS (
      SELECT DISTINCT c.google_place_id AS pid, c.dish_category_id AS cat
      FROM `{ds}.{TABLE_DISH_MEDIA_CATALOG}` c
      JOIN gate g ON g.item_qid = c.dish_category_id
      WHERE c.run_id = @catalog_run_id
    ),
    -- 地点 × 配信店 × カテゴリ を 1 度だけ展開する（以降は全部ここから数える）
    near AS (
      SELECT p.pid AS point, d.pid AS store, d.cat AS cat
      FROM pts p
      JOIN delivered d ON TRUE
      JOIN store_loc s ON s.google_place_id = d.pid
      WHERE ST_DWithin(p.location, s.location, {int(radius_m)})
    ),
    cell AS (
      SELECT point, cat, COUNT(DISTINCT store) AS stores
      FROM near GROUP BY point, cat
    ),
    -- その地点の «検索結果の量» = 500m 圏の配信店の異なり数（カテゴリ問わず）
    pt_stores AS (
      SELECT point, COUNT(DISTINCT store) AS stores_500m FROM near GROUP BY point
    ),
    -- ④ «手が届く» 店 = IG handle を既に持っている（sns_source_account の seed）。
    --    «まだ呼んでいない» = sns_account_attempt に無い（#1970 で «候補 593 → 実弾 73» を
    --    外した反省。候補数と実弾を混同しない）。
    reachable AS (
      SELECT DISTINCT a.discovery_seed_place_id AS gpid
      FROM `{ds}.{TABLE_SOURCE_ACCOUNT}` a
      WHERE a.discovery_seed_place_id IS NOT NULL
        AND a.handle NOT IN (SELECT handle FROM `{ds}.{TABLE_ACCOUNT_ATTEMPT}`)
    ),
    pt_reach AS (
      SELECT p.pid AS point, COUNT(DISTINCT s.google_place_id) AS reachable_500m
      FROM pts p
      JOIN store_loc s ON ST_DWithin(p.location, s.location, {int(radius_m)})
      JOIN reachable r ON r.gpid = s.google_place_id
      GROUP BY point
    ),
    per_point AS (
      SELECT point,
             COUNTIF(stores >= 5) AS cats_ge5,
             COUNT(*) AS cats_any,
             ARRAY_AGG(stores ORDER BY stores DESC) AS cell_stores
      FROM cell GROUP BY point
    )
    SELECT
      p.pid AS point,
      IFNULL(ps.stores_500m, 0) AS stores_500m,
      IFNULL(pp.cats_ge5, 0) AS cats_ge5,
      IFNULL(pp.cats_any, 0) AS cats_any,
      IFNULL(pp.cell_stores, []) AS cell_stores,
      IFNULL(pr.reachable_500m, 0) AS reachable_500m
    FROM pts p
    LEFT JOIN pt_stores ps ON ps.point = p.pid
    LEFT JOIN per_point pp ON pp.point = p.pid
    LEFT JOIN pt_reach pr ON pr.point = p.pid
    """


def _deficit(pts: list[dict], *, top_pct: int, target_pct: int) -> None:
    """«上位 top_pct% の target_pct% を達成» に必要な «あと何店» を出す。

    合格線は地点単位（その地点で 5 店揃うカテゴリが 1 つ以上）なので、
    **未達地点ごとに «いちばん惜しいカテゴリ» の不足分だけ**を数える。
    1 地点に 1 カテゴリ作れば達成になるので、全カテゴリを埋める必要は無い。
    """
    n = len(pts)
    k = max(1, round(n * top_pct / 100))
    band = pts[:k]                      # 既に «検索結果の量» の多い順に並んでいる前提
    ok = [p_ for p_ in band if p_["cats_ge5"] >= 1]
    ng = [p_ for p_ in band if p_["cats_ge5"] == 0]
    need_points = max(0, round(k * target_pct / 100) - len(ok))

    LOGGER.info("③ 合格線«上位 %d%% の %d%%» までの費用", top_pct, target_pct)
    LOGGER.info("  上位 %d%% = %d 地点 / 達成 %d 地点（%.1f%%）→ **あと %d 地点**",
                top_pct, k, len(ok), 100.0 * len(ok) / k, need_points)
    if not need_points:
        LOGGER.info("  → 既に達成している")
        return

    # 未達地点を «いちばん惜しいカテゴリの不足店数» の小さい順に並べ、安い方から need_points 件
    costs = sorted((max(0, 5 - max(p_["cell_stores"], default=0)), p_["point"]) for p_ in ng)
    picked = costs[:need_points]
    if len(picked) < need_points:
        LOGGER.info("  ⚠️ 未達地点が %d 件しか無く、%d 件には届かない（この分母では達成不能）",
                    len(picked), need_points)
    total = sum(c for c, _ in picked)
    LOGGER.info("  安い順に %d 地点を埋めるのに必要な店数 = **%d 店**（1 地点あたり平均 %.1f 店）",
                len(picked), total, total / len(picked) if picked else 0)
    by_point = {p_["point"]: p_ for p_ in pts}
    reach = [by_point[pid]["reachable_500m"] for _, pid in picked]
    have = sum(1 for r in reach if r > 0)
    LOGGER.info("  **そのうち «まだ呼んでいない・手が届く店» が 500m 圏にある地点 = %d / %d**"
                "（合計 %d 店・中央値 %d 店）",
                have, len(picked), sum(reach), sorted(reach)[len(reach) // 2] if reach else 0)
    if have < len(picked):
        LOGGER.info("  ⚠️ 残り %d 地点は «撃てる弾が 1 つも無い»。収集では埋まらないので、"
                    "発見（#1777）か店台帳の拡張が要る", len(picked) - have)

    hist: dict[int, int] = {}
    for c, _ in picked:
        hist[c] = hist.get(c, 0) + 1
    LOGGER.info("  内訳（その地点の «いちばん惜しいカテゴリ» にあと何店必要か）:")
    for c in sorted(hist):
        LOGGER.info("    あと %d 店: %d 地点", c, hist[c])
    LOGGER.info("  ⚠️ «その 500m 圏に、そのカテゴリで配信できる店が実在するか» は別問題。"
                "これは «閾値までの距離» であって «実現できる» ことの保証ではない")


def _curve(label: str, flags: list[bool]) -> None:
    """濃い順に並んだ bool 列から «上位 X% の達成率» を出す。"""
    n = len(flags)
    if not n:
        LOGGER.info("%s: 対象 0 件", label)
        return
    LOGGER.info("%s（母数 %d）", label, n)
    LOGGER.info("  %-10s %10s %10s", "上位", "達成率", "件数")
    for pct in (10, 20, 30, 40, 50, 60, 70, 80, 90, 100):
        k = max(1, round(n * pct / 100))
        ok = sum(flags[:k])
        LOGGER.info("  %-10s %9.1f%% %10d", f"{pct}%", 100.0 * ok / k, k)
    # 70% を満たせる «上位何 %» までか
    best = 0
    for pct in range(1, 101):
        k = max(1, round(n * pct / 100))
        if 100.0 * sum(flags[:k]) / k >= 70.0:
            best = pct
    LOGGER.info("  → **達成率 70%% を保てるのは上位 %d%% まで**（%d 件）", best, max(1, round(n * best / 100)))


def main() -> int:
    p = argparse.ArgumentParser(description="検索結果の多い順に «5 店出る» 割合を測る。読み取りのみ")
    p.add_argument("--delivery-run-id", "--catalog-run-id", dest="delivery_run_id", required=True,
                   help="測る «配信» カタログの run_id（sns_dish_media_catalog.run_id）")
    p.add_argument("--project", default="food-scroll")
    p.add_argument("--dataset", default="restaurant_recommendation")
    p.add_argument("--dish-dataset", default="wikidata_food_graph")
    p.add_argument("--print-sql", action="store_true", help="SQL を出すだけ（接続しない）")
    p.add_argument("--dump-json", default=None, help="地点ごとの生データの書き出し先")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    m74 = _load_7_4()
    # ⚠️ 7_4 と同じ取り違えガード。restaurant_catalog の run_id を渡すと全部 0 になる
    if args.delivery_run_id.startswith(m74.SAMPLE_CATALOG_PREFIX):
        raise SystemExit(
            f"--delivery-run-id に restaurant_catalog の run_id（{args.delivery_run_id!r}）が"
            f"渡されている。ここは «配信» の run_id（sns_dish_media_catalog.run_id）である。")

    ds = f"{args.project}.{args.dataset}"
    sql = build_sql(ds, f"{args.project}.{args.dish_dataset}",
                    sample_n=m74.SAMPLE_N, sample_run=m74.SAMPLE_CATALOG_RUN_ID,
                    radius_m=m74.RADIUS_M)
    if args.print_sql:
        print(sql)
        return 0

    from google.cloud import bigquery  # noqa: PLC0415  認証があるときだけ読む
    from pipeline_common import BigQueryPipeline  # noqa: PLC0415
    pipeline = BigQueryPipeline()
    rows = list(pipeline.execute(sql, [
        bigquery.ScalarQueryParameter("catalog_run_id", "STRING", args.delivery_run_id),
        bigquery.ScalarQueryParameter("sample_catalog_run_id", "STRING", m74.SAMPLE_CATALOG_RUN_ID),
    ]))

    pts = [{"point": r["point"], "stores_500m": int(r["stores_500m"] or 0),
            "cats_ge5": int(r["cats_ge5"] or 0), "cats_any": int(r["cats_any"] or 0),
            "cell_stores": [int(x) for x in (r["cell_stores"] or [])],
            "reachable_500m": int(r["reachable_500m"] or 0)} for r in rows]

    # ⚠️ 判定器が «判定できたか» を先に言う。配信が 0 行なら «被覆 0» ではなく «測定不能»
    if not pts or not any(p_["stores_500m"] for p_ in pts):
        raise SystemExit(
            f"配信カタログ run_id={args.delivery_run_id!r} が 500m 圏に 1 店も無い。"
            f"測定不能であって «被覆 0» ではない。run_id を確かめること。")

    LOGGER.info("地点 %d / 半径 %dm / 配信=%s", len(pts), m74.RADIUS_M, args.delivery_run_id)

    # ① 地点の見方
    pts.sort(key=lambda x: -x["stores_500m"])
    _curve("① 地点を «検索結果の量»（500m 圏の配信店数）の多い順に並べ、5 店のカテゴリが 1 つ以上ある割合",
           [p_["cats_ge5"] >= 1 for p_ in pts])

    # ② セル（＝ 1 回の検索）の見方
    cells = sorted((s_ for p_ in pts for s_ in p_["cell_stores"]), reverse=True)
    _curve("② 検索（地点 × カテゴリ）を «返る店数» の多い順に並べ、5 店以上返る割合",
           [s_ >= 5 for s_ in cells])
    LOGGER.info("  ⚠️ ②の母数は «1 店以上返る検索» のみ（0 店の組み合わせは含まない。含めると分母は 313×134=41,942）")

    # ③ 合格線までの «あと何店» — オーナーの条件「上位 X% で Y% 達成」を満たす費用
    _deficit(pts, top_pct=70, target_pct=70)

    mid = pts[len(pts) // 2]["stores_500m"]
    LOGGER.info("参考: 地点あたりの配信店数 最大 %d / 中央値 %d / 最小 %d",
                pts[0]["stores_500m"], mid, pts[-1]["stores_500m"])

    if args.dump_json:
        Path(args.dump_json).write_text(json.dumps(pts, ensure_ascii=False), encoding="utf-8")
        LOGGER.info("地点ごとの生データ: %s", args.dump_json)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
