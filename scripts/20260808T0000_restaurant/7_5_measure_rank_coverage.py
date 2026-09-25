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

from common_sns import (PROVIDER_INSTAGRAM,  # noqa: E402
                        TABLE_DISH_MEDIA_CATALOG, TABLE_POST_RAW,
                        TABLE_RESTAURANT_CATALOG,
                        TABLE_SOURCE_ACCOUNT, TABLE_ACCOUNT_ATTEMPT,
                        called_handles_sql, kpi_gate_category_sql)

LOGGER = logging.getLogger("7_5")


def _load_7_4():
    """物差しの定数を 7_4 から借りる（数字を 2 箇所に書かない）。"""
    spec = importlib.util.spec_from_file_location(
        "m74", HERE / "7_4_measure_neighborhood_313.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _base_cte_sql(ds: str, dish_ds: str, *, sample_n: int, radius_m: int) -> str:
    """«地点 × 配信店 × カテゴリ» を 1 度だけ展開する CTE 群（末尾は ``near``）。

    ⚠️ **ここが «5 店» の判定の土台である。** 合格線を測る `build_sql` と、
    脆さを測る `build_fragility_sql` の両方がこれを使う。
    書き写して 2 つにすると «測る側と配る側がずれる»（`post_store_cte_sql` と同じ規律）。
    """
    return f"""
    gate AS ({kpi_gate_category_sql(dish_ds, key_param=None)}),
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
    )
    """


def build_sql(ds: str, dish_ds: str, *, sample_n: int, sample_run: str, radius_m: int) -> str:
    """地点ごと・セルごとの生の行を返す（集計は Python 側でやる）。"""
    called_sql = called_handles_sql(f"{ds}.{TABLE_ACCOUNT_ATTEMPT}", f"{ds}.{TABLE_POST_RAW}",
                                    provider_param="prov")
    # ⚠️ 相関サブクエリで «その地点の 500m 圏» を数えない。BigQuery は
    #    「Correlated subqueries that reference other tables are not supported」で落ちる
    #    （2026-09-22 に踏んだ）。地点×店を 1 度 JOIN で展開してから GROUP BY する。
    return f"""
    WITH {_base_cte_sql(ds, dish_ds, sample_n=sample_n, radius_m=radius_m)},
    cell AS (
      SELECT point, cat, COUNT(DISTINCT store) AS stores
      FROM near GROUP BY point, cat
    ),
    -- その地点の «検索結果の量» = 500m 圏の配信店の異なり数（カテゴリ問わず）
    pt_stores AS (
      SELECT point, COUNT(DISTINCT store) AS stores_500m FROM near GROUP BY point
    ),
    -- ④ «手が届く» 店 = IG handle を既に持っていて、**まだ呼んでいない**もの。
    --    ⚠️ «呼んだ» の定義は common_sns.called_handles_sql が唯一の正。ここへ写経しない。
    --    2026-09-22、台帳（sns_account_attempt）だけで数えて «撃てる弾 123 店» と報告したが、
    --    実際に 4_2 が呼べたのは **20 件**だった（台帳は #1815 の途中からしか無い）。
    reachable AS (
      SELECT DISTINCT a.discovery_seed_place_id AS gpid
      FROM `{ds}.{TABLE_SOURCE_ACCOUNT}` a
      WHERE a.discovery_seed_place_id IS NOT NULL
        AND a.handle NOT IN ({called_sql})
    ),
    pt_reach AS (
      SELECT p.pid AS point, COUNT(DISTINCT s.google_place_id) AS reachable_500m
      FROM pts p
      JOIN store_loc s ON ST_DWithin(p.location, s.location, {int(radius_m)})
      JOIN reachable r ON r.gpid = s.google_place_id
      GROUP BY point
    ),
    -- ⑤ «ハンドルすら無い» 店 = 収集では届かないが、**発見（#1777 の巡回）なら届く**店。
    --    ④ が 0 の地点で «もう打つ手が無い» と言わないために数える。巡回の打率は約 36.8%。
    handled AS (
      SELECT DISTINCT discovery_seed_place_id AS gpid
      FROM `{ds}.{TABLE_SOURCE_ACCOUNT}` WHERE discovery_seed_place_id IS NOT NULL
    ),
    pt_nohandle AS (
      SELECT p.pid AS point, COUNT(DISTINCT s.google_place_id) AS no_handle_500m
      FROM pts p
      JOIN store_loc s ON ST_DWithin(p.location, s.location, {int(radius_m)})
      LEFT JOIN handled h ON h.gpid = s.google_place_id
      WHERE h.gpid IS NULL
      GROUP BY point
    ),
    -- ⑥ その地点の 500m 圏に **台帳として何軒あるか**（配信できているかは問わない）。
    --    #1947 «全部知っていて全部呼び終えた» 地点に対して «では何軒あるのか» を
    --    答えられないと、«薄い» が «あと少し» なのか «物理的に無理» なのか分けられない。
    --    5 店揃えるには最低 5 軒要るので、5 軒未満の地点は供給をいくら足しても達成できない。
    pt_all AS (
      SELECT p.pid AS point, COUNT(DISTINCT s.google_place_id) AS catalog_stores_500m
      FROM pts p
      JOIN store_loc s ON ST_DWithin(p.location, s.location, {int(radius_m)})
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
      IFNULL(pr.reachable_500m, 0) AS reachable_500m,
      IFNULL(pn.no_handle_500m, 0) AS no_handle_500m,
      IFNULL(pa.catalog_stores_500m, 0) AS catalog_stores_500m
    FROM pts p
    LEFT JOIN pt_stores ps ON ps.point = p.pid
    LEFT JOIN per_point pp ON pp.point = p.pid
    LEFT JOIN pt_reach pr ON pr.point = p.pid
    LEFT JOIN pt_nohandle pn ON pn.point = p.pid
    LEFT JOIN pt_all pa ON pa.point = p.pid
    """




def build_fragility_sql(ds: str, dish_ds: str, *, sample_n: int, radius_m: int) -> str:
    """達成しているセルが «投稿 1 本しか無い店» にどれだけ寄りかかっているかを数える。

    #1947 2026-09-24、配信中の埋め込みの **6.53% が既に削除済み**だと実測した。
    ところが `9_1`（配信）も `7_5`（合格線）も `7_4`（カバレッジ）も
    **死活を 1 度も見ていない**。つまり «5 店» の中に «開くと利用できません» が混ざりうる。

    ⚠️ 下がり幅は 6.53% ではない。投稿が 1 本死んでも、**その店に別の生きた投稿があれば
    店は残る**。落ちるのは «そのカテゴリで投稿が 1 本しか無い店» だけである。
    ここで数えるのは **最悪ケースの上限**（その手の店が全部死んだら何地点落ちるか）で、
    «たぶん小さい» を数字に変えるためのものである。

    判定（«5 店以上»・500m・134 カテゴリのゲート）は `_base_cte_sql` の 1 箇所を使う。
    """
    return f"""
    WITH {_base_cte_sql(ds, dish_ds, sample_n=sample_n, radius_m=radius_m)},
    -- その店がそのカテゴリで配信している «投稿の本数»。1 本なら、それが死ぬと店ごと落ちる。
    posts_per_store_cat AS (
      SELECT google_place_id AS store, dish_category_id AS cat,
             COUNT(DISTINCT external_content_id) AS posts
      FROM `{ds}.{TABLE_DISH_MEDIA_CATALOG}`
      WHERE run_id = @catalog_run_id
      GROUP BY store, cat
    ),
    cell AS (
      SELECT n.point, n.cat,
             COUNT(DISTINCT n.store) AS stores,
             COUNT(DISTINCT IF(IFNULL(pc.posts, 0) <= 1, n.store, NULL)) AS single_post_stores
      FROM near n
      LEFT JOIN posts_per_store_cat pc ON pc.store = n.store AND pc.cat = n.cat
      GROUP BY n.point, n.cat
    )
    -- ⚠️ 集計は Python 側でやる（この script の既定の形）。ここは «セルごとの生の行» まで。
    --    最悪ケースだけでなく **期待値**（死亡率 6.53%% での二項分布）も出したいので、
    --    セルごとの «余裕» と «1 本しか無い店の数» をそのまま返す。
    SELECT point, cat, stores, single_post_stores
    FROM cell WHERE stores >= 5
    """

def _deficit(pts: list[dict], *, top_pct: int, target_pct: int, quiet: bool = False) -> list[str]:
    """«上位 top_pct% の target_pct% を達成» に必要な «あと何店» を出し、**埋めるべき地点を返す**。

    合格線は地点単位（その地点で 5 店揃うカテゴリが 1 つ以上）なので、
    **未達地点ごとに «いちばん惜しいカテゴリ» の不足分だけ**を数える。
    1 地点に 1 カテゴリ作れば達成になるので、全カテゴリを埋める必要は無い。
    """
    log = (lambda *a: None) if quiet else LOGGER.info
    n = len(pts)
    k = max(1, round(n * top_pct / 100))
    band = pts[:k]                      # 既に «検索結果の量» の多い順に並んでいる前提
    ok = [p_ for p_ in band if p_["cats_ge5"] >= 1]
    ng = [p_ for p_ in band if p_["cats_ge5"] == 0]
    need_points = max(0, round(k * target_pct / 100) - len(ok))

    log("③ 合格線«上位 %d%% の %d%%» までの費用", top_pct, target_pct)
    log("  上位 %d%% = %d 地点 / 達成 %d 地点（%.1f%%）→ **あと %d 地点**",
                top_pct, k, len(ok), 100.0 * len(ok) / k, need_points)
    if not need_points:
        log("  → 既に達成している")
        return []

    # 未達地点を «いちばん惜しいカテゴリの不足店数» の小さい順に並べ、安い方から need_points 件
    costs = sorted((max(0, 5 - max(p_["cell_stores"], default=0)), p_["point"]) for p_ in ng)
    picked = costs[:need_points]
    if len(picked) < need_points:
        log("  ⚠️ 未達地点が %d 件しか無く、%d 件には届かない（この分母では達成不能）",
                    len(picked), need_points)
    total = sum(c for c, _ in picked)
    log("  安い順に %d 地点を埋めるのに必要な店数 = **%d 店**（1 地点あたり平均 %.1f 店）",
                len(picked), total, total / len(picked) if picked else 0)
    by_point = {p_["point"]: p_ for p_ in pts}
    # ⚠️ #1947 **天井は毎回出す。** «台帳が薄い» 分岐の中だけに置いていたので、
    #    薄い地点が 0 件のとき（＝ふつうの状態）に 1 度も出ずに終わっていた。
    #    KPI は «同じカテゴリで異なり 5 店» なので、500m 圏の台帳が 5 軒未満の地点は
    #    供給をいくら足しても達成できない。«あと 1 店» と «そもそも作れない» は別物である。
    dens_all = sorted(by_point[pid]["catalog_stores_500m"] for _, pid in picked)
    if dens_all:
        log("  未達 %d 地点の 500m 圏にある **台帳の店数**: 中央値 %d 軒 / 最小 %d 軒 / 最大 %d 軒"
            "（**5 軒未満＝供給をいくら足しても 5 店は作れない地点 = %d**）",
            len(dens_all), dens_all[len(dens_all) // 2], dens_all[0], dens_all[-1],
            sum(1 for d in dens_all if d < 5))
    reach = [by_point[pid]["reachable_500m"] for _, pid in picked]
    have = sum(1 for r in reach if r > 0)
    log("  **そのうち «まだ呼んでいない・手が届く店» が 500m 圏にある地点 = %d / %d**"
                "（合計 %d 店・中央値 %d 店）",
                have, len(picked), sum(reach), sorted(reach)[len(reach) // 2] if reach else 0)
    if have < len(picked):
        log("  ⚠️ 残り %d 地点は «撃てる弾が 1 つも無い»。収集では埋まらない", len(picked) - have)
        # ⚠️ «収集では埋まらない» で止めない。**次に何をすれば届くのか**まで出す。
        dry = [pid for _, pid in picked if by_point[pid]["reachable_500m"] == 0]
        nh = [by_point[pid]["no_handle_500m"] for pid in dry]
        with_nh = sum(1 for n in nh if n > 0)
        log("  → そのうち **«ハンドルすら無い店» が 500m 圏にある地点 = %d / %d**"
            "（合計 %d 店・中央値 %d 店）。巡回（#1777）で handle を掘れば届く",
            with_nh, len(dry), sum(nh), sorted(nh)[len(nh) // 2] if nh else 0)
        if with_nh < len(dry):
            exhausted = [pid for pid in dry if by_point[pid]["no_handle_500m"] == 0]
            # ⚠️ «薄い» で止めない。**何軒あるのか**まで出す。5 軒未満なら供給を足しても届かない。
            dens = sorted(by_point[pid]["catalog_stores_500m"] for pid in exhausted)
            hopeless = sum(1 for d in dens if d < 5)
            log("  ⚠️ さらに %d 地点は «500m 圏の店を全部知っていて、全部呼び終えた»。"
                "ここは店台帳そのものが薄い（発見でも収集でも届かない）", len(exhausted))
            if dens:
                log("     そのうち台帳が 5 軒未満（＝供給では届かない）= **%d / %d**"
                    "（中央値 %d 軒 / 最小 %d 軒）", hopeless, len(dens),
                    dens[len(dens) // 2], dens[0])

    hist: dict[int, int] = {}
    for c, _ in picked:
        hist[c] = hist.get(c, 0) + 1
    log("  内訳（その地点の «いちばん惜しいカテゴリ» にあと何店必要か）:")
    for c in sorted(hist):
        log("    あと %d 店: %d 地点", c, hist[c])
    log("  ⚠️ «その 500m 圏に、そのカテゴリで配信できる店が実在するか» は別問題。"
        "これは «閾値までの距離» であって «実現できる» ことの保証ではない")
    return [pid for _, pid in picked]


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


def fetch_points(pipeline, *, delivery_run_id: str, project: str = "food-scroll",
                 dataset: str = "restaurant_recommendation",
                 dish_dataset: str = "wikidata_food_graph") -> list[dict]:
    """313 地点それぞれの «配信店数 / 5 店カテゴリ数 / 撃てる弾の数» を返す。

    ⚠️ **この関数が物差しの唯一の入口**。呼び出し側で SQL を写経しない（#1947）。
    """
    from google.cloud import bigquery  # noqa: PLC0415  認証があるときだけ読む
    m74 = _load_7_4()
    sql = build_sql(f"{project}.{dataset}", f"{project}.{dish_dataset}",
                    sample_n=m74.SAMPLE_N, sample_run=m74.SAMPLE_CATALOG_RUN_ID,
                    radius_m=m74.RADIUS_M)
    rows = list(pipeline.execute(sql, [
        bigquery.ScalarQueryParameter("catalog_run_id", "STRING", delivery_run_id),
        bigquery.ScalarQueryParameter("sample_catalog_run_id", "STRING", m74.SAMPLE_CATALOG_RUN_ID),
        bigquery.ScalarQueryParameter("prov", "STRING", PROVIDER_INSTAGRAM),
    ]))
    return [{"point": r["point"], "stores_500m": int(r["stores_500m"] or 0),
             "cats_ge5": int(r["cats_ge5"] or 0), "cats_any": int(r["cats_any"] or 0),
             "cell_stores": [int(x) for x in (r["cell_stores"] or [])],
             "reachable_500m": int(r["reachable_500m"] or 0),
             "no_handle_500m": int(r["no_handle_500m"] or 0),
             # ⚠️ #1947 **SQL へ列を足したら、ここへも足すこと。** 2026-09-25、
             #   `catalog_stores_500m` を SELECT へ足してここへ足し忘れ、読み出し側の
             #   `.get(..., 0)` が黙って 0 を返して «未達 22 地点の台帳は 0 軒» という
             #   **その次の行と矛盾する数字**を出した（同じ地点に 1,458 店あると出ている）。
             #   落ちたら気づけるように、読み出し側は `.get` ではなく `[...]` を使う。
             "catalog_stores_500m": int(r["catalog_stores_500m"] or 0)} for r in rows]


def select_gap_points(pipeline, *, delivery_run_id: str, top_pct: int = 70,
                      target_pct: int = 70, reachable_only: bool = True,
                      quiet: bool = True, **kw) -> list[str]:
    """**合格線に足りない地点**（安い順）の google_place_id を返す。

    `4_2` が «この地点の 500m 圏の店だけ呼ぶ» ための入口。
    `reachable_only=True` なら «まだ呼んでいない handle が 500m 圏にある» 地点だけ返す
    （弾の無い地点を混ぜると «撃ったのに動かない» の原因が分からなくなる）。
    """
    pts = fetch_points(pipeline, delivery_run_id=delivery_run_id, **kw)
    if not pts or not any(p_["stores_500m"] for p_ in pts):
        raise SystemExit(
            f"配信カタログ run_id={delivery_run_id!r} が 500m 圏に 1 店も無い。測定不能である。")
    pts.sort(key=lambda x: -x["stores_500m"])
    picked = _deficit(pts, top_pct=top_pct, target_pct=target_pct, quiet=quiet)
    if not reachable_only:
        return picked
    reach = {p_["point"]: p_["reachable_500m"] for p_ in pts}
    return [pid for pid in picked if reach.get(pid, 0) > 0]


def main() -> int:
    p = argparse.ArgumentParser(description="検索結果の多い順に «5 店出る» 割合を測る。読み取りのみ")
    p.add_argument("--delivery-run-id", "--catalog-run-id", dest="delivery_run_id", required=True,
                   help="測る «配信» カタログの run_id（sns_dish_media_catalog.run_id）")
    p.add_argument("--project", default="food-scroll")
    p.add_argument("--dataset", default="restaurant_recommendation")
    p.add_argument("--dish-dataset", default="wikidata_food_graph")
    p.add_argument("--print-sql", action="store_true", help="SQL を出すだけ（接続しない）")
    p.add_argument("--dump-json", default=None, help="地点ごとの生データの書き出し先")
    p.add_argument("--emit-gap-points", action="store_true",
                   help="③ で選んだ «撃てる弾のある未達地点» の google_place_id を出す"
                        "（4_2 --gap-points-delivery-run-id が同じ判定を自分で呼ぶので、"
                        "これは人が確かめるため）")
    # #1947 配信中の 6.53% が既に削除済みなのに、9_1 / 7_5 / 7_4 は死活を見ていない。
    #       «下がり幅はたぶん小さい» を数字に変えるための計測。
    p.add_argument("--fragility", action="store_true",
                   help="達成しているセルのうち «投稿 1 本しか無い店» に寄りかかっている数を出す"
                        "（その手の店が全部死んだら何地点落ちるか＝最悪ケースの上限）")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    m74 = _load_7_4()
    # ⚠️ 7_4 と同じ取り違えガード。restaurant_catalog の run_id を渡すと全部 0 になる
    if args.delivery_run_id.startswith(m74.SAMPLE_CATALOG_PREFIX):
        raise SystemExit(
            f"--delivery-run-id に restaurant_catalog の run_id（{args.delivery_run_id!r}）が"
            f"渡されている。ここは «配信» の run_id（sns_dish_media_catalog.run_id）である。")

    ds = f"{args.project}.{args.dataset}"
    if args.print_sql:
        print(build_sql(ds, f"{args.project}.{args.dish_dataset}",
                        sample_n=m74.SAMPLE_N, sample_run=m74.SAMPLE_CATALOG_RUN_ID,
                        radius_m=m74.RADIUS_M))
        return 0

    from pipeline_common import BigQueryPipeline  # noqa: PLC0415
    pipeline = BigQueryPipeline()
    pts = fetch_points(pipeline, delivery_run_id=args.delivery_run_id, project=args.project,
                       dataset=args.dataset, dish_dataset=args.dish_dataset)

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
    picked = _deficit(pts, top_pct=70, target_pct=70)
    if args.emit_gap_points:
        reach = {p_["point"]: p_["reachable_500m"] for p_ in pts}
        shoot = [pid for pid in picked if reach.get(pid, 0) > 0]
        LOGGER.info("  ⚑ 撃てる弾のある未達地点 %d 件: %s", len(shoot), ",".join(shoot))

    mid = pts[len(pts) // 2]["stores_500m"]
    LOGGER.info("参考: 地点あたりの配信店数 最大 %d / 中央値 %d / 最小 %d",
                pts[0]["stores_500m"], mid, pts[-1]["stores_500m"])

    if args.fragility:
        _report_fragility(pipeline, ds, args, m74)

    if args.dump_json:
        Path(args.dump_json).write_text(json.dumps(pts, ensure_ascii=False), encoding="utf-8")
        LOGGER.info("地点ごとの生データ: %s", args.dump_json)
    return 0


def _report_fragility(pipeline, ds: str, args, m74) -> None:
    """«達成» が投稿 1 本に寄りかかっている量を出す。

    ⚠️ ここで出るのは **最悪ケースの上限**（1 本しか無い店が全部死んだ場合）。
       実際の死亡率は 6.53% なので、落ちる地点はこれよりずっと少ない。
       «上限» と言い切らずに «これだけ落ちる» と書かないこと。
    """
    from google.cloud import bigquery  # noqa: PLC0415
    rows = [dict(r) for r in pipeline.execute(
        build_fragility_sql(ds, f"{args.project}.{args.dish_dataset}",
                            sample_n=m74.SAMPLE_N, radius_m=m74.RADIUS_M), [
            bigquery.ScalarQueryParameter("sample_catalog_run_id", "STRING",
                                          m74.SAMPLE_CATALOG_RUN_ID),
            bigquery.ScalarQueryParameter("catalog_run_id", "STRING", args.delivery_run_id),
        ])]
    if not rows:
        return
    by_point: dict[str, list[tuple[int, int]]] = {}
    for r in rows:
        by_point.setdefault(r["point"], []).append(
            (int(r["stores"]), int(r["single_post_stores"])))
    achieving = len(by_point)
    cells = len(rows)
    worst_cells = sum(1 for st, sp in ((a, b) for v in by_point.values() for a, b in v)
                      if st - sp < 5)
    worst_points = sum(1 for v in by_point.values() if all(st - sp < 5 for st, sp in v))
    expected_points = sum(
        _prod(_cell_fall_probability(st, sp) for st, sp in v) for v in by_point.values())
    LOGGER.info("④ 死んだ埋め込みに対する «脆さ»（配信の %.2f%% が既に削除済み・実測）",
                100 * DEAD_SHARE)
    LOGGER.info("  達成している 地点 %d / セル %d", achieving, cells)
    LOGGER.info("  «投稿 1 本しか無い店» が全部落ちると 5 店を割るセル = **%d**", worst_cells)
    LOGGER.info("  → **最悪ケース**（その手の店が全部死んだ場合）に落ちる地点 = **%d / %d**",
                worst_points, achieving)
    LOGGER.info("  → **期待値**（死亡率 %.2f%% の二項分布）で落ちる地点 = **%.1f / %d**",
                100 * DEAD_SHARE, expected_points, achieving)
    LOGGER.info("  ⚠️ 最悪ケースは **上限**であって «これだけ落ちる» ではない。"
                "判断には期待値の方を使うこと")


#: 配信中の埋め込みの死亡率。`4_22_probe_embed_liveness.py` の実測（2026-09-24・1,500 投稿で
#: 98 件 = 6.53%、95% 信頼区間 5.3〜7.8%）。**推測値を置かない。** 測り直したら書き換える。
DEAD_SHARE = 0.0653


def _prod(xs) -> float:
    out = 1.0
    for x in xs:
        out *= x
    return out


def _cell_fall_probability(stores: int, single_post_stores: int,
                           dead_share: float = DEAD_SHARE) -> float:
    """そのセルが «5 店» を割る確率。

    投稿が 2 本以上ある店は、1 本死んでも残る（確率はごく小さいので 0 と見なす）。
    落ちうるのは «そのカテゴリで投稿が 1 本しか無い店» だけなので、
    **k 個の独立な試行のうち、余裕（stores - 5）を超えて死ぬ確率**になる。
    """
    slack = stores - 5
    k = min(single_post_stores, stores)
    if slack >= k:
        return 0.0
    # P(X > slack), X ~ Binomial(k, dead_share)
    from math import comb  # noqa: PLC0415
    tail = 0.0
    for i in range(slack + 1, k + 1):
        tail += comb(k, i) * (dead_share ** i) * ((1 - dead_share) ** (k - i))
    return min(1.0, tail)


if __name__ == "__main__":
    raise SystemExit(main())
