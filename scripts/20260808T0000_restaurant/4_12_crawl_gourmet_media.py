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

## sitemap を持たない host を捨てないための第二経路（#1273）
sitemap は «あれば速い» だけで、**持っていない媒体が未クロール host の 38%** ある
（CC WAT 由来の未クロール host 123 件を実測: sitemap あり 76 / 無し 47）。
そこを «sitemap から記事URLを採れませんでした» で黙って飛ばしていたので、その 38% は
**記事を 1 本も読まないまま捨てられていた**（CC WAT で飲食投稿 2 位の okayamagourmet.com も含む）。

そこで sitemap が空だったときに限り、**Common Crawl の URL index（CDX）から
そのホストの URL 一覧を引いて記事URLを作る**。CDX は SURT 昇順なので該当ブロックだけ
Range 取得すれば済む（アクセスは CC に対してだけで、相手サーバには 1 リクエストも増えない）。
CDX は画像・CSS・タグ一覧も返すので `is_article_url` で記事らしいものへ絞る。
robots の尊重・記事の読み方・レート制御は sitemap 経路とまったく同じものを通る。

実測（未クロール host を先頭 12 記事だけ読み、`scan_article` が返す行で数えた。
**埋め込みの数で数えてはいけない**。キャプションを持たない埋め込みは行にならず、
okayamagourmet.com は 12 記事に埋め込み 244 個ありながら行は 0 だった）:

| 経路 | host | 記事URL(中央/平均) | 行が出た host | 行が出た記事 | 行 | 記事1本あたり |
| --- | --- | --- | --- | --- | --- | --- |
| CDX（sitemap 無し 47 host） | 47 | 82 / 428 | 16 (34%) | 12.0% | 95 | 0.18 |
| sitemap（未クロール 20 host） | 20 | 499 / 1145 | 2 (10%) | 1.9% | 6 | 0.03 |

**同じ «CC WAT 由来の未クロール host» の中では、CDX 経路の方が単価が高い**（0.18 vs 0.03）。
sitemap 側が低いのは、濃い host を 4_12 が既に汲み尽くしていて、残りが薄いため。
どちらにせよ CDX 経路の 47 host はこれまで 1 行も採れていなかった。

## 使い方（db-script-run.yml）
  args: --run-id sns-2026-09-04-media --hosts-from-run-ids sns-2026-09-04-ccwat4 --shards 4 --shard 0
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import tempfile
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import timezone

import cc_cdx
from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now
from common_sns import (PROVIDER_INSTAGRAM, TABLE_POST_RAW,
                        area_from_text, build_city_index, city_index_sql)
from sns_html import (RE_KANA, captions_from_html, decode_html, handles_from_html,
                      page_text, store_name_from_text)

LOGGER = logging.getLogger(__name__)
UA = {"User-Agent": "Mozilla/5.0 (compatible; nanitabeyo-research/1.0; +github.com/Ayato-kosaka/nanitabeyo)",
      "Accept-Language": "ja,en;q=0.8"}
RE_LOC = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>", re.I)
SITEMAP_CANDIDATES = ("/sitemap.xml", "/wp-sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml")
# 記事ではないページ（一覧・タグ・作者・固定ページ）は投稿を持たないことが多く、
# 読むだけ無駄なうえ相手にも負荷をかける。
RE_SKIP = re.compile(r"/(tag|category|author|page|feed|wp-json|search)/", re.I)

# ---- CDX 経路（sitemap が無い host のフォールバック）専用の «記事らしさ» --------------
# sitemap は媒体自身が «読ませたいページ» を挙げたものなので、ほぼ記事しか入っていない。
# CDX は CC がその host で見た URL を**全部**返すので、画像・CSS・タグ一覧・カートまで来る。
# 記事でないものを読むのは相手への無駄なアクセスなので、ここで落とす。
RE_CDX_ASSET = re.compile(
    r"\.(jpe?g|png|gif|webp|avif|svg|ico|bmp|css|js|mjs|map|json|xml|txt|csv|pdf|zip|gz|tar|"
    r"mp3|mp4|m4a|mov|avi|wmv|webm|woff2?|ttf|otf|eot|doc|docx|xls|xlsx|ppt|pptx)$", re.I)
