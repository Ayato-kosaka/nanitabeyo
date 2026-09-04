#!/usr/bin/env python3
"""#1273 日本のローカルグルメ媒体を丸ごと読み、Instagram 投稿URL＋キャプション＋地域を採る。

## なぜこれが要るか（#1812）
CC WAT（4_9）を回して分かったのは «投稿そのもの» より «どのサイトが濃いか» の方が
価値がある、ということだった。CC の日本語ページ全体では matched 1.65% しか出ないが、
飲食語彙を含む投稿を host で数えると、上位は明らかに日本のローカルグルメ媒体である
（okayamagourmet.com 216 / onisanpo.com 106 / gurutto-aizu.com 52 /
 *.goguynet.jp / *.local-now.jp / favy.jp …）。

つまり CC は «濃い井戸を見つける道具» として使い、井戸そのものは sitemap から
汲み尽くす方が桁で効率が良い。CC は 10 万ファイルを舐めて偶然その記事に当たるのを待つが、
sitemap を辿れば同じ媒体の記事を 1 本残らず読める。

## この経路が強い理由
記事タイトルが «【大阪市東成区】…森ノ宮のお洒落な焼肉店「肉と美人」で…» の形をしていて、
**市区町村・店名・料理カテゴリが 1 行に揃っている**。埋め込みが投稿URLとキャプションを、
タイトルが «どこの何屋か» を与えるので、resolve に渡す材料が全部そろう。

実測（higashinari-ikuno.goguynet.jp の記事 12 本）: 3 本に Instagram 埋め込み、投稿 5 件。
1 サイト 1,091 記事 → 約 450 投稿。

## 使い方（db-script-run.yml）
  args: --run-id sns-2026-09-04-media --hosts-from-run-ids sns-2026-09-04-ccwat4 --shards 4 --shard 0
"""
from __future__ import annotations

import argparse
import logging
import re
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import timezone

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now
from common_sns import (PROVIDER_INSTAGRAM, TABLE_POST_RAW,
                        area_from_text, build_city_index, city_index_sql)
from sns_html import RE_KANA, captions_from_html, decode_html, page_text

LOGGER = logging.getLogger(__name__)
UA = {"User-Agent": "Mozilla/5.0 (compatible; nanitabeyo-research/1.0; +github.com/Ayato-kosaka/nanitabeyo)",
      "Accept-Language": "ja,en;q=0.8"}
RE_LOC = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>", re.I)
SITEMAP_CANDIDATES = ("/sitemap.xml", "/wp-sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml")
# 記事ではないページ（一覧・タグ・作者・固定ページ）は投稿を持たないことが多く、
# 読むだけ無駄なうえ相手にも負荷をかける。
RE_SKIP = re.compile(r"/(tag|category|author|page|feed|wp-json|search)/", re.I)


def _get(url: str, limit: int = 1_500_000) -> bytes | None:
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=25) as r:
            raw = r.read(limit)
    except Exception:  # noqa: BLE001 - 到達できないサイトは飛ばす
        return None
    if url.endswith(".gz"):
        import gzip
        try:
            return gzip.decompress(raw)
        except Exception:  # noqa: BLE001
            return raw
    return raw


def _robots_allows(host: str) -> bool:
    """robots.txt を尊重する。取得できない場合は許可（4_4 の robots_allows と同じ既定）。"""
    raw = _get(f"https://{host}/robots.txt", 20000)
    if raw is None:
        return True
    text = decode_html(raw)
    # 全体 Disallow: / を宣言している媒体だけ避ける。個別パスは記事URL側で見る。
    agent_all = False
    for line in text.splitlines():
        line = line.split("#")[0].strip()
        if not line:
            continue
        k, _, v = line.partition(":")
        k, v = k.strip().lower(), v.strip()
        if k == "user-agent":
            agent_all = v == "*"
        elif k == "disallow" and agent_all and v == "/":
            return False
    return True


