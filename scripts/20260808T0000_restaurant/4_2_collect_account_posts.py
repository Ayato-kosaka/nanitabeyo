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
from common_sns import PROVIDER_INSTAGRAM, TABLE_POST_RAW, TABLE_SOURCE_ACCOUNT, ig_shortcode_from_url

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


class AccountNotDiscoverable(Exception):
    """handle が存在しない / ビジネス・クリエイターでない等、そのアカウントを飛ばすべき状態。"""


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
        code = err.get("code")
        # code 4 = application rate limit, 17 = user rate limit, 613 = custom rate limit
        if code in (4, 17, 613) or e.code == 429:
            raise RateLimited(err.get("message") or body[:200])
        # code 110 = Invalid user id（存在しない handle 等）。business_discovery が引けない
        # アカウントは «そのアカウントを飛ばす» べき状態で、バッチ全体を止めない。
        if code == 110 or err.get("error_user_title") == "Cannot find User":
            raise AccountNotDiscoverable(err.get("error_user_msg") or err.get("message") or "not discoverable")
        raise RuntimeError(f"IG API {e.code}: {body[:300]}")


def resolve_ig_user_id(token: str, user_env: str = "IG_USER_ID") -> str:
    uid = os.getenv(user_env)
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
        except AccountNotDiscoverable as e:
            LOGGER.info("  @%s: skip（%s）", handle, str(e)[:80])
            return
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
    # #1791 複数トークン並列化: business_discovery のレート制限は «アプリ(トークン)単位»。
    # シャードごとに別 Meta アプリのトークンを割り当てれば合算スループットが上がる。
    # 既定は従来どおり IG_TOKEN / IG_USER_ID。シャード2以降は --token-env IG_TOKEN_2 等で切替。
    p.add_argument("--token-env", default="IG_TOKEN",
                   help="business_discovery に使うトークンの env 名（#1791 シャード並列用。既定 IG_TOKEN）")
    p.add_argument("--user-env", default="IG_USER_ID",
                   help="IG ビジネスアカウント id の env 名（--token-env と対で切替。既定 IG_USER_ID）")
    # #1791 並列シャード: 複数トークンで «互いに素な» アカウント集合を同時に回すための分割。
    # handle のハッシュで N 分割し、各シャードは自分の担当分だけ処理する（重複収集を防ぐ）。
    p.add_argument("--shard-count", type=int, default=1, help="アカウントの分割数（#1791 並列用。既定 1=分割なし）")
    p.add_argument("--shard-index", type=int, default=0, help="このシャードの担当インデックス（0..shard-count-1）")
    return p.parse_args()


def _read_accounts(pipeline: BigQueryPipeline, account_run_id: str, account_type, max_accounts,
                   output_run_id: str | None = None, shard_count: int = 1, shard_index: int = 0):
    from google.cloud import bigquery
    where = "run_id = @rid AND provider = @prov"
    params = [
        bigquery.ScalarQueryParameter("rid", "STRING", account_run_id),
        bigquery.ScalarQueryParameter("prov", "STRING", PROVIDER_INSTAGRAM),
    ]
    if account_type:
        where += " AND account_type = @atype"
        params.append(bigquery.ScalarQueryParameter("atype", "STRING", account_type))
    # #1791 並列シャード: handle のハッシュで N 分割。並列トークンで同時に回しても
    # 各シャードの担当が互いに素になり、二重収集しない。shard_count=1 なら無効。
    if shard_count and shard_count > 1:
        where += " AND MOD(ABS(FARM_FINGERPRINT(handle)), @shard_count) = @shard_index"
        params.append(bigquery.ScalarQueryParameter("shard_count", "INT64", int(shard_count)))
        params.append(bigquery.ScalarQueryParameter("shard_index", "INT64", int(shard_index)))
    # #1273 チャンク harvest 用: レート制限(~200/h)で全量が CI 1 ジョブ(6h)に収まらないので
    # --max-accounts で分割する。ORDER BY handle LIMIT だけだと毎回同じ先頭 N を選び進まないため、
    # **この出力 run に既に投稿がある handle は除外**して «まだ収集していない account» を進める。
    # （投稿ゼロの account は毎回再試行され得るが、投稿を生む account は確実に前進する）。
    skip_sql = ""
    if output_run_id:
        where += (" AND handle NOT IN ("
                  f"SELECT DISTINCT account_id FROM `{pipeline.table(TABLE_POST_RAW)}` "
                  "WHERE run_id = @out_rid AND account_id IS NOT NULL)")
        params.append(bigquery.ScalarQueryParameter("out_rid", "STRING", output_run_id))
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
    token = os.getenv(args.token_env)
    if not token:
        raise RuntimeError(f"{args.token_env} 未設定（db-script-run.yml の secret）。")

    pipeline = BigQueryPipeline()
    ig = resolve_ig_user_id(token, args.user_env)
    LOGGER.info("IG business account id = %s（token_env=%s）", ig, args.token_env)

    # output_run_id=run_id を渡すと «この run に既に投稿がある handle» を除外する（チャンク前進）。
    accounts = _read_accounts(pipeline, account_run_id, args.account_type, args.max_accounts,
                              output_run_id=run_id,
                              shard_count=args.shard_count, shard_index=args.shard_index)
    LOGGER.info("%d アカウントを処理します（未収集分。max=%s）", len(accounts), args.max_accounts)
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
        # 収集は数時間かかりレート制限で待つため、**アカウント FLUSH_EVERY 件ごとに逐次ロード**する。
        # 末尾一括ロードだと job が 6h timeout した瞬間に収集済みが全ロストするため（実リスク）。
        # WRITE_APPEND なので複数回呼んでも積み増しになる。seen は run 全体で共有し重複を防ぐ。
        FLUSH_EVERY = 20
        rows: list[dict] = []
        seen: set[str] = set()
        total = 0
        processed = 0

        def _flush() -> None:
            nonlocal rows, total
            if rows:
                total += pipeline.load_json_rows(TABLE_POST_RAW, rows)
                rows = []

        for acc in accounts:
            handle = acc["handle"]
            route = _ROUTE_BY_ACCOUNT_TYPE.get(acc["account_type"], "influencer")
            n = 0
            for media_id, permalink in discover_media(ig, token, handle, args.limit_per_account):
                # 投稿の一意キーは shortcode（検索ルート4_3と揃え、跨ルート重複解決を防ぐ）
                pid = ig_shortcode_from_url(permalink) or media_id
                if pid in seen:
                    continue
                seen.add(pid)
                rows.append({
                    "post_id": pid, "provider": PROVIDER_INSTAGRAM,
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
            processed += 1
            if processed % FLUSH_EVERY == 0:
                _flush()
                LOGGER.info("  … %d/%d アカウント処理・%d 投稿ロード済み（逐次）", processed, len(accounts), total)

        _flush()
        count = total
        result["row_count"] = count
        LOGGER.info("sns_post_raw に %d 投稿を投入しました（%d アカウント）", count, len(accounts))


if __name__ == "__main__":
    main()
