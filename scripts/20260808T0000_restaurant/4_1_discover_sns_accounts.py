#!/usr/bin/env python3
"""#1273 収集ルート1/2: SNS 収集元アカウントを sns_source_account へ入れる。

--source で 3 経路（外部 API 不要・無料）:
  influencer_list    … グルメインフルエンサーの handle 一覧（seed ファイル）を取り込む（ルート2）
  open_data_socials  … restaurant_catalog.social_urls の instagram を店アカウントとして取り込む（ルート1）
  official_site_crawl… 4_4 が作った sns_store_site_ig（店公式サイト crawl の店固有 IG）を合流（柱1）

いずれも「アカウントを見つける」だけ。投稿の収集は 4_2、店舗照合は resolve（このスクリプトはしない）。
SERPER でハンドルを探すルート1の補完（serper_account）は 4_1b で別途。
"""

from __future__ import annotations

import argparse
import logging
import re
from datetime import date
from pathlib import Path

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now
from common_sns import PROVIDER_INSTAGRAM, TABLE_SOURCE_ACCOUNT, TABLE_STORE_SITE_IG

LOGGER = logging.getLogger(__name__)
HERE = Path(__file__).resolve().parent

# instagram.com/<handle> からハンドルを取り出す。投稿・機能パスは除外する。
_IG_HANDLE_RE = re.compile(r"instagram\.com/([A-Za-z0-9_.]+)", re.IGNORECASE)
_NON_ACCOUNT = {
    "p", "reel", "reels", "tv", "explore", "stories", "s", "accounts",
    "about", "developer", "legal", "directory",
}


def _extract_handle(url: str) -> str | None:
    m = _IG_HANDLE_RE.search(url or "")
    if not m:
        return None
    handle = m.group(1).strip(".").lower()
    if not handle or handle in _NON_ACCOUNT:
        return None
    return handle


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="SNS 収集元アカウントを収集する（ルート1/2）")
    p.add_argument("--run-id", default=None)
    p.add_argument("--source", required=True,
                   choices=["influencer_list", "open_data_socials", "official_site_crawl"])
    p.add_argument("--handles-file", default=str(HERE / "sns_influencer_seed_handles.txt"),
                   help="influencer_list 用。1 行 1 handle")
    p.add_argument("--catalog-run-id", default=None,
                   help="open_data_socials 用。読む restaurant_catalog の run_id（省略時は最新）")
    p.add_argument("--crawl-run-id", default=None,
                   help="official_site_crawl 用。読む sns_store_site_ig の run_id（省略時は --run-id と同じ）")
    p.add_argument("--limit", type=int, default=None, help="open_data_socials の上限（動作確認用）")
    return p.parse_args()


def _rows_from_influencer_list(path: Path, run_id: str, now):
    handles = []
    for line in path.read_text(encoding="utf-8").splitlines():
        h = line.strip().lstrip("@").lower()
        if h and not h.startswith("#"):
            handles.append(h)
    seen = set()
    for h in handles:
        if h in seen:
            continue
        seen.add(h)
        yield {
            "account_id": h, "provider": PROVIDER_INSTAGRAM, "handle": h,
            "account_type": "influencer", "discovery_method": "influencer_list",
            "discovery_seed_place_id": None, "followers": None, "media_count": None,
            "discovered_at": now.isoformat(), "run_id": run_id,
        }


def _latest_catalog_run_id(pipeline: BigQueryPipeline) -> str:
    sql = f"SELECT run_id FROM `{pipeline.table('restaurant_catalog')}` GROUP BY run_id ORDER BY MAX(_PARTITIONTIME) DESC LIMIT 1"
    try:
        for row in pipeline.execute(sql):
            return row["run_id"]
    except Exception:  # _PARTITIONTIME が無い catalog もあるので run_id 単独で拾い直す
        for row in pipeline.execute(
            f"SELECT run_id, COUNT(*) c FROM `{pipeline.table('restaurant_catalog')}` GROUP BY run_id ORDER BY c DESC LIMIT 1"
        ):
            return row["run_id"]
    raise RuntimeError("restaurant_catalog に run_id が見つかりません。")


def _rows_from_open_data(pipeline: BigQueryPipeline, catalog_run_id: str, limit, run_id: str, now):
    from google.cloud import bigquery
    limit_sql = f"LIMIT {int(limit)}" if limit else ""
    sql = f"""
      SELECT google_place_id, social_urls
      FROM `{pipeline.table('restaurant_catalog')}`
      WHERE run_id = @crid
        AND EXISTS (SELECT 1 FROM UNNEST(social_urls) u WHERE LOWER(u) LIKE '%instagram.com/%')
      {limit_sql}
    """
    params = [bigquery.ScalarQueryParameter("crid", "STRING", catalog_run_id)]
    # #1273 チェーン除去: 同じ handle が複数 google_place_id に付いていたら «チェーン公式»で、
    # 特定の1店に紐付けると誤帰属になる（official_site_crawl の _store_branch_rows と同じ規律）。
    # 先に (handle → place_id 集合) を作り、**1店だけに付く handle** のみ store_branch にする。
    handle_to_pids: dict[str, set[str]] = {}
    for row in pipeline.execute(sql, params):
        for u in row["social_urls"] or []:
            handle = _extract_handle(u)
            if handle:
                handle_to_pids.setdefault(handle, set()).add(row["google_place_id"])
    dropped_chain = 0
    for handle, pids in handle_to_pids.items():
        if len(pids) >= 2:
            dropped_chain += 1
            continue
        yield {
            "account_id": handle, "provider": PROVIDER_INSTAGRAM, "handle": handle,
            "account_type": "store_branch", "discovery_method": "open_data_socials",
            "discovery_seed_place_id": next(iter(pids)),
            "followers": None, "media_count": None,
            "discovered_at": now.isoformat(), "run_id": run_id,
        }
    LOGGER.info("open_data_socials: 店固有 handle %d、チェーン除外 %d",
                sum(1 for h, p in handle_to_pids.items() if len(p) < 2), dropped_chain)


