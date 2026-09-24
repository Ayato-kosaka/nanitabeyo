#!/usr/bin/env python3
"""#1947 合格線に足りない地点の店を **店名で検索して** Instagram のアカウントを探す。

## なぜこれが要るか（2026-09-24 に確定した唯一の残り経路）

合格線（上位 70% の地点の 70% で 5 店）は **59.8% で止まっている**。
積み残し 20 万投稿を全部 resolve して配信店を +1,769 しても、**動いた地点は 0** だった。
KPI は地点ごとの閾値関数なので、«どこかの店» をいくら増やしても **その地点の 500m 圏**に
店が増えなければ 1 ミリも動かない。

残り 21 地点の 500m 圏には **handle を知らない店が 1,432 店**ある。その内訳と、
それぞれに届く経路:

| | 店 | 巡回（`4_4`） | 検索（この script） |
| --- | ---: | --- | --- |
| 公式サイトが無い | 943 | **届かない** | 届く |
| 巡回したが handle が出なかった | 489 | 尽きた（155 店試して 0 件） | 届く |

**巡回は «公式サイトがある店» しか辿れない。検索はサイトが無くても届く。**
だからここが最後の経路である。

## 何をするか

1. どの地点が足りないかは `7_5.select_gap_points()` に聞く（判定を 2 箇所に書かない）
2. その 500m 圏で «handle を知らない» 店を `4_23.build_sql(require_website=False)` で取る
   （**同じ «handle を知らない» の定義を使う**。分けると片方だけ直った状態ができる）
3. 1 店 1 クエリで «店名 住所 instagram» を検索し、`4_20.handles_from()` で handle を採る
4. 見つけた handle を **その店の place_id に紐づけて** `sns_query_candidate` へ書く

⚠️ **`--report-only` は SERPER を 1 回も呼ばない。** クエリ数と中身だけを出す。
   クレジットの判断材料はこれで作れるので、**承認前にここまで必ず済ませておく**。
"""
from __future__ import annotations

import argparse
import importlib.util
import logging
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from common_sns import PROVIDER_INSTAGRAM  # noqa: E402
from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now  # noqa: E402

LOGGER = logging.getLogger(__name__)

#: この経路の候補表。**influencer 探索の表と混ぜない**（`region` の意味が違う:
#: あちらは都道府県、こちらは «探していた店の place_id»）。
TABLE_STORE_QUERY_CANDIDATE = "sns_store_query_candidate"

#: 1 店につき投げるクエリ。**1 店 1 クエリに保つ**（クレジットは店数ぶんだけ、と言い切れる形）。
QUERY_TEMPLATE = "{name} {area} instagram"

#: 住所は «都道府県＋市区町村» までで十分。番地まで入れると検索がヒットしなくなる。
AREA_MAX_CHARS = 12


def _load(fname: str, name: str):
    spec = importlib.util.spec_from_file_location(name, HERE / fname)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


#: 住所を切ったときに末尾へ残る区切り文字。«六本木1-4-» のような尻切れは検索を悪くする。
_TRAILING_SEPARATORS = " \t-ー−‐–—,、．.・/／"


def build_query(name: str, address: str | None) -> str:
    """«店名 地域 instagram» を組む。地域は住所の頭だけ使う。

    ⚠️ 番地・建物名まで入れると 0 件になる（検索語が具体的すぎる）。
    ⚠️ 住所が無いときに空白を二重にしない／切った末尾に «-» を残さない。
       どちらも検索語としては «別のクエリ» になり、打率の実測がぶれる。
    """
    area = (address or "")[:AREA_MAX_CHARS].strip().rstrip(_TRAILING_SEPARATORS)
    parts = [p for p in ((name or "").strip(), area, "instagram") if p]
    return " ".join(parts)


def candidate_rows(found, *, run_id: str, now_iso: str):
    """`(place_id, query, handle, 由来, 順位)` の並び → `sns_query_candidate` の行。

    ⚠️ **`region` に place_id を入れる。** この経路の «どこで見つけたか» は都道府県ではなく
       «どの店を探していたか» である。ここを空にすると、せっかく店に紐づいた handle が
       ただの handle に戻り、合格線の地点へ撃ち返せなくなる。
    """
    rows = []
    for place_id, query, handle, extracted_from, rank in found:
        if not handle:
            continue
        rows.append({
            "handle": handle,
            "provider": PROVIDER_INSTAGRAM,
            "region": place_id,
            "query": query,
            "extracted_from": extracted_from,
            "result_rank": rank,
            "found_at": now_iso,
            "run_id": run_id,
        })
    return rows


