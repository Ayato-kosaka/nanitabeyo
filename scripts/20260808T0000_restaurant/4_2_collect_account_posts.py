#!/usr/bin/env python3
"""#1273 収集ルート1/2: sns_source_account の各アカウントの投稿URLを sns_post_raw へ入れる。

Instagram Graph API の business_discovery で、対象ハンドルの media(permalink) を集める。
**caption は保存しない**（resolve が URL から取り直す）。保存するのは投稿を一意に指す URL と来歴だけ。

IG_TOKEN は GitHub Actions secret。business_discovery に必要な «自分の IG ビジネスアカウント id» は
env IG_USER_ID があれば使い、無ければ /me/accounts から自動解決する。

レート制限（~200コール/時, code 4）に当たったら指数バックオフで待つ。全量は数日かかる想定なので
--max-accounts / --limit-per-account でバッチ分割し、同一 run_id の途中再開は delete_run_rows で冪等化。
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now
from common_sns import PROVIDER_INSTAGRAM, TABLE_POST_RAW, TABLE_SOURCE_ACCOUNT

LOGGER = logging.getLogger(__name__)
HERE = Path(__file__).resolve().parent
GRAPH = "https://graph.facebook.com/v23.0"

_ROUTE_BY_ACCOUNT_TYPE = {
    "influencer": "influencer",
    "store_branch": "store_account",
    "store_brand": "store_account",
}


class RateLimited(Exception):
    pass


def _get(url: str, timeout: float = 30.0) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "nanitabeyo-sns-seed/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try:
            err = json.loads(body).get("error", {})
        except Exception:
            err = {}
        # code 4 = application rate limit, 17 = user rate limit, 613 = custom rate limit
        if err.get("code") in (4, 17, 613) or e.code == 429:
            raise RateLimited(err.get("message") or body[:200])
        raise RuntimeError(f"IG API {e.code}: {body[:300]}")


def resolve_ig_user_id(token: str) -> str:
    uid = os.getenv("IG_USER_ID")
    if uid:
        return uid
    q = urllib.parse.urlencode({"fields": "instagram_business_account{id}", "access_token": token})
    d = _get(f"{GRAPH}/me/accounts?{q}")
    for page in d.get("data", []):
        iba = page.get("instagram_business_account")
        if iba and iba.get("id"):
            return iba["id"]
    raise RuntimeError("IG ビジネスアカウント id を解決できません。env IG_USER_ID を設定してください。")


def discover_media(ig: str, token: str, handle: str, per_account_limit: int, page_size: int = 50):
    """business_discovery で handle の media を（ページングして）yield する。"""
    after = None
    fetched = 0
    backoff = 30
    while fetched < per_account_limit:
        limit = min(page_size, per_account_limit - fetched)
        media_args = f"media.limit({limit})" + (f".after({after})" if after else "")
        fields = f"business_discovery.username({handle}){{{media_args}{{id,permalink}}}}"
        q = urllib.parse.urlencode({"fields": fields, "access_token": token})
        try:
            d = _get(f"{GRAPH}/{ig}?{q}")
        except RateLimited as e:
            LOGGER.warning("rate limited (%s). %ds 待機します", e, backoff)
            time.sleep(backoff)
            backoff = min(backoff * 2, 900)
            continue
        bd = d.get("business_discovery")
        if not bd:  # username が business/creator でない、非公開、存在しない 等
            return
        media = bd.get("media", {})
        for m in media.get("data", []):
            if m.get("permalink") and m.get("id"):
                fetched += 1
                yield m["id"], m["permalink"]
        after = media.get("paging", {}).get("cursors", {}).get("after")
        if not after:
            return
        time.sleep(1)  # 連続ページングは軽く間隔を空ける


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="business_discovery で投稿URLを収集する（ルート1/2）")
    p.add_argument("--run-id", default=None)
    p.add_argument("--account-run-id", default=None, help="読む sns_source_account の run_id（省略時は --run-id と同じ）")
    p.add_argument("--account-type", default=None, choices=["influencer", "store_branch", "store_brand"],
                   help="対象を絞る（省略時は全部）")
    p.add_argument("--max-accounts", type=int, default=None, help="このバッチで処理するアカウント数上限")
    p.add_argument("--limit-per-account", type=int, default=200, help="1 アカウントあたりの投稿数上限")
    return p.parse_args()


def _read_accounts(pipeline: BigQueryPipeline, account_run_id: str, account_type, max_accounts):
    from google.cloud import bigquery
    where = "run_id = @rid AND provider = @prov"
    params = [
        bigquery.ScalarQueryParameter("rid", "STRING", account_run_id),
        bigquery.ScalarQueryParameter("prov", "STRING", PROVIDER_INSTAGRAM),
    ]
    if account_type:
        where += " AND account_type = @atype"
        params.append(bigquery.ScalarQueryParameter("atype", "STRING", account_type))
    limit_sql = f"LIMIT {int(max_accounts)}" if max_accounts else ""
    sql = f"""
      SELECT handle, account_type, discovery_seed_place_id
      FROM `{pipeline.table(TABLE_SOURCE_ACCOUNT)}`
      WHERE {where}
      QUALIFY ROW_NUMBER() OVER (PARTITION BY handle ORDER BY discovered_at DESC) = 1
      ORDER BY handle
      {limit_sql}
    """
    return list(pipeline.execute(sql, params))


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    account_run_id = args.account_run_id or run_id
    token = os.getenv("IG_TOKEN")
    if not token:
        raise RuntimeError("IG_TOKEN 未設定（db-script-run.yml の secret）。")

    pipeline = BigQueryPipeline()
    ig = resolve_ig_user_id(token)
    LOGGER.info("IG business account id = %s", ig)

    accounts = _read_accounts(pipeline, account_run_id, args.account_type, args.max_accounts)
    LOGGER.info("%d アカウントを処理します", len(accounts))
    now = utc_now()
    now_iso = now.isoformat()

    with pipeline.step(run_id, "4_2_collect_account_posts", parameters={
        "account_run_id": account_run_id, "account_type": args.account_type,
        "max_accounts": args.max_accounts, "limit_per_account": args.limit_per_account,
    }, repo_root=HERE.parents[1]) as result:
        # 収集は 413 アカウントを（レート制限のため）複数バッチに分けて回す。run_id 単位の
        # DELETE だと先行バッチを消してしまうので、**このバッチが担当するアカウント分だけ**を
        # 消してから入れ直す（バッチ冪等・他バッチ非破壊）。
        from google.cloud import bigquery
        handles = [acc["handle"] for acc in accounts]
        if handles:
            pipeline.execute(
                f"DELETE FROM `{pipeline.table(TABLE_POST_RAW)}` "
                f"WHERE run_id = @rid AND account_id IN UNNEST(@handles)",
                [
                    bigquery.ScalarQueryParameter("rid", "STRING", run_id),
                    bigquery.ArrayQueryParameter("handles", "STRING", handles),
                ],
            )
        rows = []
        seen = set()
        for acc in accounts:
            handle = acc["handle"]
            route = _ROUTE_BY_ACCOUNT_TYPE.get(acc["account_type"], "influencer")
            n = 0
            for media_id, permalink in discover_media(ig, token, handle, args.limit_per_account):
                if media_id in seen:
                    continue
                seen.add(media_id)
                rows.append({
                    "post_id": media_id, "provider": PROVIDER_INSTAGRAM,
                    "canonical_url": permalink, "account_id": handle,
                    "discovery_route": route, "discovery_method": "ig_business_discovery",
                    "discovery_query": None,
                    "discovery_seed_place_id": acc["discovery_seed_place_id"],
                    "discovery_area_lat": None, "discovery_area_lng": None,
                    "discovery_category_id": None,
                    "fetched_at": now_iso, "run_id": run_id,
                })
                n += 1
            LOGGER.info("  @%s: %d posts", handle, n)
        count = pipeline.load_json_rows(TABLE_POST_RAW, rows) if rows else 0
        result["row_count"] = count
        LOGGER.info("sns_post_raw に %d 投稿を投入しました（%d アカウント）", count, len(accounts))


if __name__ == "__main__":
    main()
