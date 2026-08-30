#!/usr/bin/env python3
"""#1273 収集ルート1/2: SNS 収集元アカウントを sns_source_account へ入れる。

--source で 2 経路（外部 API 不要・無料）:
  influencer_list    … グルメインフルエンサーの handle 一覧（seed ファイル）を取り込む（ルート2）
  open_data_socials  … restaurant_catalog.social_urls の instagram を店アカウントとして取り込む（ルート1）

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
from common_sns import PROVIDER_INSTAGRAM, TABLE_SOURCE_ACCOUNT

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
    p.add_argument("--source", required=True, choices=["influencer_list", "open_data_socials"])
    p.add_argument("--handles-file", default=str(HERE / "sns_influencer_seed_handles.txt"),
                   help="influencer_list 用。1 行 1 handle")
    p.add_argument("--catalog-run-id", default=None,
                   help="open_data_socials 用。読む restaurant_catalog の run_id（省略時は最新）")
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
    seen = set()
    for row in pipeline.execute(sql, params):
        for u in row["social_urls"] or []:
            handle = _extract_handle(u)
            if not handle:
                continue
            key = (handle, row["google_place_id"])
            if key in seen:
                continue
            seen.add(key)
            yield {
                "account_id": handle, "provider": PROVIDER_INSTAGRAM, "handle": handle,
                "account_type": "store_branch", "discovery_method": "open_data_socials",
                "discovery_seed_place_id": row["google_place_id"],
                "followers": None, "media_count": None,
                "discovered_at": now.isoformat(), "run_id": run_id,
            }


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()
    now = utc_now()

    with pipeline.step(run_id, f"4_1_discover_sns_accounts:{args.source}", repo_root=HERE.parents[1]) as result:
        # 同一 run の途中再開を冪等化（source_account は run_id 単位 DELETE で足りる）
        pipeline.delete_run_rows(TABLE_SOURCE_ACCOUNT, run_id)
        if args.source == "influencer_list":
            rows = list(_rows_from_influencer_list(Path(args.handles_file), run_id, now))
        else:
            crid = args.catalog_run_id or _latest_catalog_run_id(pipeline)
            LOGGER.info("restaurant_catalog run_id=%s から店アカウントを抽出します", crid)
            rows = list(_rows_from_open_data(pipeline, crid, args.limit, run_id, now))
        count = pipeline.load_json_rows(TABLE_SOURCE_ACCOUNT, rows)
        result["row_count"] = count
        LOGGER.info("sns_source_account に %d 件を投入しました（source=%s）", count, args.source)


if __name__ == "__main__":
    main()