# `/archives/12345` は多くのブログで «記事そのもの» なのでここには入れない（日付だけの
# アーカイブ一覧は RE_CDX_DATE_ARCHIVE が落とす）。
RE_CDX_SKIP_PATH = re.compile(
    r"/(wp-content|wp-admin|wp-includes|wp-json|xmlrpc\.php|comment-page-\d+|trackback|embed|amp|"
    r"cart|checkout|my-?account|login|signup|register|mypage|privacy|policy|contact|inquiry|"
    r"sitemap[^/]*|tags?|categor(y|ies)|author|feed|rss|atom|comments|attachment|search|date)(/|$)", re.I)
# 日付アーカイブ（`/2026/09/`・`/gourmet/2026/`）は記事ではなく記事の一覧。
# 年月日の後ろにスラッグが続くものだけ記事とみなす。
RE_CDX_DATE_ARCHIVE = re.compile(r"^(/[a-z]+)?/(\d{4})(/\d{1,2}){0,2}/?$", re.I)
# クエリ付き URL は基本落とす。WordPress の `?p=123` 系だけは記事の実体なので残す。
RE_CDX_ARTICLE_QUERY = re.compile(r"(p|page_id|post|post_id|id|entry)=\d+$", re.I)
# «新しい記事から読む» ための並び替えキー。CC の取得時刻は 1 クロール内で 2 週間しか
# 幅が無く記事の新しさを表さないので、URL に埋まっている年と末尾の連番を見る。
RE_URL_YEAR = re.compile(r"/(20[0-3]\d)(?:/|-|_)")
RE_URL_SERIAL = re.compile(r"(\d{2,10})/?$")
CDX_CRAWL = "CC-MAIN-2026-34"
CDX_CACHE_DIR = os.path.join(tempfile.gettempdir(), "cc_index")
# 1 host は CDX の連続した数ブロックに収まる。ここを大きくしても該当しないブロックは
# 先頭で打ち切るので、巨大な host（数十万 URL）に届く余裕として持つだけ。
CDX_MAX_BLOCKS = 40
# 記事URLをどちらの経路で採ったかを sns_post_raw に残すための値。
DISCOVERY_METHOD = {"sitemap": "media_embed", "cdx": "media_embed_cdx"}


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


def is_article_url(url: str, host: str) -> bool:
    """CDX が返した URL のうち «記事本文のページ» だけを通す。

    落とすもの: 別ホスト / トップページ / 画像・CSS などの資産 / 一覧（タグ・カテゴリ・
    日付アーカイブ・ページャ）/ 管理系・カート・問い合わせ / 記事 id 以外のクエリ付き。
    """
    try:
        p = urllib.parse.urlsplit(url)
    except ValueError:
        return False
    if p.scheme not in ("http", "https"):
        return False
    h = p.netloc.lower().split(":")[0].removeprefix("www.")
    if h != host.lower().removeprefix("www."):
        return False
    path = p.path or "/"
    article_query = bool(p.query) and bool(RE_CDX_ARTICLE_QUERY.fullmatch(p.query))
    if p.query and not article_query:
        return False
    # `/?p=1234` は WordPress の記事そのもの。パスが `/` でも記事として扱う。
    if path == "/" and not article_query:
        return False
    if RE_SKIP.search(path) or RE_CDX_SKIP_PATH.search(path) or RE_CDX_ASSET.search(path):
        return False
    if RE_CDX_DATE_ARCHIVE.match(path):
        return False
    return True


