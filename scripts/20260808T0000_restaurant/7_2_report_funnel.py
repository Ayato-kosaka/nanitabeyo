#!/usr/bin/env python3
"""#1273 収率ファネルと被覆サマリを Job Summary（標準出力）へ出す測定レポート。

テーブルは書かない（読み取りだけ）。フェーズAの «何割埋まるか» を人が読める形にする:
  収集 → resolve可 → matched（店+カテゴリ確定）の歩留まり、status 内訳、
  異なり店数、カバーしたカテゴリ数・市区町村数。
"""

from __future__ import annotations

import argparse
import logging

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id
from common_sns import TABLE_POST_RAW, TABLE_POST_RESOLVED, TABLE_COVERAGE

LOGGER = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="収率ファネルと被覆サマリを出す")
    p.add_argument("--run-id", default=None)
    return p.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()
    from google.cloud import bigquery
    prm = [bigquery.ScalarQueryParameter("rid", "STRING", run_id)]

    def one(sql):
        for r in pipeline.execute(sql, prm):
            return dict(r)
        return {}

    raw = one(f"SELECT COUNT(*) posts, COUNT(DISTINCT account_id) accounts, "
              f"COUNTIF(discovery_route='influencer') influencer, COUNTIF(discovery_route='store_account') store, "
              f"COUNTIF(discovery_route IN ('hashtag_search','search_api')) search "
              f"FROM `{pipeline.table(TABLE_POST_RAW)}` WHERE run_id=@rid")
    resolved = one(f"SELECT COUNT(*) resolved, COUNTIF(status='matched') matched, "
                   f"COUNT(DISTINCT IF(status='matched', google_place_id, NULL)) distinct_stores, "
                   f"COUNT(DISTINCT IF(status='matched', dish_category_id, NULL)) distinct_categories "
                   f"FROM `{pipeline.table(TABLE_POST_RESOLVED)}` WHERE run_id=@rid")
    status_rows = list(pipeline.execute(
        f"SELECT status, COUNT(*) n FROM `{pipeline.table(TABLE_POST_RESOLVED)}` "
        f"WHERE run_id=@rid GROUP BY status ORDER BY n DESC", prm))
    cov = one(f"SELECT COUNT(DISTINCT region) regions, COUNT(DISTINCT CONCAT(IFNULL(region,''),'|',IFNULL(city,''))) cities "
              f"FROM `{pipeline.table(TABLE_COVERAGE)}` WHERE run_id=@rid AND source_route='all'")

    posts = raw.get("posts") or 0
    resolved_n = resolved.get("resolved") or 0
    matched = resolved.get("matched") or 0

    def pct(a, b):
        return f"{(100.0*a/b):.1f}%" if b else "-"

    print("## SNS seed フェーズA 収率ファネル")
    print(f"- run_id: `{run_id}`")
    print(f"- 収集 posts: **{posts}**（アカウント {raw.get('accounts')}／influencer {raw.get('influencer')} · "
          f"store {raw.get('store')} · search {raw.get('search')}）")
    print(f"- resolve 済み: {resolved_n}")
    print(f"- **matched（店+カテゴリ確定）: {matched}**  歩留まり(対 resolved) {pct(matched, resolved_n)} / (対 posts) {pct(matched, posts)}")
    print(f"- 異なり店(google_place_id): **{resolved.get('distinct_stores')}**  カバー料理カテゴリ: {resolved.get('distinct_categories')}")
    print(f"- 被覆: 都道府県 {cov.get('regions')} / 市区町村 {cov.get('cities')}")
    print("\n### status 内訳")
    for r in status_rows:
        print(f"- {r['status']}: {r['n']}  ({pct(r['n'], resolved_n)})")

    LOGGER.info("funnel: posts=%d resolved=%d matched=%d distinct_stores=%s",
                posts, resolved_n, matched, resolved.get("distinct_stores"))


if __name__ == "__main__":
    main()
