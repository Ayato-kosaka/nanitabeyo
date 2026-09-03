#!/usr/bin/env python3
"""#1273 柱4 改: Common Crawl WAT から Instagram 投稿URL / プロフィール handle を採る。

## なぜこれが要るか（#1812）
投稿URL＋キャプションの取得が全体の律速で、手段は business_discovery（200コール/時）と
検索インデックス（無料枠 合計 26,000 クエリ）しか無かった。どちらも上限がある。
CC は **無料・総量無制限**で、実測 107MB/s・1 WAT 5秒・投稿URL 605件/ファイル。
10万ファイルで投稿URL 6,050万件。20 並列なら 5〜7 時間で全走査できる。

## 店の紐づけ（キャプション不要の軸）
1. **ソースページのホストがカタログ店の website と一致** → その店の投稿（seed-trust）
2. 上記以外は «日本のページ» だけ残す（.jp ホスト or タイトルに日本語）。店は resolve に任せる

素の permalink `instagram.com/p/<code>` が主。handle 付き `instagram.com/<handle>/p/<code>` は
実測 1件/ファイルでほぼ無いので当てにしない。プロフィールURLは handle 在庫として別途採る。
"""
from __future__ import annotations

import argparse
import gzip
import logging
import re
import urllib.request
from datetime import timezone

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now
from common_sns import PROVIDER_INSTAGRAM, TABLE_POST_RAW

LOGGER = logging.getLogger(__name__)
BASE = "https://data.commoncrawl.org/"
UA = {"User-Agent": "nanitabeyo-research/1.0 (+dish_media seed; contact via github.com/Ayato-kosaka/nanitabeyo)"}

# instagram.com/<handle>/ のうち予約パスは handle ではない
RESERVED = {"p", "reel", "reels", "tv", "explore", "accounts", "stories", "direct", "about",
            "developer", "legal", "privacy", "terms", "help", "api", "graphql", "web", "static"}
RE_BARE = re.compile(rb'instagram\.com/(?:p|reel|tv)/([A-Za-z0-9_-]{5,20})')
RE_HANDLED = re.compile(rb'instagram\.com/([A-Za-z0-9._]{2,30})/(?:p|reel|tv)/([A-Za-z0-9_-]{5,20})')
RE_PROFILE = re.compile(rb'instagram\.com/([A-Za-z0-9._]{2,30})/?["\'\\\s]')
RE_URI = re.compile(rb'"WARC-Target-URI":"([^"]+)"')
RE_TITLE = re.compile(rb'"Title":"((?:[^"\\]|\\.){0,300})"')
# WAT は JSON なので日本語は \uXXXX でエスケープされている。CJK/かな の範囲を拾う。
RE_JA_ESC = re.compile(rb'\\u(?:3[0-9a-fA-F]{3}|4[eE][0-9a-fA-F]{2}|[5-9][0-9a-fA-F]{3})')


def _open(url: str):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300)


def _host_of(uri: bytes) -> str:
    try:
        h = uri.split(b"/")[2].decode("utf-8", "replace").lower()
    except Exception:  # noqa: BLE001 - 壊れた URI は捨てる
        return ""
    if h.startswith("www."):
        h = h[4:]
    return h.split(":")[0]


def _store_hosts(pipeline: BigQueryPipeline, catalog_run_id: str) -> dict[str, str]:
    """カタログ店の website ホスト → google_place_id。2 店以上が同じホストならチェーン扱いで捨てる。"""
    sql = f"""
      WITH h AS (
        SELECT google_place_id,
               LOWER(REGEXP_REPLACE(REGEXP_EXTRACT(website, r'^https?://([^/?#]+)'), r'^www\\.', '')) AS host
        FROM `{pipeline.table('restaurant_catalog')}`
        WHERE run_id = @crid AND website IS NOT NULL AND website != '')
      SELECT host, ANY_VALUE(google_place_id) place_id
      FROM h WHERE host IS NOT NULL AND host != ''
      GROUP BY host HAVING COUNT(DISTINCT google_place_id) = 1
    """
    from google.cloud import bigquery
    params = [bigquery.ScalarQueryParameter("crid", "STRING", catalog_run_id)]
    return {r["host"]: r["place_id"] for r in pipeline.execute(sql, params)}