def _cdx_order_key(url: str) -> tuple[int, int, str]:
    """新しい記事ほど先に読むための並び順。年 → 末尾の連番 → URL の降順。"""
    path = urllib.parse.urlsplit(url).path
    year = RE_URL_YEAR.search(path)
    serial = RE_URL_SERIAL.search(path.rstrip("/") or "/")
    return (int(year.group(1)) if year else 0,
            int(serial.group(1)[-9:]) if serial else 0,
            path)


_CDX_INDEX: dict[str, tuple[list[list[str]], list[str]]] = {}


def _cdx_index(crawl: str, cache_dir: str) -> tuple[list[list[str]], list[str]]:
    """cluster.idx は 100MB あるので、CDX を実際に引く host が出るまで落とさない。"""
    if crawl not in _CDX_INDEX:
        rows = cc_cdx.load_cluster_idx(crawl, cache_dir)
        _CDX_INDEX[crawl] = (rows, [r[0] for r in rows])
    return _CDX_INDEX[crawl]


def cdx_article_urls(host: str, max_urls: int, skip_urls: int = 0,
                     crawl: str = CDX_CRAWL, cache_dir: str = CDX_CACHE_DIR) -> list[str]:
    """sitemap を持たない host の記事URLを Common Crawl の URL index から作る。"""
    rows, keys = _cdx_index(crawl, cache_dir)
    # `)` まで付けるのが要点。付けないと `okayamagourmet2.com` のような別ホストまで入る。
    pfx = cc_cdx.surt_prefix(host) + ")"
    urls: set[str] = set()
    lines = 0
    for line in cc_cdx.iter_cdx_lines(pfx, rows, keys, crawl, max_blocks=CDX_MAX_BLOCKS):
        lines += 1
        try:
            rec = json.loads(line.split(" ", 2)[2])
        except (IndexError, ValueError):
            continue
        if rec.get("status") != "200":
            continue
        mime = (rec.get("mime-detected") or rec.get("mime") or "").lower()
        if mime and "html" not in mime:
            continue
        url = (rec.get("url") or "").split("#")[0]
        if is_article_url(url, host):
            urls.add(url)
    LOGGER.info("  %s: CDX %d 行 → 記事らしい URL %d 本", host, lines, len(urls))
    ordered = sorted(urls, key=_cdx_order_key, reverse=True)
    return ordered[skip_urls:skip_urls + max_urls]


def article_urls(host: str, max_urls: int, skip_urls: int = 0) -> list[str]:
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
    # 新しい記事ほど店が現存している見込みが高いので後ろから採る。
    # skip_urls は «浅く読んだ続きから読む» ための飛ばし幅。同じ記事を 2 度取りに行くと
    # 相手のサーバに無駄な負荷をかけるので、深掘りの回は必ずここで前回ぶんを飛ばす。
    return list(dict.fromkeys(reversed(seen)))[skip_urls:skip_urls + max_urls]


def article_urls_with_source(host: str, max_urls: int, skip_urls: int = 0,
                             cdx_crawl: str | None = None,
                             cdx_cache_dir: str = CDX_CACHE_DIR) -> tuple[list[str], str]:
    """記事URLと «どこから採ったか»。sitemap が空のときだけ CDX へ落ちる。

    ここが唯一の分岐点。`article_urls`（sitemap）と `cdx_article_urls`（CDX）は
    どちらも «記事URLの一覧» を返すだけで、優先順位を知らない。
    """
    urls = article_urls(host, max_urls, skip_urls)
    if urls or not cdx_crawl:
        return urls, "sitemap"
    # ここに来る host が未クロール host の 38% ある。CDX で救う（→ モジュール冒頭の説明）。
    return cdx_article_urls(host, max_urls, skip_urls, cdx_crawl, cdx_cache_dir), "cdx"


