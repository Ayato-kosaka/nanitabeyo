#!/usr/bin/env python3
"""#1273 柱1 本番化: 店の公式サイトを crawl して «店固有 Instagram handle» を作る。

restaurant_catalog（website 保有店）を BigQuery から読み、各店の website を fetch して
本文から Instagram handle を抽出し、«1 店だけで決まる» 店固有フィルタ（PLATFORM blocklist・
集約メディア上の店名裏取り）を通して、中間テーブル `sns_store_site_ig` へロードする。
到達不能 / robots ブロック / handle 無し の店も handle=NULL の行として残す（reachability の観測）。

抽出・robots・fetch・店固有フィルタのロジックは 1273_instagram_seed_poc/pillar1_site_extract.py の
純関数を **そのまま** 呼ぶ（判定を写経しない）。IG は一切叩かない（handle 発見までが柱1、
投稿収集は既存の 4_2 経路に委ねる）。低速・robots 尊重・無料手段のみ。

グローバルチェーン除去（同じ handle が複数 google_place_id に付いたら chain=除外）は、
バッチ分割で全件が見えないこのスクリプトでは行わない。全件を読む
4_1 --source official_site_crawl が account_type を決めるときに落とす。

バッチ分割: --limit / --offset。restaurant_catalog を google_place_id 昇順で読むため
バッチ間の place_id は互いに素。冪等化は «そのバッチの place_id 群だけ» を run_id 内で
DELETE してから load する（run_id 単位 DELETE は他バッチを消すので使わない）。

使い方（db-script-run.yml）:
  script_path: scripts/20260808T0000_restaurant/4_4_crawl_official_site_igs.py
  args: --run-id sns-2026-08-31 --catalog-run-id restaurant-2026-08-23 --limit 2000 --offset 0
  requirements_path: scripts/20260808T0000_restaurant/requirements.txt
  # 動作確認は --dry-run を足す（BQ を読み crawl するが書き込まない）
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now
from common_sns import TABLE_STORE_SITE_IG

HERE = Path(__file__).resolve().parent
POC_DIR = HERE / "1273_instagram_seed_poc"
# 抽出・fetch・robots・店固有フィルタは POC 側の純関数を再利用する（写経しない）。
sys.path.insert(0, str(POC_DIR))
import pillar1_site_extract as p1  # noqa: E402

LOGGER = logging.getLogger(__name__)

DEFAULT_CATALOG_RUN_ID = "restaurant-2026-08-23"

# process_store の status → sns_store_site_ig.status。ok は handle 有無で ok / no_handle に分かれる。
_STATUS_PASSTHROUGH = {"website_is_ig", "fetch_failed", "robots_blocked", "no_website"}


def build_store_site_rows(fetch_records, run_id: str, now_iso: str):
    """process_store の出力（+ google_place_id を id に載せたもの）→ sns_store_site_ig の行群。

    純関数。ネットワーク・BQ に触れないので、既存の fetch 済み JSON でユニット検証できる。
    - handle を持つ店: 店固有候補 1 handle につき 1 行（status=ok / website_is_ig）
    - handle を持たない店: handle=NULL の 1 行（status=no_handle / fetch_failed / robots_blocked / no_website）
    """
    rows = []
    for rec in fetch_records:
        gpid = rec.get("id")
        if not gpid:
            continue
        base = {
            "google_place_id": gpid,
            "website": rec.get("website"),
            "host": rec.get("host"),
            "is_aggregator_host": bool(rec.get("aggregator_host", False)),
            "error": rec.get("error"),
            "crawled_at": now_iso,
            "run_id": run_id,
        }
        raw_status = rec.get("status")
        specific = p1.store_specific_handles(rec)  # {handle: {tags, corroborated}}
        if specific:
            # ok / website_is_ig で店固有候補が取れた
            status = raw_status if raw_status == "website_is_ig" else "ok"
            for handle, meta in sorted(specific.items()):
                rows.append({
                    **base,
                    "status": status,
                    "handle": handle,
                    "source_tags": meta["tags"],
                    "corroborated": bool(meta["corroborated"]),
                })
        else:
            # 到達したが店固有 handle 無し、または到達不能 / robots / website 無し
            status = raw_status if raw_status in _STATUS_PASSTHROUGH else "no_handle"
            rows.append({
                **base,
                "status": status,
                "handle": None,
                "source_tags": [],
                "corroborated": None,
            })
    return rows


def summarize_rows(rows):
    from collections import Counter
    status = Counter(r["status"] for r in rows)
    stores = {r["google_place_id"] for r in rows}
    handle_rows = [r for r in rows if r.get("handle")]
    stores_with_handle = {r["google_place_id"] for r in handle_rows}
    distinct_handles = {r["handle"] for r in handle_rows}
    corroborated = sum(1 for r in handle_rows if r.get("corroborated"))
    return {
        "stores": len(stores),
        "rows": len(rows),
        "status_counts": dict(status),
        "stores_with_store_specific_handle": len(stores_with_handle),
        "handle_rows": len(handle_rows),
        "distinct_handles": len(distinct_handles),
        "corroborated_handle_rows": corroborated,
    }


# --- BigQuery I/O --------------------------------------------------------------

def _read_catalog_stores(pipeline: BigQueryPipeline, catalog_run_id: str,
                         limit, offset, include_with_ig: bool):
    """restaurant_catalog の website 保有店を google_place_id 昇順で読む。

    既に social_urls に instagram を持つ店は open_data_socials 経路で拾えるため既定で除外する
    （--include-with-ig で含める）。ORDER BY google_place_id でバッチ間を互いに素にする。
    """
    from google.cloud import bigquery
    where_ig = "" if include_with_ig else (
        "AND NOT EXISTS (SELECT 1 FROM UNNEST(social_urls) u WHERE LOWER(u) LIKE '%instagram.com/%')"
    )
    limit_sql = f"LIMIT {int(limit)}" if limit else ""
    offset_sql = f"OFFSET {int(offset)}" if offset else ""
    sql = f"""
      SELECT google_place_id, name, website
      FROM `{pipeline.table('restaurant_catalog')}`
      WHERE run_id = @crid
        AND website IS NOT NULL AND website != ''
        {where_ig}
      ORDER BY google_place_id
      {limit_sql} {offset_sql}
    """
    params = [bigquery.ScalarQueryParameter("crid", "STRING", catalog_run_id)]
    stores = []
    for row in pipeline.execute(sql, params):
        stores.append({"id": row["google_place_id"], "name": row["name"], "website": row["website"]})
    return stores


def _delete_batch_rows(pipeline: BigQueryPipeline, run_id: str, place_ids) -> int:
    """このバッチの place_id 群だけを run_id 内で削除（他バッチを消さない冪等化）。"""
    if not place_ids:
        return 0
    from google.cloud import bigquery
    sql = (
        f"DELETE FROM `{pipeline.table(TABLE_STORE_SITE_IG)}` "
        f"WHERE run_id = @rid AND google_place_id IN UNNEST(@ids)"
    )
    job = pipeline.client.query(
        sql,
        job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("rid", "STRING", run_id),
            bigquery.ArrayQueryParameter("ids", "STRING", list(place_ids)),
        ]),
        location=pipeline.config.region,
    )
    job.result()
    return int(job.num_dml_affected_rows or 0)


def _crawl(stores, workers):
    """各店の website を process_store（robots 尊重・低速・IG 非取得）で crawl する。"""
    import concurrent.futures
    results = []
    done = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(p1.process_store, s) for s in stores]
        for fut in concurrent.futures.as_completed(futs):
            results.append(fut.result())
            done += 1
            if done % 50 == 0:
                LOGGER.info("  crawl %d/%d", done, len(stores))
    return results


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="柱1: 店公式サイト crawl → 店固有 IG handle → sns_store_site_ig")
    p.add_argument("--run-id", default=None, help="この crawl の run_id（sns_store_site_ig / pipeline_runs 用）")
    p.add_argument("--catalog-run-id", default=DEFAULT_CATALOG_RUN_ID,
                   help="読む restaurant_catalog の run_id（既定 restaurant-2026-08-23）")
    p.add_argument("--limit", type=int, default=None, help="バッチの店数上限")
    p.add_argument("--offset", type=int, default=0, help="バッチ開始位置（google_place_id 昇順）")
    p.add_argument("--workers", type=int, default=8, help="crawl 並列数（低速維持のため控えめ）")
    p.add_argument("--include-with-ig", action="store_true",
                   help="social_urls に既に instagram を持つ店も crawl する（既定は除外）")
    p.add_argument("--dry-run", action="store_true", help="BQ へ書き込まず summary だけ出す")
    p.add_argument("--stores-file", default=None,
                   help="BQ を読まず、この JSON（[{google_place_id,name,website}]）を crawl 対象にする")
    p.add_argument("--out-file", default=None, help="生成した行を NDJSON で書き出す先（検証用）")
    return p.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    now_iso = utc_now().isoformat()

    # crawl 対象の取得（BQ or ローカル JSON）
    if args.stores_file:
        raw = json.load(open(args.stores_file, encoding="utf-8"))
        stores = [{"id": s.get("google_place_id") or s.get("id"),
                   "name": s.get("name"), "website": s.get("website")} for s in raw]
        if args.limit or args.offset:
            stores = stores[args.offset: (args.offset + args.limit) if args.limit else None]
        pipeline = None if args.dry_run else BigQueryPipeline()
    else:
        pipeline = BigQueryPipeline()
        stores = _read_catalog_stores(pipeline, args.catalog_run_id, args.limit, args.offset,
                                      args.include_with_ig)
    LOGGER.info("crawl 対象 %d 店（catalog_run_id=%s, offset=%s, limit=%s）",
                len(stores), args.catalog_run_id, args.offset, args.limit)
    if not stores:
        LOGGER.warning("対象 0 店。終了します。")
        return

    fetch_records = _crawl(stores, args.workers)
    rows = build_store_site_rows(fetch_records, run_id, now_iso)
    summary = summarize_rows(rows)
    LOGGER.info("生成行 summary: %s", json.dumps(summary, ensure_ascii=False))

    if args.out_file:
        with open(args.out_file, "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        LOGGER.info("行を書き出しました: %s", args.out_file)

    if args.dry_run:
        LOGGER.info("[dry-run] BQ へは書き込みません。")
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return

    with pipeline.step(run_id, "4_4_crawl_official_site_igs",
                       parameters={"catalog_run_id": args.catalog_run_id,
                                   "offset": args.offset, "limit": args.limit},
                       repo_root=HERE.parents[1]) as result:
        place_ids = [s["id"] for s in stores if s.get("id")]
        deleted = _delete_batch_rows(pipeline, run_id, place_ids)
        LOGGER.info("バッチ冪等化: run_id=%s の %d place_id を DELETE（%d 行）", run_id, len(place_ids), deleted)
        count = pipeline.load_json_rows(TABLE_STORE_SITE_IG, rows)
        result["row_count"] = count
        LOGGER.info("sns_store_site_ig に %d 行を投入しました。", count)


if __name__ == "__main__":
    main()
