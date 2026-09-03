#!/usr/bin/env python3
"""#1273 収集ルート4: Common Crawl から Instagram 投稿URLを無料・無鍵・大量に拾う。

## なぜ WAT か（CDX ではなく）

当初の勝ち筋は «CC の URL index (CDX) を url=instagram.com/p/* で引く» だった。
だが実測（1273_instagram_seed_poc/cc_instagram_index.py）で、**CC の URL index には
instagram.com の投稿ページ (/p/ /reel/ /tv/) が 1 件も入っていない**ことが分かった。
CC-MAIN-2026-34 の `com,instagram)` ブロックは robots.txt 取得 77 件と 404 の
プロフィール 1 件のみ。Instagram が robots.txt でクロールを禁じているため、CC は
instagram のページ本体を «クロール対象» として持たない。よって CDX 直引きは 0 本。

代わりに **WAT（各クロール済みページの外向きリンク集）** を使う。CC が実際にクロールした
ブログ・まとめ・グルメメディアが埋め込んだ instagram 投稿URLは、リンクとして WAT に残る。
実測 1 ファイルあたり distinct 投稿 ≒ 600 本、1 crawl = 100,000 WAT ファイル →
1 crawl あたり数千万本規模。これが account を 1 軒ずつ business_discovery で列挙する
（200 件/時）の壁を回避する経路。

## 書き込み

sns_post_raw へ 4_3 と同じ形で入れる（account_id=NULL の単体投稿）:
- post_id        = shortcode（business_discovery/検索と同じ自然キーで跨ルート重複解決）
- provider       = 'instagram'
- canonical_url  = 'https://www.instagram.com/{p|reel|tv}/{code}/'（resolve への唯一の入力）
- discovery_route  = 'cc_index'          （CC 由来。account/検索と区別）
- discovery_method = 'commoncrawl_wat'   （WAT 外向きリンク由来）
- discovery_query  = 'cc:{crawl}'        （どの crawl から拾ったか。監査用）
- run_id

caption には «リンク元ページの Title»（WAT payload の HTML-Metadata.Head.Title）を載せる
（#1273 option C）。search 経路(4_7)と同じく resolve へ渡すと IG を取りに行かず並列できる。

## 運用（CI = db-script-run.yml で回す）

WAT は 1 ファイル ≈ 600MB。全 100,000 ファイルを 1 度に流すのは非現実的なので、
`--max-files` / `--file-offset` で wat.paths を分割してバッチで回す。
この環境（BQ 認証なし）では `--dry-run` で件数とサンプルだけ出す。書き込みは CI 側。
"""

from __future__ import annotations

import argparse
import gzip
import json
import logging
import re
import time
import urllib.request
from pathlib import Path

LOGGER = logging.getLogger(__name__)

CC_HOST = "https://data.commoncrawl.org"
UA = "nanitabeyo-poc/1.0 (+https://github.com/Ayato-kosaka/nanitabeyo)"

# 投稿URL（外向きリンク）から shortcode を取る。/p/ /reel/ /tv/ の 3 系統。
# 直前に handle が挟まる形（instagram.com/<handle>/p/<code>）も許す。
_POST_RE = re.compile(
    r"instagram\.com/(?:[A-Za-z0-9_.]{1,40}/)?(p|reel|tv)/([A-Za-z0-9_-]{5,20})",
    re.IGNORECASE,
)
# WAT の各レコードのリンク元ページ（このページが instagram 投稿を埋め込んでいた）。
_TARGET_RE = re.compile(rb"^WARC-Target-URI:\s*(\S+)")
_HOST_RE = re.compile(r"^https?://([^/]+)/?", re.IGNORECASE)


def _is_jp_host(host: str) -> bool:
    host = host.lower()
    return host.endswith(".jp") or ".jp:" in host or host.endswith(".jp/")


def canonical_url(post_type: str, code: str) -> str:
    # resolve は type を問わないが、元の系統を保って URL を作る（reel/tv を p に潰さない）。
    return f"https://www.instagram.com/{post_type.lower()}/{code}/"


