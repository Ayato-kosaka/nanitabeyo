#!/usr/bin/env python3
"""#1273 柱4 改: Common Crawl WAT から Instagram 投稿URL＋キャプション＋handle を採る。

## なぜこれが要るか（#1812）
「投稿URL＋キャプション」の取得が全体の律速で、手段は business_discovery（200コール/時）と
検索インデックス（無料枠 合計 26,000 クエリ）しか無く、どちらも上限がある。
CC は無料・総量無制限で、上限が無い唯一の経路である。

## なぜ «キャプションまで» 採れるのか（ここが要点）
Instagram 公式の埋め込み（blockquote）は、**投稿本文をそのままアンカーテキストとして
HTML に持つ**。WAT はページの `Links[].text` を保存しているので、
`(投稿URL, キャプション, handle)` の 3 点が **Instagram を一度も叩かずに** 揃う。
handle は同じ埋め込みの «(@handle)がシェアした投稿» から採れるので、
business_discovery を使わずに «アカウント → 投稿» を得る経路にもなる。

キャプションが取れることが決定的なのは、resolve が caption を渡されると Instagram を
取りに行かず純テキスト処理になる（=並列無制限・レート制限なし）ためである。
キャプションの無い投稿URLは resolve が IG 取得に回るので、実質使えない。

## 店の紐づけ
1. ソースページのホストがカタログ店の website と一致 → その店の投稿（seed-trust）
2. それ以外は «日本語のキャプション/タイトルを持つもの» だけ残し、店は resolve に任せる
"""
from __future__ import annotations

import argparse
import gzip
import json
import logging
import re
import urllib.request
from datetime import timezone

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now
from common_sns import PROVIDER_INSTAGRAM, TABLE_POST_RAW, TABLE_SOURCE_ACCOUNT

LOGGER = logging.getLogger(__name__)
BASE = "https://data.commoncrawl.org/"
UA = {"User-Agent": "nanitabeyo-research/1.0 (+dish_media seed; contact via github.com/Ayato-kosaka/nanitabeyo)"}

RESERVED = {"p", "reel", "reels", "tv", "explore", "accounts", "stories", "direct", "about",
            "developer", "legal", "privacy", "terms", "help", "api", "graphql", "web", "static"}
RE_IG_POST = re.compile(r"instagram\.com/(?:([A-Za-z0-9._]{2,30})/)?(?:p|reel|tv)/([A-Za-z0-9_-]{5,20})")
# 中国語（繁体字ブログ）が大量に混ざるので、漢字だけでは日本語と判定できない。
# かな（ひらがな/カタカナ）は日本語にしか無いので、これを日本語の判定に使う。
RE_KANA = re.compile(r"[ぁ-んァ-ヴー]")
# 埋め込みの «A post shared by 名前 (@handle)» / «名前(@handle)がシェアした投稿» から handle を採る
RE_AT = re.compile(r"[(（]@([A-Za-z0-9._]{2,30})[)）]")
# 埋め込みの定型文（キャプションではない）
BOILER = re.compile(
    r"^(view this post on instagram|この投稿をinstagramで見る|在\s*instagram\s*查看這則貼文|"
    r"instagram で.*を見る|follow me!?|追蹤|フォロー|see more|もっと見る|https?://)",
    re.IGNORECASE)
RE_SHARED = re.compile(r"(がシェアした投稿|分享的貼文|a post shared by|share[dz] a post)", re.IGNORECASE)


def _open(url: str):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300)


def _host_of(uri: str) -> str:
    try:
        h = uri.split("/")[2].lower()
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


def _page_meta(hm: dict) -> tuple[str, str]:
    head = hm.get("Head") or {}
    title = (head.get("Title") or "").strip()
    desc = ""
    for m in head.get("Metas") or []:
        name = (m.get("name") or m.get("property") or "").lower()
        if name in ("description", "og:description") and not desc:
            desc = (m.get("content") or "").strip()
    return title, desc


def _pick(texts: list[str]) -> tuple[str | None, str | None]:
    """アンカーテキスト群から (キャプション, handle) を選ぶ。"""
    handle = None
    caption = None
    for t in texts:
        m = RE_AT.search(t)
        if m and not handle:
            h = m.group(1).lower()
            if h not in RESERVED:
                handle = h
        if BOILER.match(t) or RE_SHARED.search(t):
            continue  # 定型文・«◯◯がシェアした投稿» は本文ではない
        if len(t) < 8:
            continue
        if caption is None or len(t) > len(caption):
            caption = t
    return caption, handle


