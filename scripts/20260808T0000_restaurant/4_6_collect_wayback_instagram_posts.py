#!/usr/bin/env python3
"""#1273 収集ルート5: Internet Archive の Wayback CDX から Instagram 投稿URLを無鍵・無料で拾う。

## なぜ Wayback CDX か（Common Crawl CDX との違い）

ルート4（4_5_collect_cc_instagram_posts）で分かった通り、**Common Crawl の URL index
(CDX) には instagram の投稿ページ (/p/ /reel/ /tv/) が 1 件も入っていない**。Instagram が
robots.txt でクロールを禁じ、CC はそれに従うため、CC は instagram のページ本体をクロール
対象として持たない。だから CC 側は «外向きリンク集» (WAT) を漁るしかなかった。

Internet Archive の Wayback は事情が違う。ユーザーの «Save Page Now»・各種セーブボット・
サードパーティのアーカイブ要求で、**instagram.com/p/<code>/ の permalink 本体が直接
アーカイブされている**。よって Wayback CDX を url=instagram.com/p/* で prefix 引きすると、
CC には無い «直接アーカイブされた投稿ページ» が列挙できる。CC(WAT の埋め込みリンク)とは
母集団の作られ方が独立（ブログが埋めた投稿 vs 誰かが保存した投稿）なので、重ねると母数が増える。

## CDX の使い方（無鍵・無料）

エンドポイント: https://web.archive.org/cdx/search/cdx
- url=instagram.com/p/*        末尾 * で prefix マッチ（matchType=prefix 相当）
- collapse=urlkey              同一 URL の複数キャプチャを 1 行に畳む（投稿の重複除去）
- fl=original                  元 URL だけ返させて転送量を落とす
- output=json
- showNumPages=true            そのクエリのページ総数 N を整数 1 個で返す（規模把握）
- page=<i>                     0..N-1 のページを順に取る（本体のページング）

CDX は 1 IP あたりのレート制限がきつく、負荷時は HTTP ではなく **TCP リセット / 接続断**で
落とす（429 を返さないことがある）。そのため各リクエストは指数バックオフで数回リトライし、
ページ間に間隔を空ける。全ページを 1 度に取り切るのは非現実的なので、`--max-pages` /
`--page-offset` で分割してバッチ（CI = db-script-run.yml）で回す。

## 書き込み（4_3 / 4_5 と同じ sns_post_raw 形式）

- post_id        = shortcode（business_discovery/検索/CC と同じ自然キーで跨ルート重複解決）
- provider       = 'instagram'
- canonical_url  = 'https://www.instagram.com/{p|reel|tv}/{code}/'（resolve への唯一の入力）
- discovery_route  = 'wayback_cdx'
- discovery_method = 'wayback_cdx'
- discovery_query  = 'wayback:{pattern}'   （どの prefix から拾ったか。監査用）
- account_id / area / category = NULL、caption は保存しない（resolve が URL から取り直す）

この環境（BQ 認証なし）では `--dry-run` で件数とサンプルだけ出す。書き込みは CI 側。
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

LOGGER = logging.getLogger(__name__)

CDX_ENDPOINT = "https://web.archive.org/cdx/search/cdx"
UA = "nanitabeyo-poc/1.0 (+https://github.com/Ayato-kosaka/nanitabeyo)"

# prefix パターン → resolve の投稿タイプ。/p/ /reel/ /tv/ の 3 系統を別々に引く
# （collapse=urlkey は同一 prefix 内でしか効かないので、3 本は別クエリにして各々畳む）。
PREFIX_PATTERNS = {
    "p": "instagram.com/p/*",
    "reel": "instagram.com/reel/*",
    "tv": "instagram.com/tv/*",
}

# CDX が返す original URL から shortcode を取る。handle が挟まる形も許す。
_POST_RE = re.compile(
    r"instagram\.com/(?:[A-Za-z0-9_.]{1,40}/)?(p|reel|tv)/([A-Za-z0-9_-]{5,20})",
    re.IGNORECASE,
)


def canonical_url(post_type: str, code: str) -> str:
    # 元の系統を保って URL を作る（reel/tv を p に潰さない）。
    return f"https://www.instagram.com/{post_type.lower()}/{code}/"


def _cdx_request(params: dict, *, timeout: float, retries: int, backoff: float) -> str:
    """CDX へ 1 リクエスト。接続断/一時エラーは指数バックオフでリトライして本文を返す。"""
    url = CDX_ENDPOINT + "?" + urllib.parse.urlencode(params)
    last_err = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            # 429/503 は一時。それ以外の 4xx はクエリ不正なので即やめる。
            if e.code in (429, 500, 502, 503, 504):
                last_err = f"http{e.code}"
            else:
                raise
        except Exception as e:  # 接続リセット・タイムアウト等（CDX の過負荷時の典型）
            last_err = str(e)[:80]
        if attempt < retries:
            time.sleep(backoff * (2 ** attempt))
    raise RuntimeError(f"CDX リクエスト失敗（{retries + 1} 回）: {last_err} :: {url}")


def num_pages(pattern: str, *, timeout: float, retries: int, backoff: float) -> int:
    """そのパターンの CDX ページ総数 N を返す（規模把握 & ページング範囲決め）。"""
    body = _cdx_request(
        {"url": pattern, "showNumPages": "true"},
        timeout=timeout, retries=retries, backoff=backoff,
    ).strip()
    try:
        return int(body)
    except ValueError:
        raise RuntimeError(f"showNumPages が整数でない: {body!r}")


def fetch_page(pattern: str, page: int, *, page_size: int | None,
               timeout: float, retries: int, backoff: float):
    """1 ページ分の original URL を返す（collapse=urlkey で重複キャプチャは畳み済み）。"""
    params = {
        "url": pattern,
        "output": "json",
        "fl": "original",
        "collapse": "urlkey",
        "page": page,
    }
    if page_size is not None:
        params["pageSize"] = page_size
    body = _cdx_request(params, timeout=timeout, retries=retries, backoff=backoff)
    body = body.strip()
    if not body:
        return []
    # output=json は行志向の JSON 配列: 先頭行はヘッダ ["original"]。堅牢に JSON で読む。
    try:
        rows = json.loads(body)
    except json.JSONDecodeError:
        # まれに壊れた行が混じる。行単位で拾えるものだけ拾う。
        rows = []
        for line in body.splitlines():
            line = line.strip().rstrip(",")
            if line.startswith("[") and line.endswith("]"):
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    out = []
    for i, row in enumerate(rows):
        if not row:
            continue
        val = row[0] if isinstance(row, list) else row
        if i == 0 and val == "original":  # ヘッダ行
            continue
        out.append(val)
    return out


def harvest_pattern(post_type: str, pattern: str, posts: dict[str, dict], *,
                    page_offset: int, max_pages: int | None, page_size: int | None,
                    max_posts: int | None, sleep_s: float,
                    timeout: float, retries: int, backoff: float) -> dict:
    """1 パターン (/p/ 等) を CDX ページングで舐め、shortcode を posts へ蓄積する。"""
    t0 = time.time()
    total_pages = num_pages(pattern, timeout=timeout, retries=retries, backoff=backoff)
    end = total_pages if max_pages is None else min(total_pages, page_offset + max_pages)
    pages_read = 0
    raw_urls = 0
    new_posts = 0
    for page in range(page_offset, end):
        urls = fetch_page(pattern, page, page_size=page_size,
                          timeout=timeout, retries=retries, backoff=backoff)
        pages_read += 1
        for u in urls:
            raw_urls += 1
            m = _POST_RE.search(u)
            if not m:
                continue
            code = m.group(2)
            if code in posts:
                continue
            posts[code] = {"post_type": m.group(1).lower(), "code": code}
            new_posts += 1
            if max_posts is not None and len(posts) >= max_posts:
                break
        LOGGER.info("  [%s] page=%d/%d urls=%d new=%d total_distinct=%d",
                    post_type, page, total_pages, len(urls), new_posts, len(posts))
        if max_posts is not None and len(posts) >= max_posts:
            break
        if sleep_s:
            time.sleep(sleep_s)
    return {
        "post_type": post_type,
        "pattern": pattern,
        "cdx_total_pages": total_pages,
        "pages_read": pages_read,
        "page_offset": page_offset,
        "raw_urls_seen": raw_urls,
        "new_distinct_posts": new_posts,
        "seconds": round(time.time() - t0, 1),
    }


def build_rows(posts: dict[str, dict], run_id: str, now_iso: str) -> list[dict]:
    rows = []
    for code, meta in posts.items():
        pattern = PREFIX_PATTERNS.get(meta["post_type"], "instagram.com/p/*")
        rows.append({
            "post_id": code,
            "provider": "instagram",
            "canonical_url": canonical_url(meta["post_type"], code),
            "account_id": None,
            "discovery_route": "wayback_cdx",
            "discovery_method": "wayback_cdx",
            "discovery_query": f"wayback:{pattern}",
            "discovery_seed_place_id": None,
            "discovery_area_lat": None,
            "discovery_area_lng": None,
            "discovery_category_id": None,
            "fetched_at": now_iso,
            "run_id": run_id,
        })
    return rows


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Wayback CDX から Instagram 投稿URLを収集し sns_post_raw へ入れる（ルート5・無鍵無料）"
    )
    p.add_argument("--run-id", default=None)
    p.add_argument("--types", default="p,reel,tv",
                   help="収集する投稿系統（カンマ区切り: p,reel,tv のうち）")
    p.add_argument("--max-pages", type=int, default=2,
                   help="1 パターンあたり読む CDX ページ数（CI 分割用）")
    p.add_argument("--page-offset", type=int, default=0,
                   help="CDX ページの開始インデックス（CI 分割用）")
    p.add_argument("--page-size", type=int, default=None,
                   help="1 ページの index ブロック数（CDX 既定に任せるなら未指定）")
    p.add_argument("--max-posts", type=int, default=None, help="収集 shortcode の上限（打ち切り）")
    p.add_argument("--sleep-ms", type=int, default=1500, help="CDX ページ取得間隔（レート制限に配慮）")
    p.add_argument("--timeout", type=float, default=120.0, help="1 リクエストのタイムアウト秒")
    p.add_argument("--retries", type=int, default=5, help="接続断/一時エラーのリトライ回数")
    p.add_argument("--backoff", type=float, default=3.0, help="リトライの基準バックオフ秒（指数）")
    p.add_argument("--numpages-only", action="store_true",
                   help="各パターンのページ総数だけ取って規模を出す（本体ページングはしない）")
    p.add_argument("--sample-out", default=None, help="サンプル shortcode を書き出す JSON パス")
    p.add_argument("--dry-run", action="store_true", help="BQ へ書かず件数とサンプルだけ出す")
    return p.parse_args(argv)


def main(argv=None) -> None:
    logging.basicConfig(level="INFO", format="%(asctime)s %(levelname)s %(name)s - %(message)s")
    args = parse_args(argv)
    sleep_s = max(args.sleep_ms, 0) / 1000.0
    types = [t.strip() for t in args.types.split(",") if t.strip() in PREFIX_PATTERNS]
    if not types:
        raise SystemExit("--types に有効な系統がありません（p,reel,tv）")

    # --numpages-only: 規模把握だけ（各パターンの CDX ページ総数）。
    if args.numpages_only:
        scale = {}
        for t in types:
            n = num_pages(PREFIX_PATTERNS[t], timeout=args.timeout,
                          retries=args.retries, backoff=args.backoff)
            scale[t] = {"pattern": PREFIX_PATTERNS[t], "cdx_total_pages": n}
            LOGGER.info("[%s] %s → num_pages=%d", t, PREFIX_PATTERNS[t], n)
            if sleep_s:
                time.sleep(sleep_s)
        LOGGER.info("NUMPAGES %s", json.dumps(scale, ensure_ascii=False))
        if args.sample_out:
            Path(args.sample_out).parent.mkdir(parents=True, exist_ok=True)
            Path(args.sample_out).write_text(
                json.dumps({"numpages": scale}, ensure_ascii=False, indent=2), encoding="utf-8")
        return

    posts: dict[str, dict] = {}
    pattern_stats = []
    for t in types:
        st = harvest_pattern(
            t, PREFIX_PATTERNS[t], posts,
            page_offset=args.page_offset, max_pages=args.max_pages,
            page_size=args.page_size, max_posts=args.max_posts, sleep_s=sleep_s,
            timeout=args.timeout, retries=args.retries, backoff=args.backoff,
        )
        pattern_stats.append(st)
        LOGGER.info("[%s] pages=%d raw=%d new=%d %.1fs total_distinct=%d",
                    t, st["pages_read"], st["raw_urls_seen"],
                    st["new_distinct_posts"], st["seconds"], len(posts))
        if args.max_posts is not None and len(posts) >= args.max_posts:
            break

    type_counts = {}
    for m in posts.values():
        type_counts[m["post_type"]] = type_counts.get(m["post_type"], 0) + 1
    summary = {
        "types": types,
        "page_offset": args.page_offset,
        "max_pages": args.max_pages,
        "distinct_posts": len(posts),
        "distinct_by_type": type_counts,
        "raw_urls_seen": sum(s["raw_urls_seen"] for s in pattern_stats),
        "cdx_total_pages_by_type": {s["post_type"]: s["cdx_total_pages"] for s in pattern_stats},
    }
    LOGGER.info("SUMMARY %s", json.dumps(summary, ensure_ascii=False))

    if args.sample_out:
        sample = [
            {"post_id": c, "canonical_url": canonical_url(m["post_type"], c),
             "post_type": m["post_type"]}
            for c, m in list(posts.items())[:5000]
        ]
        out = {"summary": summary, "patterns": pattern_stats, "sample": sample}
        Path(args.sample_out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.sample_out).write_text(
            json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        LOGGER.info("サンプル %d 件を書き出しました: %s", len(sample), args.sample_out)

    if args.dry_run:
        LOGGER.info("dry-run: BQ へは書きません。distinct=%d", len(posts))
        return

    # --- ここから BQ 書き込み（CI・要 BQ 認証）。4_5 と同じ冪等 upsert パターン。---
    from pipeline_common import BigQueryPipeline, require_run_id, utc_now  # noqa: WPS433
    from common_sns import TABLE_POST_RAW  # noqa: WPS433
    from google.cloud import bigquery  # noqa: WPS433

    run_id = require_run_id(args.run_id)
    now_iso = utc_now().isoformat()
    rows = build_rows(posts, run_id, now_iso)
    pipeline = BigQueryPipeline()
    with pipeline.step(run_id, "4_6_collect_wayback_instagram_posts", parameters={
        "types": types, "page_offset": args.page_offset, "max_pages": args.max_pages,
    }, repo_root=Path(__file__).resolve().parents[1]) as result:
        if rows:
            ids = sorted(posts.keys())
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
        LOGGER.info("sns_post_raw に %d 投稿を投入しました（Wayback CDX, types=%s）",
                    count, ",".join(types))


if __name__ == "__main__":
    main()