def main() -> int:
    configure_logging()
    p = argparse.ArgumentParser(
        description="合格線に足りない地点の店を店名で検索して Instagram を探す")
    p.add_argument("--run-id", default=None)
    p.add_argument("--gap-points-delivery-run-id", required=True,
                   help="sns_dish_media_catalog の run_id（どの地点が足りないかの基準）")
    p.add_argument("--gap-top-pct", type=int, default=70)
    p.add_argument("--gap-target-pct", type=int, default=70)
    p.add_argument("--max-queries", type=int, default=None,
                   help="投げるクエリ数の上限（= 使うクレジット数）。省略すると全店")
    p.add_argument("--report-only", action="store_true",
                   help="**SERPER を 1 回も呼ばない。** クエリ数と中身だけ出す")
    p.add_argument("--num", type=int, default=10, help="1 クエリの取得件数（SERPER 無料は最大 10）")
    p.add_argument("--sleep-ms", type=int, default=1200, help="呼び出し間隔（無料枠に配慮）")
    p.add_argument("--project", default="food-scroll")
    p.add_argument("--dataset", default="restaurant_recommendation")
    args = p.parse_args()
    run_id = require_run_id(args.run_id)

    from google.cloud import bigquery  # noqa: PLC0415
    pipeline = BigQueryPipeline()
    m75 = _load("7_5_measure_rank_coverage.py", "m75")
    m423 = _load("4_23_target_gap_point_stores.py", "m423")
    m74 = m75._load_7_4()

    points = m75.select_gap_points(pipeline, delivery_run_id=args.gap_points_delivery_run_id,
                                   top_pct=args.gap_top_pct, target_pct=args.gap_target_pct,
                                   reachable_only=False)
    LOGGER.info("合格線（上位 %d%% の %d%%）に足りない地点 = %d 件",
                args.gap_top_pct, args.gap_target_pct, len(points))
    if not points:
        raise SystemExit("足りない地点が 0 件（既に達成している）。探す対象も無い。")

    ds = f"{args.project}.{args.dataset}"
    stores = [dict(r) for r in pipeline.execute(
        # ⚠️ require_website=False。検索はサイトが無い店にも届くので、ここで絞ると
        #    943 店（この地点群の handle 未知の 65%）を最初から捨てることになる。
        m423.build_sql(ds, radius_m=m74.RADIUS_M, require_website=False), [
            bigquery.ScalarQueryParameter("geo_rid", "STRING", m74.SAMPLE_CATALOG_RUN_ID),
            bigquery.ArrayQueryParameter("gap_pts", "STRING", points),
            bigquery.ArrayQueryParameter("terminal", "STRING", list(m423.TERMINAL_CRAWL_STATUS)),
            bigquery.ScalarQueryParameter("dead_site_re", "STRING", m423.DEAD_SITE_ERROR_RE),
            bigquery.ScalarQueryParameter("max_attempts", "INT64", m423.MAX_FETCH_ATTEMPTS),
        ])]
    queries = [(s["google_place_id"], build_query(s.get("name"), s.get("address")))
               for s in stores if (s.get("name") or "").strip()]
    if args.max_queries:
        queries = queries[:args.max_queries]

    LOGGER.info("handle を知らない店 = %d 店 / **投げるクエリ = %d 件**（1 店 1 クエリ）",
                len(stores), len(queries))
    no_site = sum(1 for s in stores if not (s.get("website") or "").strip())
    LOGGER.info("  うち公式サイトが無い（巡回では届かない）= **%d 店**", no_site)
    for _, q in queries[:5]:
        LOGGER.info("  例: %s", q)
    if args.report_only:
        LOGGER.info("--report-only のため SERPER は呼びません（クレジット消費 0）")
        return 0

    import os  # noqa: PLC0415
    import time  # noqa: PLC0415
    key = os.environ.get("SERPER_API_KEY")
    if not key:
        raise SystemExit("SERPER_API_KEY が無い。**クレジットの承認が要る経路**である。")
    m420 = _load("4_20_search_influencer_accounts.py", "m420")
    m420.ensure_table(pipeline, TABLE_STORE_QUERY_CANDIDATE)
    found = []
    for i, (place_id, q) in enumerate(queries, start=1):
        result = m420.serper_search(key, q, num=args.num)
        for handle, extracted_from, rank in m420.handles_from(result):
            found.append((place_id, q, handle, extracted_from, rank))
        if i % 100 == 0:
            LOGGER.info("  %d/%d クエリ（候補 %d 件）", i, len(queries), len(found))
        if args.sleep_ms:
            time.sleep(args.sleep_ms / 1000.0)
    rows = candidate_rows(found, run_id=run_id, now_iso=utc_now().isoformat())
    hit_stores = len({r["region"] for r in rows})
    LOGGER.info("handle 候補 %d 件 / handle が出た店 %d / %d（打率 **%.1f%%**）",
                len(rows), hit_stores, len(queries),
                100.0 * hit_stores / len(queries) if queries else 0.0)
    if not rows:
        LOGGER.warning("⚠️ 1 件も出ませんでした。**この経路も閉じた**ということです。")
        return 0
    with pipeline.step(run_id, "4_24_search_store_handles", parameters={
        "gap_points_delivery_run_id": args.gap_points_delivery_run_id,
        "points": len(points), "queries": len(queries),
    }, repo_root=None) as result:
        result["rows"] = pipeline.load_json_rows(TABLE_STORE_QUERY_CANDIDATE, rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
