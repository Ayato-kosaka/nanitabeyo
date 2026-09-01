#!/usr/bin/env python3
"""#1273 収集ルート3: 料理カテゴリ/エリアの検索で account 無しの投稿URLを sns_post_raw へ入れる。

SERPER（google.serper.dev、**無料枠のみ**）で `site:instagram.com "<クエリ>"` を引き、
organic の instagram 投稿URLを集める。被覆の穴（カテゴリ×市区町村）をピンポイントで埋める用途。
account_id は NULL（単体投稿）。caption は保存しない（resolve が URL から取り直す）。

入力は TSV ファイル（--queries-file）で 1 行 1 セル:
    <query>\t<dish_category_id>\t<lat>\t<lng>
lat/lng は省略可（空欄）。query は「焼き鳥 米原」のような検索語（site: は本スクリプトが付ける）。
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now
from common_sns import PROVIDER_INSTAGRAM, TABLE_POST_RAW

LOGGER = logging.getLogger(__name__)
_POST_RE = re.compile(r"instagram\.com/(?:[A-Za-z0-9_.]+/)?(p|reel|tv)/([A-Za-z0-9_-]+)", re.IGNORECASE)


def serper_search(key: str, q: str, num: int = 20) -> dict:
    body = json.dumps({"q": q, "num": num, "gl": "jp", "hl": "ja"}).encode("utf-8")
    req = urllib.request.Request(
        "https://google.serper.dev/search", data=body,
        headers={"X-API-KEY": key, "Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _posts_from(result: dict):
    """organic の link から instagram 投稿 (shortcode, canonical_url) を取り出す。"""
    for item in (result.get("organic") or []):
        link = item.get("link") or ""
        m = _POST_RE.search(link)
        if m:
            code = m.group(2)
            yield code, f"https://www.instagram.com/{m.group(1)}/{code}/"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="SERPER 検索で投稿URLを収集する（ルート3・無料枠のみ）")
    p.add_argument("--run-id", default=None)
    p.add_argument("--queries-file", required=True, help="TSV: query<TAB>category_id<TAB>lat<TAB>lng")
    # #1273 実測: SERPER の無料プランは num>10 を HTTP 400 で弾く（num=20 で全クエリ中断していた）。
    # 既定を 10 に下げる。10 件/クエリで薄いセルを埋めるには十分（不足なら都市を差し替える運用）。
    p.add_argument("--num", type=int, default=10, help="1 クエリの取得件数（SERPER 無料プランは最大 10）")
    p.add_argument("--max-queries", type=int, default=None, help="このバッチのクエリ数上限")
    p.add_argument("--sleep-ms", type=int, default=1200, help="SERPER 呼び出し間隔（無料枠に配慮）")
    return p.parse_args()


def _read_cells(path: Path, max_queries):
    cells = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.rstrip("\n")
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        q = parts[0].strip()
        cat = parts[1].strip() if len(parts) > 1 and parts[1].strip() else None
        lat = float(parts[2]) if len(parts) > 2 and parts[2].strip() else None
        lng = float(parts[3]) if len(parts) > 3 and parts[3].strip() else None
        if q:
            cells.append((q, cat, lat, lng))
    return cells[:max_queries] if max_queries else cells


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    key = os.getenv("SERPER_API_KEY")
    if not key:
        raise RuntimeError("SERPER_API_KEY 未設定（db-script-run.yml の secret）。")

    pipeline = BigQueryPipeline()
    cells = _read_cells(Path(args.queries_file), args.max_queries)
    LOGGER.info("%d クエリを SERPER で引きます（無料枠のみ）", len(cells))
    now_iso = utc_now().isoformat()
    sleep_s = max(args.sleep_ms, 0) / 1000.0

    with pipeline.step(run_id, "4_3_collect_search_posts", parameters={
        "queries": len(cells), "num": args.num,
    }, repo_root=Path(__file__).resolve().parents[1]) as result:
        rows = []
        seen = set()
        for q, cat, lat, lng in cells:
            full_q = f'{q} site:instagram.com'
            try:
                res = serper_search(key, full_q, args.num)
            except urllib.error.HTTPError as e:
                # #1273 真因切り分け: code だけでなく Serper の応答本文（{"message": …}）も出す。
                # 400 は «無料枠上限» とは限らない（不正キー・リクエスト形式・パラメータ等）。
                try:
                    err_body = e.read().decode("utf-8", "replace")[:500]
                except Exception:
                    err_body = "(応答本文の読み取り失敗)"
                LOGGER.warning("SERPER %s (q=%s) body=%s。中断します", e.code, q, err_body)
                break
            for code, url in _posts_from(res):
                pid = code  # shortcode。4_2(business_discovery)と同じキーで跨ルート重複を解決
                if pid in seen:
                    continue
                seen.add(pid)
                rows.append({
                    "post_id": pid, "provider": PROVIDER_INSTAGRAM, "canonical_url": url,
                    "account_id": None, "discovery_route": "hashtag_search",
                    "discovery_method": "serper_post_search", "discovery_query": full_q,
                    "discovery_seed_place_id": None,
                    "discovery_area_lat": lat, "discovery_area_lng": lng,
                    "discovery_category_id": cat,
                    "fetched_at": now_iso, "run_id": run_id,
                })
            if sleep_s:
                time.sleep(sleep_s)

        # 検索由来は post_id が business_discovery と衝突しない（ig: 接頭辞）ので、
        # 同 run の重複だけ MERGE 的に消す（このバッチの post_id 分のみ）。
        if rows:
            from google.cloud import bigquery
            ids = sorted({r["post_id"] for r in rows})
            pipeline.execute(
                f"DELETE FROM `{pipeline.table(TABLE_POST_RAW)}` "
                f"WHERE run_id=@rid AND post_id IN UNNEST(@ids)",
                [bigquery.ScalarQueryParameter("rid", "STRING", run_id),
                 bigquery.ArrayQueryParameter("ids", "STRING", ids)],
            )
        count = pipeline.load_json_rows(TABLE_POST_RAW, rows) if rows else 0
        result["row_count"] = count
        LOGGER.info("sns_post_raw に %d 投稿を投入しました（検索 %d クエリ）", count, len(cells))


if __name__ == "__main__":
    main()