def article_urls(host: str, max_urls: int) -> list[str]:
    """sitemap を辿って記事URLを列挙する。sitemap index は 1 段だけ展開する。"""
    seen: list[str] = []
    for path in SITEMAP_CANDIDATES:
        raw = _get(f"https://{host}{path}", 4_000_000)
        if not raw or b"<loc" not in raw:
            continue
        locs = RE_LOC.findall(decode_html(raw))
        children = [u for u in locs if "sitemap" in u.lower()]
        pages = [u for u in locs if "sitemap" not in u.lower()]
        for child in children[:40]:
            sub = _get(child, 8_000_000)
            if sub:
                pages += [u for u in RE_LOC.findall(decode_html(sub)) if "sitemap" not in u.lower()]
            if len(pages) >= max_urls * 2:
                break
        for u in pages:
            if not RE_SKIP.search(u):
                seen.append(u)
        if seen:
            break
    # 新しい記事ほど店が現存している見込みが高いので後ろから採る
    return list(dict.fromkeys(reversed(seen)))[:max_urls]


def scan_article(url: str, by_pair, uniq) -> list[dict]:
    raw = _get(url)
    if raw is None:
        return []
    caps = captions_from_html(raw)
    if not caps:
        return []
    page = page_text(raw).strip()
    # 記事タイトルは «【市区町村】…店名…料理» の形で、店とカテゴリの手掛かりそのもの。
    # 1 記事に 4 件以上埋まっているものは «まとめ記事» でタイトルと投稿が対応しないので付けない。
    attach_page = len(caps) <= 3 and bool(page)
    area = area_from_text(page, by_pair, uniq)
    host = urllib.parse.urlparse(url).netloc.lower()
    rows = []
    for code, cap in caps.items():
        caption = f"{cap} / {page}" if (cap and attach_page) else (cap or (page if attach_page else ""))
        if not caption or not RE_KANA.search(caption):
            continue
        rows.append({"post_id": code, "caption": caption[:2000], "host": host, "area": area})
    return rows


def network_hosts(index_urls: list[str]) -> list[str]:
    """媒体ネットワークの索引ページから、同じドメインのサブドメインを列挙する。

    号外NET（goguynet.jp）は市区町村ごとにサブドメインを分けていて、実測で 285 サイトある。
    1 サイト約 1,000 記事なので、ここだけで «全国の市区町村に散った» 記事が 28 万本ある。
    ハードコードせず索引から採るので、サイトが増えても追随する。
    """
    out: list[str] = []
    for idx in index_urls:
        parent = urllib.parse.urlparse(idx).netloc.lower()
        if not parent:
            continue
        raw = _get(idx, 4_000_000)
        if raw is None:
            continue
        pat = re.compile(r"https?://([a-z0-9\-]+)\." + re.escape(parent), re.I)
        subs = sorted({m.lower() for m in pat.findall(decode_html(raw))})
        LOGGER.info("  %s: サブドメイン %d 件", parent, len(subs))
        out += [f"{s}.{parent}" for s in subs if s not in ("www",)]
    return out


