#!/usr/bin/env python3
"""未確定restaurant seedだけをGoogle Text Search ID Onlyで照合する。

費用・誤更新を避けるため、デフォルトは候補件数を表示するだけである。APIを呼ぶには
``--execute`` と有限の ``--limit`` を明示し、まず小さいbatchから結果分布を確認する。
"""

from __future__ import annotations

import argparse
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from google.cloud import bigquery

from google_place_matching import (
    ALGORITHM_VERSION,
    DailyQuotaExhausted,
    TIGHT_HALF_SIDE_M,
    WIDE_HALF_SIDE_M,
    PlacesTextSearchClient,
    TextSearchResult,
    build_box_payload,
    build_query_payloads,
    decide_match,
)
from normalization import build_attempt_id
from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now

LOGGER = logging.getLogger(__name__)
REPO_ROOT = Path(__file__).resolve().parents[2]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="未確定seedをGoogle Place IDへ照合します"
    )
    parser.add_argument("--run-id")
    parser.add_argument(
        "--limit",
        type=int,
        required=True,
        help="今回処理するseed上限。費用上限でもある",
    )
    parser.add_argument(
        "--execute", action="store_true", help="指定時だけGoogle APIとBQ書込を実行"
    )
    parser.add_argument("--qps", type=float, default=5.0)
    parser.add_argument(
        "--workers",
        type=int,
        default=32,
        help="並列worker数。逐次だとHTTPレイテンシ律速で実効3〜4req/sに落ち、"
        "--qpsをいくら上げても届かない（1seedあたり2.17requestを1本ずつ待つため）。"
        "qpsの上限自体は共有throttleが守る",
    )
    parser.add_argument("--radius-m", type=float, default=150.0)
    parser.add_argument("--resume-days", type=int, default=90)
    parser.add_argument(
        "--probe-wide-box",
        action="store_true",
        help="±250m の矩形も送る。既定は送らない。出荷ルール box_unique_strict は"
        "「選んだ place_id が ±25m 矩形の中にあること」を必須にしており、"
        "矩形は wide ⊇ tight なので wide でしか出ない候補は構造上必ず棄却される。"
        "実測でも 345,770 seed 中 wide 由来の確定は 0 件、"
        "rejected_not_in_tight_box が 34,386 件だった（全 request の約21%が無駄）。"
        "緩いルール box_unique へ戻して再評価したいときだけ指定する",
    )
    parser.add_argument(
        "--include-osm-only",
        action="store_true",
        help="ODbL公開方針の承認後に、OSM canonical seedも検索対象へ含める",
    )
    return parser.parse_args()


def fetch_candidates(
    pipeline: BigQueryPipeline,
    run_id: str,
    limit: int,
    resume_days: int,
    include_osm_only: bool,
) -> list[Any]:
    # attemptsはpartition filter必須。resume windowを明示して、同じrun/versionの
    # 成否を問わず再課金しない。再試行したい場合はalgorithm versionを更新する。
    sql = f"""
      SELECT s.seed_id, s.canonical_name, s.canonical_address, s.latitude, s.longitude
      FROM `{pipeline.dataset_ref}.restaurant_seed_catalog` s
      WHERE s.run_id = @run_id
        AND s.existing_google_place_id IS NULL
        AND s.conflict_reason IS NULL
        -- OSM-only derived databaseの公開条件が未承認のまま、照合費用を使わない。
        AND (@include_osm_only OR s.seed_origin != 'osm_only')
        AND NOT EXISTS (
          SELECT 1
          FROM `{pipeline.dataset_ref}.restaurant_google_place_match_attempts` a
          WHERE a.attempted_date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL @resume_days DAY)
                                     AND CURRENT_DATE()
            AND a.run_id = @run_id
            AND a.seed_id = s.seed_id
            AND a.algorithm_version = @algorithm_version
            -- api_error は「照合を試したが答えが出ていない」状態である。
            -- これを済み扱いにすると、日次クォータ枯渇や一過性の5xxで
            -- 落ちた seed が resume 対象から外れ、二度と照合されない
            -- （実際に429で15,376件がこの状態になった）。次回は引き直す。
            AND a.result_status != 'api_error'
        )
      ORDER BY s.seed_id
      LIMIT @limit
    """
    parameters = [
        bigquery.ScalarQueryParameter("run_id", "STRING", run_id),
        bigquery.ScalarQueryParameter("resume_days", "INT64", resume_days),
        bigquery.ScalarQueryParameter("algorithm_version", "STRING", ALGORITHM_VERSION),
        bigquery.ScalarQueryParameter("limit", "INT64", limit),
        bigquery.ScalarQueryParameter("include_osm_only", "BOOL", include_osm_only),
    ]
    return list(pipeline.execute(sql, parameters))