def scan_file(url: str, store_hosts: dict[str, str]):
    """1 WAT を流し、(post_id, source_host, place_id|None, handle|None) と handle 集合を返す。"""
    posts: dict[str, tuple[str, str | None, str | None]] = {}
    handles_jp: set[str] = set()
    seen_bytes = 0
    try:
        with _open(url) as resp:
            gz = gzip.GzipFile(fileobj=resp)
            buf = b""
            while True:
                chunk = gz.read(8 * 1024 * 1024)
                if not chunk:
                    break
                seen_bytes += len(chunk)
                data = buf + chunk
                parts = RE_URI.split(data)
                for i in range(1, len(parts) - 1, 2):
                    uri, body = parts[i], parts[i + 1]
                    host = _host_of(uri)
                    if not host:
                        continue
                    place_id = store_hosts.get(host)
                    title = RE_TITLE.search(body)
                    is_ja = host.endswith(".jp") or bool(title and RE_JA_ESC.search(title.group(1)))
                    if not (place_id or is_ja):
                        continue  # 日本と関係ないページは捨てる（6,050万→絞り込み）
                    for m in RE_HANDLED.finditer(body):
                        h = m.group(1).decode("utf-8", "replace").lower()
                        if h in RESERVED:
                            continue
                        posts.setdefault(m.group(2).decode(), (host, place_id, h))
                    for m in RE_BARE.finditer(body):
                        posts.setdefault(m.group(1).decode(), (host, place_id, None))
                    if is_ja:
                        for m in RE_PROFILE.finditer(body):
                            h = m.group(1).decode("utf-8", "replace").lower()
                            if h not in RESERVED:
                                handles_jp.add(h)
                buf = data[-4000:]
    except (EOFError, OSError) as e:  # ストリーム断でも取れた分は使う
        LOGGER.warning("  stream ended early (%s) after %.0fMB", type(e).__name__, seen_bytes / 1048576)
    return posts, handles_jp, seen_bytes


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Common Crawl WAT から Instagram 投稿URLを採る")
    p.add_argument("--run-id", default=None)
    p.add_argument("--crawl", default="CC-MAIN-2026-34")
    p.add_argument("--catalog-run-id", default="restaurant-2026-08-23")
    p.add_argument("--shards", type=int, default=1, help="WAT ファイルの分割数（互いに素）")
    p.add_argument("--shard", type=int, default=0)
    p.add_argument("--max-files", type=int, default=200, help="このジョブで流す WAT 数")
    p.add_argument("--flush-every", type=int, default=20, help="何ファイルごとに BQ へ流すか")
    p.add_argument("--dry-run", action="store_true")
    return p.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()

    LOGGER.info("カタログの website ホストを読みます…")
    store_hosts = _store_hosts(pipeline, args.catalog_run_id)
    LOGGER.info("  店固有ホスト %d 件", len(store_hosts))

    with _open(f"{BASE}crawl-data/{args.crawl}/wat.paths.gz") as r:
        paths = [p for p in gzip.decompress(r.read()).decode().split("\n") if p.strip()]
    mine = [p for i, p in enumerate(paths) if i % max(args.shards, 1) == args.shard][: args.max_files]
    LOGGER.info("crawl %s: 全 %d ファイル中このシャードは %d 本", args.crawl, len(paths), len(mine))

    with pipeline.step(run_id, "4_9_scan_cc_wat_instagram", parameters={
        "crawl": args.crawl, "shards": args.shards, "shard": args.shard, "files": len(mine),
    }, repo_root=None) as result:
        now = utc_now().astimezone(timezone.utc).isoformat()
        rows: list[dict] = []
        acc_rows: list[dict] = []
        seen_posts: set[str] = set()
        seen_handles: set[str] = set()
        total_posts = total_seed = total_mb = 0

        def flush() -> None:
            nonlocal rows, acc_rows
            if rows and not args.dry_run:
                pipeline.load_json_rows(TABLE_POST_RAW, rows)
            if acc_rows and not args.dry_run:
                pipeline.load_json_rows("sns_source_account", acc_rows)
            rows, acc_rows = [], []

        for n, path in enumerate(mine, 1):
            posts, handles, nbytes = scan_file(BASE + path, store_hosts)
            total_mb += nbytes / 1048576
            for code, (host, place_id, handle) in posts.items():
                if code in seen_posts:
                    continue
                seen_posts.add(code)
                total_posts += 1
                if place_id:
                    total_seed += 1
                rows.append({
                    "post_id": code, "provider": PROVIDER_INSTAGRAM,
                    "canonical_url": f"https://www.instagram.com/p/{code}/",
                    "account_id": handle, "discovery_route": "cc_wat",
                    "discovery_method": "cc_wat_link", "discovery_query": host,
                    "discovery_seed_place_id": place_id, "discovery_area_lat": None,
                    "discovery_area_lng": None, "discovery_category_id": None,
                    "fetched_at": now, "run_id": run_id, "caption": None, "author_name": None,
                })
            for h in handles:
                if h in seen_handles:
                    continue
                seen_handles.add(h)
                acc_rows.append({
                    "account_id": h, "provider": PROVIDER_INSTAGRAM, "handle": h,
                    "account_type": "unknown", "discovery_method": "cc_wat_profile",
                    "discovery_seed_place_id": None, "followers": None, "media_count": None,
                    "discovered_at": now, "run_id": run_id,
                })
            if n % args.flush_every == 0:
                LOGGER.info("  %d/%d 本 | 投稿 %d（うち店確定 %d） | handle %d | %.0fMB",
                            n, len(mine), total_posts, total_seed, len(seen_handles), total_mb)
                flush()
        flush()
        result["row_count"] = total_posts
        result["seed_trusted"] = total_seed
        result["handles"] = len(seen_handles)
        LOGGER.info("完了: 投稿 %d（店確定 %d）| handle %d | %.0fMB",
                    total_posts, total_seed, len(seen_handles), total_mb)


if __name__ == "__main__":
    main()