def _read_hosts(pipeline: BigQueryPipeline, run_ids: list[str], min_posts: int, limit: int) -> list[str]:
    """CC WAT の結果から «飲食の投稿が濃い host» を採る。井戸を見つけるのは CC の役目。"""
    from google.cloud import bigquery
    sql = f"""
      SELECT discovery_query host, COUNT(*) n
      FROM `{pipeline.table(TABLE_POST_RAW)}`
      WHERE run_id IN UNNEST(@rids) AND discovery_query IS NOT NULL
        AND REGEXP_CONTAINS(caption, r'ランチ|グルメ|美味し|おいし|居酒屋|ラーメン|カフェ|焼肉|寿司|そば|うどん|定食|食堂|カレー|スイーツ|ケーキ|天ぷら|餃子|焼鳥|海鮮|ステーキ|パスタ|ピザ|酒場|テイクアウト|メニュー|営業時間')
      GROUP BY 1 HAVING n >= @minp ORDER BY n DESC LIMIT {int(limit)}
    """
    params = [bigquery.ArrayQueryParameter("rids", "STRING", run_ids),
              bigquery.ScalarQueryParameter("minp", "INT64", min_posts)]
    return [r["host"] for r in pipeline.execute(sql, params)]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="日本のローカルグルメ媒体を sitemap から汲み尽くす")
    p.add_argument("--run-id", default=None)
    p.add_argument("--catalog-run-id", default="restaurant-2026-08-23")
    p.add_argument("--hosts-from-run-ids", default="",
                   help="濃い host を数える sns_post_raw の run_id（カンマ区切り）")
    p.add_argument("--extra-hosts", default="", help="追加で読む host（カンマ区切り）")
    p.add_argument("--network-index-urls", default="",
                   help="媒体ネットワークの索引ページ（カンマ区切り）。サブドメインを列挙して読む")
    p.add_argument("--min-posts", type=int, default=3, help="host を採る最小の飲食投稿数")
    p.add_argument("--max-hosts", type=int, default=400)
    p.add_argument("--max-urls-per-host", type=int, default=1500)
    p.add_argument("--shards", type=int, default=1)
    p.add_argument("--shard", type=int, default=0)
    p.add_argument("--workers", type=int, default=6, help="1 host 内で同時に読む記事数")
    p.add_argument("--flush-every", type=int, default=1, help="何 host ごとに BQ へ流すか")
    p.add_argument("--dry-run", action="store_true")
    return p.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()
    from google.cloud import bigquery

    by_pair, uniq = build_city_index(pipeline.execute(
        city_index_sql(pipeline.table("restaurant_catalog")),
        [bigquery.ScalarQueryParameter("crid", "STRING", args.catalog_run_id)]))
    LOGGER.info("市区町村 %d 件（全国で一意 %d 件）", len(by_pair), len(uniq))

    hosts: list[str] = []
    if args.hosts_from_run_ids:
        hosts = _read_hosts(pipeline, [x.strip() for x in args.hosts_from_run_ids.split(",") if x.strip()],
                            args.min_posts, args.max_hosts)
    if args.network_index_urls:
        hosts += network_hosts([u.strip() for u in args.network_index_urls.split(",") if u.strip()])
    hosts += [h.strip() for h in args.extra_hosts.split(",") if h.strip()]
    hosts = list(dict.fromkeys(hosts))
    mine = [h for i, h in enumerate(hosts) if i % max(args.shards, 1) == args.shard]
    LOGGER.info("host %d 件中このシャードは %d 件", len(hosts), len(mine))

    with pipeline.step(run_id, "4_12_crawl_gourmet_media", parameters={
        "hosts": len(mine), "shards": args.shards, "shard": args.shard,
    }, repo_root=None) as result:
        now = utc_now().astimezone(timezone.utc).isoformat()
        rows: list[dict] = []
        seen: set[str] = set()
        total = with_area = 0

        def flush() -> None:
            nonlocal rows
            if rows and not args.dry_run:
                pipeline.load_json_rows(TABLE_POST_RAW, rows)
            rows = []

        for n, host in enumerate(mine, 1):
            if not _robots_allows(host):
                LOGGER.info("  %s: robots で全面禁止。飛ばします", host)
                continue
            urls = article_urls(host, args.max_urls_per_host)
            if not urls:
                LOGGER.info("  %s: sitemap から記事URLを採れませんでした", host)
                continue
            pool = ThreadPoolExecutor(max_workers=max(args.workers, 1))
            got = 0
            for found in pool.map(lambda u: scan_article(u, by_pair, uniq), urls):
                for r in found:
                    if r["post_id"] in seen:
                        continue
                    seen.add(r["post_id"])
                    total += 1
                    got += 1
                    if r["area"]:
                        with_area += 1
                    rows.append({
                        "post_id": r["post_id"], "provider": PROVIDER_INSTAGRAM,
                        "canonical_url": f"https://www.instagram.com/p/{r['post_id']}/",
                        "account_id": None, "discovery_route": "gourmet_media",
                        "discovery_method": "media_embed", "discovery_query": r["host"],
                        "discovery_seed_place_id": None,
                        "discovery_area_lat": r["area"][0] if r["area"] else None,
                        "discovery_area_lng": r["area"][1] if r["area"] else None,
                        "discovery_category_id": None, "fetched_at": now, "run_id": run_id,
                        "caption": r["caption"], "author_name": None,
                    })
            pool.shutdown()
            LOGGER.info("  %d/%d %s: 記事 %d → 投稿 %d（累計 %d / 地点あり %d）",
                        n, len(mine), host, len(urls), got, total, with_area)
            if n % args.flush_every == 0:
                flush()
            time.sleep(1)  # 媒体を連続で叩かない
        flush()
        result["row_count"] = total
        result["with_area"] = with_area
        LOGGER.info("完了: 投稿 %d（地点あり %d）| host %d", total, with_area, len(mine))


if __name__ == "__main__":
    main()