def attempt_row(
    *,
    run_id: str,
    seed: Any,
    radius_m: float,
    client: PlacesTextSearchClient,
    probe_wide_box: bool = False,
) -> dict[str, Any]:
    """1 seed 分の probe を、**必要な順に必要なだけ**送って判定する。

    判定は「矩形の中で同名が一意か」から始まるので、矩形がどちらも一意で
    なければ A も B も送る必要がない（確定しえない）。裏取りは A で足りることが
    多く、その場合 B も要らない。#1276 の PoC の実測では 4.00 → 2.17 本/店に
    減り、**判定が変わった seed は 0 件**だった。

    ±250m の矩形は既定で送らない（``probe_wide_box``）。理由は
    ``--probe-wide-box`` の help を参照。確定する place_id は変わらず、
    変わるのは棄却理由のラベルだけである。
    """

    query_a, query_b, body_a, body_b = build_query_payloads(
        seed.canonical_name,
        seed.canonical_address or "",
        seed.latitude,
        seed.longitude,
        radius_m,
    )
    has_address = bool((seed.canonical_address or "").strip())
    results: dict[str, TextSearchResult | None] = {
        "a": None, "b": None, "tight": None, "wide": None,
    }

    def probe(key: str, body: dict[str, Any]) -> TextSearchResult:
        if results[key] is None:
            results[key] = client.search(body)
        return results[key]

    def supported(candidate: str) -> bool:
        if candidate in probe("a", body_a).place_ids:
            return True
        if not has_address:
            # 住所が無ければ B は A と同じクエリになる。送る意味がない。
            return False
        return candidate in probe("b", body_b).place_ids

    boxes = [("tight", TIGHT_HALF_SIDE_M)]
    if probe_wide_box:
        boxes.append(("wide", WIDE_HALF_SIDE_M))
    for key, half_side in boxes:
        box = probe(
            key,
            build_box_payload(
                seed.canonical_name, seed.latitude, seed.longitude, half_side
            ),
        )
        if box.http_status == 200 and len(box.place_ids) == 1:
            if supported(box.place_ids[0]):
                break

    # 判定に B を使っていなくても、採否の条件に「B が1件以下」が入っている。
    # 住所がある seed では必ず B を確かめる。
    if has_address and results["b"] is None and any(
        results[key] is not None and len(results[key].place_ids) == 1
        for key in ("tight", "wide")
    ):  # 送っていない矩形は results[key] が None のまま無視される
        probe("b", body_b)

    decision = decide_match(
        results["a"],
        results["b"],
        result_tight=results["tight"],
        result_wide=results["wide"],
        has_address=has_address,
    )
    now = utc_now()
    errors = [
        result.error_message
        for result in results.values()
        if result is not None and result.error_message
    ]

    def ids(key: str) -> list[str]:
        result = results[key]
        return list(result.place_ids) if result is not None else []

    def status(key: str) -> int | None:
        result = results[key]
        return result.http_status if result is not None else None

    return {
        "attempted_date": now.date().isoformat(),
        "attempt_id": build_attempt_id(run_id, seed.seed_id, ALGORITHM_VERSION),
        "run_id": run_id,
        "seed_id": seed.seed_id,
        "algorithm_version": ALGORITHM_VERSION,
        "query_a": query_a,
        "query_b": query_b,
        "place_ids_a": ids("a"),
        "place_ids_b": ids("b"),
        "place_ids_tight_box": ids("tight"),
        "place_ids_wide_box": ids("wide"),
        "matched_place_id": decision.matched_place_id,
        "result_status": decision.status,
        "http_status_a": status("a"),
        "http_status_b": status("b"),
        "http_status_tight_box": status("tight"),
        "http_status_wide_box": status("wide"),
        "error_message": " | ".join(errors)[:16_000] or None,
        "attempted_at": now.isoformat(),
    }