def scan_record(raw: bytes, store_hosts: dict[str, str]):
    """WAT 1 レコードから (post_id -> row素材) を返す。"""
    try:
        rec = json.loads(raw)
    except Exception:  # noqa: BLE001 - 壊れた JSON は捨てる
        return {}, set()
    env = rec.get("Envelope") or {}
    uri = (env.get("WARC-Header-Metadata") or {}).get("WARC-Target-URI") or ""
    hm = ((env.get("Payload-Metadata") or {}).get("HTTP-Response-Metadata") or {}).get("HTML-Metadata") or {}
    links = hm.get("Links") or []
    if not links:
        return {}, set()

    host = _host_of(uri)
    place_id = store_hosts.get(host)
    title, desc = _page_meta(hm)

    by_code: dict[str, list[str]] = {}
    handle_of: dict[str, str] = {}
    profiles: set[str] = set()
    for ln in links:
        u = ln.get("url") or ""
        if "instagram.com" not in u:
            continue
        m = RE_IG_POST.search(u)
        if not m:
            h = re.search(r"instagram\.com/([A-Za-z0-9._]{2,30})/?$", u)
            if h and h.group(1).lower() not in RESERVED:
                profiles.add(h.group(1).lower())
            continue
        code = m.group(2)
        if m.group(1) and m.group(1).lower() not in RESERVED:
            handle_of.setdefault(code, m.group(1).lower())
        for t in ((ln.get("text") or "").strip(), (ln.get("title") or "").strip()):
            if t:
                by_code.setdefault(code, []).append(t)
        by_code.setdefault(code, [])

    if not by_code:
        return {}, profiles

    # ページ全体のタイトルをフォールバックに使ってよいのは «その投稿の記事» のときだけ。
    # 多数の投稿を並べる一覧ページに同じタイトルを配ると、resolve に嘘を食わせる。
    page_text = (title + " " + desc).strip()
    allow_page_fallback = len(by_code) <= 3 and bool(page_text)

    out: dict[str, dict] = {}
    for code, texts in by_code.items():
        caption, handle = _pick(texts)
        handle = handle or handle_of.get(code)
        if not caption and allow_page_fallback:
            caption = page_text
        if not caption:
            continue  # キャプションが無い投稿URLは resolve が IG 取得に回るので採らない
        if not (place_id or host.endswith(".jp") or RE_KANA.search(caption)):
            continue  # 日本語でないページは捨てる（繁体字ブログが大量に混ざる）
        out[code] = {"caption": caption[:2000], "handle": handle, "host": host, "place_id": place_id}
        if handle:
            profiles.add(handle)
    return out, profiles


def scan_file(url: str, store_hosts: dict[str, str]):
    posts: dict[str, dict] = {}
    profiles: set[str] = set()
    seen_bytes = 0
    try:
        with _open(url) as resp:
            gz = gzip.GzipFile(fileobj=resp)
            for raw in gz:
                seen_bytes += len(raw)
                if not raw.startswith(b'{"Container"') or b"instagram.com" not in raw:
                    continue
                got, prof = scan_record(raw, store_hosts)
                profiles |= prof
                for code, row in got.items():
                    cur = posts.get(code)
                    # 同じ投稿が複数ページに出たら «キャプションが長い / 店が確定している» 方を採る
                    if cur is None or (row["place_id"] and not cur["place_id"]) or \
                       len(row["caption"]) > len(cur["caption"]):
                        posts[code] = row
    except (EOFError, OSError) as e:  # ストリーム断でも取れた分は使う
        LOGGER.warning("  stream ended early (%s) after %.0fMB", type(e).__name__, seen_bytes / 1048576)
    return posts, profiles, seen_bytes


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Common Crawl WAT から Instagram 投稿URL＋キャプションを採る")
    p.add_argument("--run-id", default=None)
    p.add_argument("--crawl", default="CC-MAIN-2026-34")
    p.add_argument("--catalog-run-id", default="restaurant-2026-08-23")
    p.add_argument("--shards", type=int, default=1, help="WAT ファイルの分割数")
    p.add_argument("--shard", type=int, default=0)
    p.add_argument("--max-files", type=int, default=200, help="このジョブで流す WAT 数")
    p.add_argument("--flush-every", type=int, default=10, help="何ファイルごとに BQ へ流すか")
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
                pipeline.load_json_rows(TABLE_SOURCE_ACCOUNT, acc_rows)
            rows, acc_rows = [], []

        # 1 ジョブ内のスレッド並列は測って捨てた: 単発 78MB/s に対し 6 並列で合計 46MB/s と
        # 遅くなる（回線が上限で、並べても増えない）。並列化はジョブ（=シャード）を増やす側でやる。
        for n, path in enumerate(mine, 1):
            posts, profiles, nbytes = scan_file(BASE + path, store_hosts)
            total_mb += nbytes / 1048576
            for code, row in posts.items():
                if code in seen_posts:
                    continue
                seen_posts.add(code)
                total_posts += 1
                if row["place_id"]:
                    total_seed += 1
                rows.append({
                    "post_id": code, "provider": PROVIDER_INSTAGRAM,
                    "canonical_url": f"https://www.instagram.com/p/{code}/",
                    "account_id": row["handle"], "discovery_route": "cc_wat",
                    "discovery_method": "cc_wat_embed", "discovery_query": row["host"],
                    "discovery_seed_place_id": row["place_id"], "discovery_area_lat": None,
                    "discovery_area_lng": None, "discovery_category_id": None,
                    "fetched_at": now, "run_id": run_id,
                    "caption": row["caption"], "author_name": row["handle"],
                })
            for h in profiles:
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
                LOGGER.info("  %d/%d 本 | caption付き投稿 %d（うち店確定 %d） | handle %d | %.0fMB",
                            n, len(mine), total_posts, total_seed, len(seen_handles), total_mb)
                flush()
        flush()
        result["row_count"] = total_posts
        result["seed_trusted"] = total_seed
        result["handles"] = len(seen_handles)
        LOGGER.info("完了: caption付き投稿 %d（店確定 %d）| handle %d | %.0fMB",
                    total_posts, total_seed, len(seen_handles), total_mb)


if __name__ == "__main__":
    main()
