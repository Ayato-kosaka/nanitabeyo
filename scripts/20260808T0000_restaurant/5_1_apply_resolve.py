#!/usr/bin/env python3
"""#1273 sns_post_raw の各 URL を resolve API に通し、結果を sns_post_resolved へ入れる。

**resolve が単一頭脳。** ここは URL（と分かる時だけエリア座標）を渡し、返ってきた prefill から
google_place_id / dish_category_id を取り出して status を決めるだけ。照合ロジックは一切持たない。
認証は自己署名 JWT（common_sns。匿名サインインは使わない）。

resolve は dev API を叩くので負荷を考え --limit でバッチ分割し、間隔を空ける。
同一 run の再処理は post_id 単位で入れ直す（batch 冪等）。resolve 改善後の再処理は
--resolve-version を変えて未処理分だけ流す運用にできる。
"""

from __future__ import annotations

import argparse
import logging
import os
import time
import urllib.error

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now
from common_sns import (
    PROVIDER_INSTAGRAM,
    TABLE_POST_RAW,
    TABLE_POST_RESOLVED,
    ResolveClient,
    classify,
)

LOGGER = logging.getLogger(__name__)
DEFAULT_AREA_RADIUS_M = 3000


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="sns_post_raw を resolve に通して sns_post_resolved を作る")
    p.add_argument("--run-id", default=None)
    p.add_argument("--raw-run-id", default=None, help="読む sns_post_raw の run_id（省略時は --run-id）")
    p.add_argument("--resolve-version", default="dev", help="この resolve デプロイの識別（再処理管理用）")
    p.add_argument("--limit", type=int, default=500, help="このバッチで処理する未処理投稿数の上限")
    p.add_argument("--sleep-ms", type=int, default=150, help="resolve 呼び出しの間隔（dev API 負荷対策）")
    p.add_argument("--debug-dump", type=int, default=0, help="先頭 N 件の resolve 生レスポンスをログに出す（診断用）")
    return p.parse_args()


def _fetch_unresolved(pipeline: BigQueryPipeline, raw_run_id: str, resolve_run_id: str, limit: int):
    """未 resolve（この run で resolved に無い）投稿を取り出す。"""
    from google.cloud import bigquery
    sql = f"""
      SELECT r.post_id, r.canonical_url, r.discovery_route,
             r.discovery_area_lat, r.discovery_area_lng
      FROM `{pipeline.table(TABLE_POST_RAW)}` r
      LEFT JOIN `{pipeline.table(TABLE_POST_RESOLVED)}` v
        ON v.run_id = @resolve_rid AND v.provider = r.provider AND v.post_id = r.post_id
      WHERE r.run_id = @raw_rid AND v.post_id IS NULL
      QUALIFY ROW_NUMBER() OVER (PARTITION BY r.post_id ORDER BY r.fetched_at DESC) = 1
      LIMIT {int(limit)}
    """
    params = [
        bigquery.ScalarQueryParameter("raw_rid", "STRING", raw_run_id),
        bigquery.ScalarQueryParameter("resolve_rid", "STRING", resolve_run_id),
    ]
    return list(pipeline.execute(sql, params))


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    raw_run_id = args.raw_run_id or run_id
    pipeline = BigQueryPipeline()
    client = ResolveClient()  # base_url は common_sns の BACKEND_BASE_URL
    now_iso = utc_now().isoformat()
    sleep_s = max(args.sleep_ms, 0) / 1000.0

    posts = _fetch_unresolved(pipeline, raw_run_id, run_id, args.limit)
    LOGGER.info("未 resolve %d 投稿を処理します（resolve_version=%s）", len(posts), args.resolve_version)

    with pipeline.step(run_id, "5_1_apply_resolve", parameters={
        "raw_run_id": raw_run_id, "resolve_version": args.resolve_version, "limit": args.limit,
    }, repo_root=None) as result:
        rows = []
        n_ok = n_err = 0
        dumped = 0
        for post in posts:
            lat = post["discovery_area_lat"]
            lng = post["discovery_area_lng"]
            radius = DEFAULT_AREA_RADIUS_M if (lat is not None and lng is not None) else None
            try:
                resp = client.resolve_raw(post["canonical_url"], lat=lat, lng=lng, radius=radius)
                if dumped < args.debug_dump:
                    import json as _json
                    LOGGER.info("[debug] url=%s\n%s", post["canonical_url"],
                                _json.dumps(resp, ensure_ascii=False)[:1500])
                    dumped += 1
                outcome = classify(resp)
                n_ok += 1
            except (urllib.error.URLError, TimeoutError, ValueError) as e:
                # resolve 到達不可・タイムアウト等はこの投稿を «未処理» のまま残す（行を作らない）
                LOGGER.warning("resolve 失敗 post_id=%s: %s", post["post_id"], str(e)[:160])
                n_err += 1
                continue
            rows.append({
                "post_id": post["post_id"], "provider": PROVIDER_INSTAGRAM,
                "status": outcome.status,
                "google_place_id": outcome.google_place_id,
                "dish_category_id": outcome.dish_category_id,
                "restaurant_confidence": outcome.restaurant_confidence,
                "category_confidence": outcome.category_confidence,
                "resolve_reason": outcome.resolve_reason,
                "resolve_version": args.resolve_version,
                "resolved_at": now_iso, "run_id": run_id,
            })
            if sleep_s:
                time.sleep(sleep_s)

        count = pipeline.load_json_rows(TABLE_POST_RESOLVED, rows) if rows else 0
        result["row_count"] = count
        matched = sum(1 for r in rows if r["status"] == "matched")
        LOGGER.info("sns_post_resolved に %d 件（matched=%d, resolve失敗=%d）を投入しました",
                    count, matched, n_err)


if __name__ == "__main__":
    main()