def flush_rows(pipeline: BigQueryPipeline, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    # attempt_idをinsertIdにも使う。resume queryと組み合わせ、手動再実行の重複を防ぐ。
    # timeoutを明示しないと、コネクションが死んだときに無限待ちになる。実際に
    # 6時間jobの途中（13:22）から書き込みだけが止まり、workerはAPIを叩き続けるのに
    # attemptsが1行も増えない状態が2時間以上続いた。insertIdがあるので再送は安全。
    last_error: Exception | None = None
    for retry in range(3):
        try:
            errors = pipeline.client.insert_rows_json(
                pipeline.table("restaurant_google_place_match_attempts"),
                rows,
                row_ids=[row["attempt_id"] for row in rows],
                timeout=60.0,
            )
        except Exception as error:  # noqa: BLE001 - 通信断も含めて再試行する
            last_error = error
            LOGGER.warning("attempts書き込みが失敗（%d回目）: %s", retry + 1, error)
            time.sleep(2**retry)
            continue
        if errors:
            raise RuntimeError(f"Google match attemptsの保存に失敗しました: {errors}")
        rows.clear()
        return
    raise RuntimeError(f"attempts書き込みが3回失敗しました: {last_error}")


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    if args.limit <= 0:
        raise ValueError("--limit は1以上にしてください")
    if args.qps <= 0 or not 0 < args.radius_m <= 50_000 or args.resume_days <= 0:
        raise ValueError("--qps/--radius-m/--resume-days が不正です")
    if not 1 <= args.workers <= 128:
        raise ValueError("--workers は1〜128にしてください")

    pipeline = BigQueryPipeline()
    candidates = fetch_candidates(
        pipeline,
        run_id,
        args.limit,
        args.resume_days,
        args.include_osm_only,
    )
    LOGGER.info("今回のGoogle照合候補: %d件（limit=%d）", len(candidates), args.limit)
    if not args.execute:
        LOGGER.info("dry-runです。実行する場合は --execute を付けてください。")
        for row in candidates[:10]:
            LOGGER.info("candidate seed_id=%s name=%s", row.seed_id, row.canonical_name)
        return

    # API サーバーが使う GOOGLE_MAPS_API_KEY とは別のキーにする。このバッチは
    # Text Search (IDs Only) しか呼ばないので、キー側も同 SKU だけに制限できる。
    api_key = os.getenv("PLACES_TEXT_SEARCH_API_KEY")
    if not api_key:
        raise ValueError("--execute には PLACES_TEXT_SEARCH_API_KEY が必要です")
    client = PlacesTextSearchClient(api_key, qps=args.qps)
    buffer: list[dict[str, Any]] = []
    parameters = {
        "limit": args.limit,
        "qps": args.qps,
        "workers": args.workers,
        "probe_wide_box": args.probe_wide_box,
        "radius_m": args.radius_m,
        "algorithm_version": ALGORITHM_VERSION,
        "include_osm_only": args.include_osm_only,
    }
    with pipeline.step(
        run_id,
        "3_2_search_google_place_ids",
        parameters=parameters,
        repo_root=REPO_ROOT,
    ) as step:
        # seed単位でworkerへ分配する。1seed内のprobeは判定順序に意味があるため
        # 逐次のまま。qpsはclient側の共有throttleがHTTP request数で守る。
        # BQへの書き込みはこのメインスレッドだけが行う。
        # chunk単位でsubmitするのは、45万futureを一度に作ると完了済みfutureが
        # 結果を握ったまま解放されず、数時間でGB級にメモリが積み上がるため。
        chunk_size = 5_000
        done = 0
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            for offset in range(0, len(candidates), chunk_size):
                chunk = candidates[offset : offset + chunk_size]
                futures = [
                    pool.submit(
                        attempt_row,
                        run_id=run_id,
                        seed=seed,
                        radius_m=args.radius_m,
                        client=client,
                        probe_wide_box=args.probe_wide_box,
                    )
                    for seed in chunk
                ]
                quota_exhausted = False
                for future in as_completed(futures):
                    try:
                        buffer.append(future.result())
                    except DailyQuotaExhausted as error:
                        # 日次クォータは翌日まで回復しない。残りを走らせても
                        # api_error を書き込むだけなので、ここで打ち切る。
                        # 未処理分は次回 run が resume で引き直す。
                        if not quota_exhausted:
                            LOGGER.error("日次クォータ枯渇で打ち切る: %s", error)
                        quota_exhausted = True
                        continue
                    done += 1
                    if len(buffer) >= 100:
                        flush_rows(pipeline, buffer)
                    if done % 1000 == 0:
                        LOGGER.info("Google照合: %d/%d件", done, len(candidates))
                futures.clear()
                flush_rows(pipeline, buffer)
                if quota_exhausted:
                    break
        flush_rows(pipeline, buffer)
        step["row_count"] = done
        step["quota_exhausted"] = quota_exhausted
        if quota_exhausted:
            raise RuntimeError(
                f"日次クォータ枯渇で {done}/{len(candidates)} 件で打ち切った。"
                "太平洋時間の日付が変わってから再実行すると、未処理分だけ引き直す。"
            )


if __name__ == "__main__":
    main()