def _delete_source_rows(pipeline: BigQueryPipeline, run_id: str, source: str) -> int:
    """この run_id × discovery_method(=source) の行だけを消す（相乗り source を巻き込まない）。"""
    from google.cloud import bigquery
    sql = (
        f"DELETE FROM `{pipeline.table(TABLE_SOURCE_ACCOUNT)}` "
        f"WHERE run_id = @rid AND discovery_method = @dm"
    )
    job = pipeline.client.query(
        sql,
        job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("rid", "STRING", run_id),
            bigquery.ScalarQueryParameter("dm", "STRING", source),
        ]),
        location=pipeline.config.region,
    )
    job.result()
    return int(job.num_dml_affected_rows or 0)


def store_branch_rows_from_crawl(pairs, run_id: str, now):
    """(google_place_id, handle) の集合 → store_branch 行群（グローバルチェーン除去つき）。

    純関数。柱1 の肝である «同じ handle が複数 google_place_id に付いたら、それはチェーン
    公式/集約アカウントであって店固有ではない» を、**全件を見て** 落とす（4_4 はバッチ分割で
    全件が見えないため、この判定はここでしか正しくできない）。

    - handle → distinct google_place_id 数を数える
    - 2 店以上に付く handle は除外（store_branch にしない）
    - 1 店だけに付く handle を store_branch として yield（discovery_method='official_site_crawl'）
    """
    handle_to_pids: dict[str, set[str]] = {}
    for pid, handle in pairs:
        if not pid or not handle:
            continue
        handle_to_pids.setdefault(handle, set()).add(pid)

    dropped_chain = 0
    for handle, pids in handle_to_pids.items():
        if len(pids) >= 2:
            dropped_chain += 1
            continue
        (pid,) = tuple(pids)
        yield {
            "account_id": handle, "provider": PROVIDER_INSTAGRAM, "handle": handle,
            "account_type": "store_branch", "discovery_method": "official_site_crawl",
            "discovery_seed_place_id": pid,
            "followers": None, "media_count": None,
            "discovered_at": now.isoformat(), "run_id": run_id,
        }
    LOGGER.info("official_site_crawl: 店固有 handle %d、チェーン除外 handle %d",
                sum(1 for h, p in handle_to_pids.items() if len(p) < 2), dropped_chain)


def _rows_from_official_site_crawl(pipeline: BigQueryPipeline, crawl_run_id: str, run_id: str, now):
    from google.cloud import bigquery
    sql = f"""
      SELECT DISTINCT google_place_id, handle
      FROM `{pipeline.table(TABLE_STORE_SITE_IG)}`
      WHERE run_id = @crid AND handle IS NOT NULL
    """
    params = [bigquery.ScalarQueryParameter("crid", "STRING", crawl_run_id)]
    pairs = [(row["google_place_id"], row["handle"]) for row in pipeline.execute(sql, params)]
    yield from store_branch_rows_from_crawl(pairs, run_id, now)


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()
    now = utc_now()

    with pipeline.step(run_id, f"4_1_discover_sns_accounts:{args.source}", repo_root=HERE.parents[1]) as result:
        # 同一 run の途中再開を冪等化。ただし run_id 単位 DELETE だと同じ run に相乗りする
        # 他 source（柱1+柱2 を同 run で流す等）を巻き込むため、この source の
        # discovery_method 行だけを消す。discovery_method は source と 1:1。
        _delete_source_rows(pipeline, run_id, args.source)
        if args.source == "influencer_list":
            rows = list(_rows_from_influencer_list(Path(args.handles_file), run_id, now))
        elif args.source == "official_site_crawl":
            crawl_rid = args.crawl_run_id or run_id
            LOGGER.info("sns_store_site_ig run_id=%s から店固有 IG を合流します", crawl_rid)
            rows = list(_rows_from_official_site_crawl(pipeline, crawl_rid, run_id, now))
        else:
            crid = args.catalog_run_id or _latest_catalog_run_id(pipeline)
            LOGGER.info("restaurant_catalog run_id=%s から店アカウントを抽出します", crid)
            rows = list(_rows_from_open_data(pipeline, crid, args.limit, run_id, now))
        count = pipeline.load_json_rows(TABLE_SOURCE_ACCOUNT, rows)
        result["row_count"] = count
        LOGGER.info("sns_source_account に %d 件を投入しました（source=%s）", count, args.source)


if __name__ == "__main__":
    main()