def scan_article(url: str, by_pair, uniq) -> list[dict]:
    raw = _get(url)
    if raw is None:
        return []
    caps = captions_from_html(raw)
    if not caps:
        return []
    # 投稿者 handle は柱2 の在庫になる。HTTP は増えない（同じ HTML を読むだけ）
    handles = handles_from_html(raw)
    page = page_text(raw).strip()
    # 記事タイトルは «【市区町村】…店名…料理» の形で、店とカテゴリの手掛かりそのもの。
    # 1 記事に 4 件以上埋まっているものは «まとめ記事» でタイトルと投稿が対応しないので付けない。
    attach_page = len(caps) <= 3 and bool(page)
    area = area_from_text(page, by_pair, uniq)
    # 記事見出しの『』「」は店名。**キャプションの先頭に 📍 行として合成する。**
    # resolve 側には 📍行 を exact-name のヒントとして読む仕組み（extractPinNames）が
    # あるので、API を変えずに «この投稿はこの店の話» を伝えられる。
    # author_name（＝投稿した Instagram アカウント）にはこれを入れない。責務が違う。
    store_name = store_name_from_text(page)
    host = urllib.parse.urlparse(url).netloc.lower()
    rows = []
    for code, cap in caps.items():
        caption = f"{cap} / {page}" if (cap and attach_page) else (cap or (page if attach_page else ""))
        if not caption or not RE_KANA.search(caption):
            continue
        if store_name:
            caption = f"📍{store_name}\n{caption}"
        rows.append({"post_id": code, "caption": caption[:2000], "host": host,
                     "area": area, "handle": handles.get(code)})
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
    p.add_argument("--skip-urls-per-host", type=int, default=0,
                   help="新しい方から数えて何本の記事を飛ばすか（浅く読んだ続きを読む深掘り用）")
    p.add_argument("--shards", type=int, default=1)
    p.add_argument("--shard", type=int, default=0)
    p.add_argument("--workers", type=int, default=6, help="1 host 内で同時に読む記事数")
    p.add_argument("--flush-every", type=int, default=1, help="何 host ごとに BQ へ流すか")
    # シャード数を変えて流し直すことがあるので、その run で既に投稿を採れた host は飛ばす。
    # 再開可能にしておかないと、割り当てが変わるたびに同じ媒体を読み直して相手にも迷惑をかける。
    p.add_argument("--skip-done-hosts", action="store_true",
                   help="この run_id で既に投稿を採れている host を対象から外す")
    # sitemap を持たない host（実測で未クロール host の 38%）を CDX で救う。既定で有効。
    p.add_argument("--no-cdx-fallback", action="store_true",
                   help="sitemap が無い host を CDX から読むフォールバックを止める")
    p.add_argument("--cdx-crawl", default=CDX_CRAWL, help="フォールバックに使う Common Crawl の版")
    p.add_argument("--cdx-cache-dir", default=CDX_CACHE_DIR)
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

    # 順番が効く。媒体ネットワーク（号外NET 等）はタイトルが «【市区町村】…店名…料理» の形で
    # 揃っていて地点あり率 100%、CC 由来の host は玉石混交（実測 candy-afternoon.com は 2.3%）。
    # 濃い方を先に処理しないと、6 時間の枠を薄い host で使い切って本命に届かない。
    hosts: list[str] = []
    if args.network_index_urls:
        hosts = network_hosts([u.strip() for u in args.network_index_urls.split(",") if u.strip()])
    hosts += [h.strip() for h in args.extra_hosts.split(",") if h.strip()]
    if args.hosts_from_run_ids:
        hosts += _read_hosts(pipeline, [x.strip() for x in args.hosts_from_run_ids.split(",") if x.strip()],
                             args.min_posts, args.max_hosts)
    hosts = list(dict.fromkeys(hosts))
    if args.skip_done_hosts:
        done = {r["host"] for r in pipeline.execute(
            f"SELECT DISTINCT discovery_query host FROM `{pipeline.table(TABLE_POST_RAW)}` "
            "WHERE run_id = @rid AND discovery_query IS NOT NULL",
            [bigquery.ScalarQueryParameter("rid", "STRING", run_id)])}
        before = len(hosts)
        hosts = [h for h in hosts if h not in done]
        LOGGER.info("処理済み host %d 件を除外（%d → %d）", len(done), before, len(hosts))
    mine = [h for i, h in enumerate(hosts) if i % max(args.shards, 1) == args.shard]
    LOGGER.info("host %d 件中このシャードは %d 件", len(hosts), len(mine))

    with pipeline.step(run_id, "4_12_crawl_gourmet_media", parameters={
        "hosts": len(mine), "shards": args.shards, "shard": args.shard,
    }, repo_root=None) as result:
        now = utc_now().astimezone(timezone.utc).isoformat()
        rows: list[dict] = []
        seen: set[str] = set()
        total = with_area = 0
        cdx_crawl = None if args.no_cdx_fallback else args.cdx_crawl
        by_source = {"sitemap": 0, "cdx": 0}          # 投稿数
        hosts_by_source = {"sitemap": 0, "cdx": 0}    # 記事URLを採れた host 数

        def flush() -> None:
            nonlocal rows
            if rows and not args.dry_run:
                pipeline.load_json_rows(TABLE_POST_RAW, rows)
            rows = []

        for n, host in enumerate(mine, 1):
            if not _robots_allows(host):
                LOGGER.info("  %s: robots で全面禁止。飛ばします", host)
                continue
            urls, source = article_urls_with_source(
                host, args.max_urls_per_host, args.skip_urls_per_host, cdx_crawl, args.cdx_cache_dir)
            if not urls:
                LOGGER.info("  %s: sitemap からも CDX からも記事URLを採れませんでした", host)
                continue
            hosts_by_source[source] += 1
            pool = ThreadPoolExecutor(max_workers=max(args.workers, 1))
            got = 0
            for found in pool.map(lambda u: scan_article(u, by_pair, uniq), urls):
                for r in found:
                    if r["post_id"] in seen:
                        continue
                    seen.add(r["post_id"])
                    total += 1
                    got += 1
                    by_source[source] += 1
                    if r["area"]:
                        with_area += 1
                    rows.append({
                        "post_id": r["post_id"], "provider": PROVIDER_INSTAGRAM,
                        "canonical_url": f"https://www.instagram.com/p/{r['post_id']}/",
                        "account_id": r.get("handle"), "discovery_route": "gourmet_media",
                        # 経路を discovery_method に残す。後から «CDX 経路が割に合ったか» を
                        # BigQuery だけで数え直せるようにするため（ログは残らない）。
                        "discovery_method": DISCOVERY_METHOD[source], "discovery_query": r["host"],
                        "discovery_seed_place_id": None,
                        "discovery_area_lat": r["area"][0] if r["area"] else None,
                        "discovery_area_lng": r["area"][1] if r["area"] else None,
                        "discovery_category_id": None, "fetched_at": now, "run_id": run_id,
                        "caption": r["caption"], "author_name": None,
                    })
            pool.shutdown()
            LOGGER.info("  %d/%d %s[%s]: 記事 %d → 投稿 %d（累計 %d / 地点あり %d）",
                        n, len(mine), host, source, len(urls), got, total, with_area)
            if n % args.flush_every == 0:
                flush()
            time.sleep(1)  # 媒体を連続で叩かない
        flush()
        result["row_count"] = total
        result["with_area"] = with_area
        result["posts_by_source"] = by_source
        result["hosts_by_source"] = hosts_by_source
        LOGGER.info("完了: 投稿 %d（地点あり %d）| host %d | sitemap %d host/%d 投稿・"
                    "CDX %d host/%d 投稿", total, with_area, len(mine),
                    hosts_by_source["sitemap"], by_source["sitemap"],
                    hosts_by_source["cdx"], by_source["cdx"])


if __name__ == "__main__":
    main()
