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
    # 18k+ の再 resolve を数時間で終えるため、post_id ハッシュで水平分割して複数 run を並列に回す。
    # 各シャードは互いに素な post_id 集合を担当するので二重 resolve/二重挿入が起きない。
    p.add_argument("--shards", type=int, default=1, help="並列シャード総数（既定1=分割なし）")
    p.add_argument("--shard", type=int, default=0, help="このバッチが担当するシャード番号 [0, shards)")
    # 再解決を «非破壊» のパイプライン一級操作にする（delete 不要）。resolve 改善後は
    # --resolve-version を上げて回すと、同 version で未処理の投稿だけを追記解決する。
    # 集計側は post ごとの «最新 resolve_version» を見る（7_1 / 測定クエリ）。
    p.add_argument("--reresolve-prev-status", default=None,
                   help="この «直近 version の status» の投稿だけ再解決する（例 skipped_no_store）。省略時は全未処理")
    return p.parse_args()


def _fetch_unresolved(pipeline: BigQueryPipeline, raw_run_id: str, resolve_run_id: str,
                      resolve_version: str, limit: int, shards: int = 1, shard: int = 0,
                      reresolve_prev_status: str | None = None):
    """未 resolve（この run × **この resolve_version** で未処理）の投稿を取り出す。

    version を anti-join に含めるので、--resolve-version を上げると全投稿が «その version では未処理»
    となり再解決＝追記（既存 version の行は消さない＝非破壊）。shards>1 は post_id で水平分割。
    reresolve_prev_status を渡すと «直近 version の status がそれ» の投稿だけに絞る（狙い撃ち再解決）。
    """
    from google.cloud import bigquery
    shard_filter = ""
    if shards > 1:
        # FARM_FINGERPRINT は決定的なので、同じ post_id は常に同じシャードに落ちる（並列非重複）。
        shard_filter = "AND MOD(ABS(FARM_FINGERPRINT(r.post_id)), @shards) = @shard"
    prev_filter = ""
    if reresolve_prev_status:
        # 直近 version（resolved_at 最新）の status が指定値の post_id に限定する。
        prev_filter = f"""
      AND r.post_id IN (
        SELECT post_id FROM (
          SELECT post_id, status,
                 ROW_NUMBER() OVER (PARTITION BY provider, post_id ORDER BY resolved_at DESC) rn
          FROM `{pipeline.table(TABLE_POST_RESOLVED)}`
          WHERE run_id = @resolve_rid
        ) WHERE rn = 1 AND status = @prev_status
      )"""
    sql = f"""
      SELECT r.post_id, r.canonical_url, r.discovery_route,
             r.discovery_area_lat, r.discovery_area_lng
      FROM `{pipeline.table(TABLE_POST_RAW)}` r
      LEFT JOIN `{pipeline.table(TABLE_POST_RESOLVED)}` v
        ON v.run_id = @resolve_rid AND v.provider = r.provider AND v.post_id = r.post_id
           AND v.resolve_version = @resolve_version
      WHERE r.run_id = @raw_rid AND v.post_id IS NULL {shard_filter} {prev_filter}
      QUALIFY ROW_NUMBER() OVER (PARTITION BY r.post_id ORDER BY r.fetched_at DESC) = 1
      LIMIT {int(limit)}
    """
    params = [
        bigquery.ScalarQueryParameter("raw_rid", "STRING", raw_run_id),
        bigquery.ScalarQueryParameter("resolve_rid", "STRING", resolve_run_id),
        bigquery.ScalarQueryParameter("resolve_version", "STRING", resolve_version),
    ]
    if shards > 1:
        params.append(bigquery.ScalarQueryParameter("shards", "INT64", shards))
        params.append(bigquery.ScalarQueryParameter("shard", "INT64", shard))
    if reresolve_prev_status:
        params.append(bigquery.ScalarQueryParameter("prev_status", "STRING", reresolve_prev_status))
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

    posts = _fetch_unresolved(pipeline, raw_run_id, run_id, args.resolve_version, args.limit,
                              args.shards, args.shard, args.reresolve_prev_status)
    LOGGER.info("未 resolve %d 投稿を処理します（resolve_version=%s, shard=%d/%d, 狙い撃ち=%s）",
                len(posts), args.resolve_version, args.shard, args.shards,
                args.reresolve_prev_status or "全未処理")

    with pipeline.step(run_id, "5_1_apply_resolve", parameters={
        "raw_run_id": raw_run_id, "resolve_version": args.resolve_version, "limit": args.limit,
        "shards": args.shards, "shard": args.shard,
    }, repo_root=None) as result:
        # 数千件の resolve は 1〜2h かかる。末尾一括ロードだと進捗が見えず timeout で全ロストするので
        # FLUSH_EVERY 件ごとに逐次ロードする（WRITE_APPEND。再実行時は resolved 済みを LEFT JOIN でskip）。
        FLUSH_EVERY = 200
        rows: list[dict] = []
        n_ok = n_err = 0
        dumped = 0
        total = 0
        matched = 0

        def _flush() -> None:
            nonlocal rows, total
            if rows:
                total += pipeline.load_json_rows(TABLE_POST_RESOLVED, rows)
                rows = []

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
            if outcome.status == "matched":
                matched += 1
            if len(rows) >= FLUSH_EVERY:
                _flush()
                LOGGER.info("  … %d/%d 処理・%d 件ロード済み（matched=%d, 失敗=%d）",
                            n_ok + n_err, len(posts), total, matched, n_err)
            if sleep_s:
                time.sleep(sleep_s)

        _flush()
        result["row_count"] = total
        LOGGER.info("sns_post_resolved に %d 件（matched=%d, resolve失敗=%d）を投入しました",
                    total, matched, n_err)


if __name__ == "__main__":
    main()