def _open_stream(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    resp = urllib.request.urlopen(req, timeout=600)
    return gzip.GzipFile(fileobj=resp)


def list_wat_paths(crawl: str) -> list[str]:
    url = f"{CC_HOST}/crawl-data/{crawl}/wat.paths.gz"
    raw = urllib.request.urlopen(
        urllib.request.Request(url, headers={"User-Agent": UA}), timeout=180
    ).read()
    return gzip.decompress(raw).decode("utf-8").splitlines()


# #1273 option C: WAT payload(JSON)の元ページ Title を caption にする。resolve へ渡すと
# IG を取りに行かず並列できる（search 経路と同じ）。Title は住所が薄いのでカテゴリ寄り。
_TITLE_RE = re.compile(rb'"Title"\s*:\s*"((?:\\.|[^"\\]){1,400})"')


def _extract_title(line: bytes) -> str | None:
    """WAT payload 行から元ページ Title を取り出し JSON エスケープを戻す。"""
    m = _TITLE_RE.search(line)
    if not m:
        return None
    try:
        return json.loads('"' + m.group(1).decode("utf-8", "replace") + '"') or None
    except Exception:
        return m.group(1).decode("utf-8", "replace") or None


def harvest_wat_file(path: str, *, jp_only: bool, max_posts: int | None,
                     posts: dict[str, dict]) -> dict:
    """WAT 1 ファイルを stream で読み、instagram 投稿 shortcode を posts へ蓄積する。

    posts: shortcode -> {post_type, code, source_page, source_host, is_jp}
    戻り値: このファイル単体の統計。
    """
    url = f"{CC_HOST}/{path}"
    t0 = time.time()
    pages = 0
    file_hits = 0
    file_new = 0
    cur_page = ""
    cur_host = ""
    cur_jp = False
    gz = _open_stream(url)
    while True:
        try:
            line = gz.readline()
        except Exception:  # 途中で切れても、そこまでの収穫は活かす
            break
        if not line:
            break
        m = _TARGET_RE.match(line)
        if m:
            pages += 1
            cur_page = m.group(1).decode("utf-8", "replace")
            hm = _HOST_RE.match(cur_page)
            cur_host = hm.group(1) if hm else ""
            cur_jp = _is_jp_host(cur_host)
            continue
        if b"instagram.com" not in line:
            continue
        text = line.decode("utf-8", "replace")
        # この payload(JSON)行の元ページ Title を caption にする（#1273 option C）。
        cur_caption = _extract_title(line)
        for pm in _POST_RE.finditer(text):
            file_hits += 1
            if jp_only and not cur_jp:
                continue
            code = pm.group(2)
            if code in posts:
                continue
            posts[code] = {
                "post_type": pm.group(1).lower(),
                "code": code,
                "source_page": cur_page,
                "source_host": cur_host,
                "is_jp": cur_jp,
                "caption": cur_caption,
            }
            file_new += 1
            if max_posts is not None and len(posts) >= max_posts:
                break
        if max_posts is not None and len(posts) >= max_posts:
            break
    return {
        "file": path.split("/")[-1],
        "pages": pages,
        "raw_link_hits": file_hits,
        "new_distinct_posts": file_new,
        "seconds": round(time.time() - t0, 1),
    }


def build_rows(posts: dict[str, dict], crawl: str, run_id: str, now_iso: str) -> list[dict]:
    rows = []
    for code, meta in posts.items():
        rows.append({
            "post_id": code,
            "provider": "instagram",
            "canonical_url": canonical_url(meta["post_type"], code),
            "account_id": None,
            "discovery_route": "cc_index",
            "discovery_method": "commoncrawl_wat",
            "discovery_query": f"cc:{crawl}",
            "discovery_seed_place_id": None,
            "discovery_area_lat": None,
            "discovery_area_lng": None,
            "discovery_category_id": None,
            "caption": meta.get("caption"),
            "fetched_at": now_iso,
            "run_id": run_id,
        })
    return rows


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Common Crawl WAT から Instagram 投稿URLを収集し sns_post_raw へ入れる（ルート4・無鍵無料）"
    )
    p.add_argument("--run-id", default=None)
    p.add_argument("--crawl", default="CC-MAIN-2026-34", help="対象 crawl（index.commoncrawl.org の一覧）")
    p.add_argument("--max-files", type=int, default=4, help="このバッチで読む WAT ファイル数")
    p.add_argument("--file-offset", type=int, default=0, help="wat.paths の開始インデックス（CI 分割用）")
    p.add_argument("--jp-only", action="store_true", help="リンク元ページが .jp のものだけ残す")
    p.add_argument("--max-posts", type=int, default=None, help="収集 shortcode の上限（打ち切り）")
    p.add_argument("--sample-out", default=None, help="サンプル shortcode を書き出す JSON パス")
    p.add_argument("--dry-run", action="store_true", help="BQ へ書かず件数とサンプルだけ出す")
    return p.parse_args(argv)


def main(argv=None) -> None:
    logging.basicConfig(level="INFO", format="%(asctime)s %(levelname)s %(name)s - %(message)s")
    args = parse_args(argv)

    paths = list_wat_paths(args.crawl)
    batch = paths[args.file_offset: args.file_offset + args.max_files]
    LOGGER.info("crawl=%s wat_files=%d このバッチ=%d (offset=%d)",
                args.crawl, len(paths), len(batch), args.file_offset)

    posts: dict[str, dict] = {}
    file_stats = []
    for path in batch:
        st = harvest_wat_file(path, jp_only=args.jp_only, max_posts=args.max_posts, posts=posts)
        file_stats.append(st)
        LOGGER.info("  %s pages=%d hits=%d new=%d %.1fs total_distinct=%d",
                    st["file"], st["pages"], st["raw_link_hits"],
                    st["new_distinct_posts"], st["seconds"], len(posts))
        if args.max_posts is not None and len(posts) >= args.max_posts:
            break

    jp_count = sum(1 for m in posts.values() if m["is_jp"])
    cap_count = sum(1 for m in posts.values() if m.get("caption"))
    summary = {
        "crawl": args.crawl,
        "wat_files_total": len(paths),
        "wat_files_read": len(file_stats),
        "file_offset": args.file_offset,
        "jp_only": args.jp_only,
        "distinct_posts": len(posts),
        "distinct_posts_jp_source": jp_count,
        "distinct_posts_with_caption": cap_count,
        "caption_rate": round(cap_count / max(len(posts), 1), 3),
        "mean_distinct_per_file": round(
            sum(s["new_distinct_posts"] for s in file_stats) / max(len(file_stats), 1), 1
        ),
    }
    LOGGER.info("SUMMARY %s", json.dumps(summary, ensure_ascii=False))

    if args.sample_out:
        sample = [
            {
                "post_id": code,
                "canonical_url": canonical_url(m["post_type"], code),
                "post_type": m["post_type"],
                "source_host": m["source_host"],
                "is_jp": m["is_jp"],
                "caption": m.get("caption"),
            }
            for code, m in list(posts.items())[:5000]
        ]
        out = {"summary": summary, "files": file_stats, "sample": sample}
        Path(args.sample_out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.sample_out).write_text(
            json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        LOGGER.info("サンプル %d 件を書き出しました: %s", len(sample), args.sample_out)

    if args.dry_run:
        LOGGER.info("dry-run: BQ へは書きません。distinct=%d（うち jp-source=%d）",
                    len(posts), jp_count)
        return

    # --- ここから BQ 書き込み（CI・要 BQ 認証）---
    from pipeline_common import BigQueryPipeline, require_run_id, utc_now  # noqa: WPS433
    from common_sns import TABLE_POST_RAW  # noqa: WPS433
    from google.cloud import bigquery  # noqa: WPS433

    run_id = require_run_id(args.run_id)
    now_iso = utc_now().isoformat()
    rows = build_rows(posts, args.crawl, run_id, now_iso)
    pipeline = BigQueryPipeline()
    with pipeline.step(run_id, "4_5_collect_cc_instagram_posts", parameters={
        "crawl": args.crawl, "wat_files_read": len(file_stats),
        "file_offset": args.file_offset, "jp_only": args.jp_only,
    }, repo_root=Path(__file__).resolve().parents[1]) as result:
        if rows:
            # 同 run 内の再実行を冪等にする（4_3 と同じく post_id 単位で消してから入れ直す）。
            ids = sorted(posts.keys())
            # IN UNNEST は大きすぎると重いので分割する。
            for i in range(0, len(ids), 5000):
                chunk = ids[i:i + 5000]
                pipeline.execute(
                    f"DELETE FROM `{pipeline.table(TABLE_POST_RAW)}` "
                    f"WHERE run_id=@rid AND post_id IN UNNEST(@ids)",
                    [bigquery.ScalarQueryParameter("rid", "STRING", run_id),
                     bigquery.ArrayQueryParameter("ids", "STRING", chunk)],
                )
        count = pipeline.load_json_rows(TABLE_POST_RAW, rows) if rows else 0
        result["row_count"] = count
        LOGGER.info("sns_post_raw に %d 投稿を投入しました（crawl=%s, WAT %d ファイル）",
                    count, args.crawl, len(file_stats))


if __name__ == "__main__":
    main()
