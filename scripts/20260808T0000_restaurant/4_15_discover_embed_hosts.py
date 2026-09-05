#!/usr/bin/env python3
"""#1273 4_12 の «井戸» を探す係。Instagram を埋め込んでいる日本のページの host を列挙する。

## なぜ 4_9 と別に要るか
4_9（CC WAT → 投稿）は «resolve に渡せる投稿» を採る係で、**キャプションが取れない投稿を捨てる**。
host を探す目的では、これは捨てすぎである。媒体かどうかは «その host のページに埋め込みが有るか»
で決まるのであって、たまたま CC が拾った 1 ページの anchor text が空だったかどうかではない。
ここは同じ WAT を **host 単位**で数え直す（1 ページでも埋め込みがあれば host を記録する）。

## 3 つのモード（すべて 4_12 の入力を作るためのもの。4_12 本体は触らない）
- `wat`    : CC の WAT を舐めて «埋め込みを持つ host» を CSV に出す。日本語・飲食の根拠も一緒に数える
- `expand` : 見つけた host を登録可能ドメインでまとめ、**CDX index からそのドメインの全サブドメイン**を引く。
             号外NET（goguynet.jp）・まいぷれ（mypl.net）のような «市区町村ごとにサブドメインを持つ»
             ネットワークは、1 本見つかると数十〜数百 host に化ける。実測で最も費用対効果が高い経路
- `verify` : host を標本抽出し、sitemap → 記事を実際に読んで «本当に埋め込みを持つか» を測る。
             判定は 4_12 が使う `sns_html.captions_from_html` をそのまま呼ぶ（写経しない）

## 4_12 への渡し方
出力 CSV から `--mode export` で host をカンマ区切りにして、そのまま
`4_12_crawl_gourmet_media.py --extra-hosts <...>` に渡す。BigQuery は読むだけ
（既に 4_12 でクロール済みの host を除くためだけに使う）。

## 使い方
  python3 4_15_discover_embed_hosts.py --mode wat --crawl CC-MAIN-2026-34 \
      --file-from 16000 --shards 6 --shard 0 --max-files 500 --out hosts_wat.csv
  python3 4_15_discover_embed_hosts.py --mode expand --hosts-file hosts_wat.csv --out hosts_expanded.csv
  python3 4_15_discover_embed_hosts.py --mode verify --hosts-file hosts_expanded.csv --sample 20
  python3 4_15_discover_embed_hosts.py --mode export --hosts-file hosts_expanded.csv --exclude-crawled
"""
from __future__ import annotations

import argparse
import collections
import csv
import gzip
import json
import logging
import os
import random
import re
import sys
import tempfile
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import cc_cdx
from sns_html import RE_KANA, captions_from_html

LOGGER = logging.getLogger(__name__)
CC_BASE = "https://data.commoncrawl.org/"
UA = {"User-Agent": "nanitabeyo-research/1.0 (+dish_media seed; github.com/Ayato-kosaka/nanitabeyo)"}

RE_IG_POST = re.compile(r"instagram\.com/(?:[A-Za-z0-9._]{2,30}/)?(?:p|reel|tv)/([A-Za-z0-9_-]{5,20})")
# «そのページが飲食の話か» の目安。4_12 は BigQuery 側の同種の正規表現で host を選ぶが、
# あちらは «投稿キャプション» を見るのに対し、ここは «ページのタイトル/説明/URL» を見る。
# 見ている対象が違うので同じ物を共有しない（共有すると片方の都合で語を足したときに他方が壊れる）。
RE_FOOD = re.compile(
    r"ランチ|グルメ|美味し|おいし|うまい|旨い|居酒屋|ラーメン|らーめん|カフェ|喫茶|焼肉|寿司|鮨|そば|蕎麦|うどん|"
    r"定食|食堂|カレー|スイーツ|ケーキ|天ぷら|餃子|焼鳥|焼き鳥|海鮮|ステーキ|パスタ|ピザ|酒場|バル|ビストロ|"
    r"テイクアウト|メニュー|営業時間|食べ歩き|飲食|料理|レストラン|パン屋|ベーカリー|丼|食事|開店|新規オープン|新店")
# ホスト名だけで飲食/地域メディアと分かるもの（タイトルが英語のページしか CC に無い host の救済）
RE_FOOD_HOST = re.compile(r"gourmet|gurume|gurutto|tabe|meshi|gohan|ramen|sushi|cafe|lunch|foodie|"
                          r"guruguru|oishi|umai|machi|town|navi|journal|local|now|times|press|magazine")
# 埋め込みを持つが «媒体» ではないプラットフォーム。ここを 4_12 に渡すと sitemap が巨大なだけで
# 店が増えない（自分のサイトではなく他人の投稿の集積所）。
PLATFORM_HOSTS = re.compile(
    r"(^|\.)(instagram\.com|facebook\.com|twitter\.com|x\.com|t\.co|youtube\.com|pinterest\.[a-z.]+|"
    r"tiktok\.com|linktr\.ee|lit\.link|note\.com|ameblo\.jp|hatena\.ne\.jp|b\.hatena\.ne\.jp|"
    r"togetter\.com|matome\.naver\.jp|goo\.ne\.jp|rakuten\.co\.jp|amazon\.co\.jp|"
    r"tabelog\.com|retty\.me|gnavi\.co\.jp|hotpepper\.jp|jalan\.net|tripadvisor\.[a-z.]+|"
    r"shopify\.com|theshop\.jp|base\.shop|stores\.jp|wixsite\.com|jimdofree\.com|"
    r"prtimes\.jp|value-press\.com|atpress\.ne\.jp)$")
# ブログ/レンタルサーバのドメイン。サブドメインが «別人のサイト» なので、ネットワークとして
# 展開すると数万件の無関係サイトが混ざる（blog.jp だけで 66 件が既に混ざっていた）。
# 個々のサブドメインが CC で埋め込みを持って見つかるぶんには構わないが、ここから «兄弟» は辿らない。
RE_HOSTING_DOMAIN = re.compile(
    r"^(blog\.jp|livedoor\.blog|hateblo\.jp|hatenablog\.(com|jp)|hatenadiary\.(com|jp)|exblog\.jp|"
    r"cocolog-nifty\.com|dreamlog\.jp|blogspot\.com|wordpress\.com|xsrv\.jp|sakura\.ne\.jp|main\.jp|"
    r"moo\.jp|stars\.ne\.jp|shop-pro\.jp|peraichi\.com|jp\.net|web\.fc2\.com|wixsite\.com|"
    r"jimdofree\.com|tsuku2\.jp|s8d\.jp|pleasure\.jp|petfoods\.shop|"
    r"[a-z-]+\.(lg|ed|ac|go)\.jp|(hokkaido|aomori|iwate|miyagi|akita|yamagata|fukushima|ibaraki|"
    r"tochigi|gunma|saitama|chiba|tokyo|kanagawa|niigata|toyama|ishikawa|fukui|yamanashi|nagano|"
    r"gifu|shizuoka|aichi|mie|shiga|kyoto|osaka|hyogo|nara|wakayama|tottori|shimane|okayama|"
    r"hiroshima|yamaguchi|tokushima|kagawa|ehime|kochi|fukuoka|saga|nagasaki|kumamoto|oita|"
    r"miyazaki|kagoshima|okinawa)\.jp)$")
# .jp の «実質 TLD»。登録可能ドメインを取るために畳む（co.jp / lg.jp などを 1 段と数えないため）
JP_SLD = {"co", "ne", "or", "ac", "ad", "ed", "go", "gr", "lg", "geo"}


def registrable_domain(host: str) -> str:
    """host → 登録可能ドメイン。`a.b.goguynet.jp` → `goguynet.jp`、`x.pref.aomori.lg.jp` → `aomori.lg.jp`。"""
    parts = host.lower().strip(".").split(".")
    if len(parts) <= 2:
        return ".".join(parts)
    if parts[-1] == "jp" and parts[-2] in JP_SLD:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def host_of(uri: str) -> str:
    try:
        h = uri.split("/")[2].lower()
    except Exception:  # noqa: BLE001 - 壊れた URI は捨てる
        return ""
    if h.startswith("www."):
        h = h[4:]
    return h.split(":")[0]


# --------------------------------------------------------------------------------------
# mode: wat — CC の WAT を host 単位で数える
# --------------------------------------------------------------------------------------
def scan_wat_file(path: str, hosts: dict) -> tuple[int, int]:
    """WAT 1 本を舐めて hosts[host] に «埋め込みページ数・投稿数・日本語/飲食の根拠» を足す。"""
    dest = os.path.join(tempfile.gettempdir(), "wat_" + path.split("/")[-1])
    try:
        # WAT は 150MB 前後ある。curl で落とす（cc_cdx.download と同じ理由・同じ実装）。
        if not cc_cdx.download(CC_BASE + path, dest):
            LOGGER.warning("  DL 失敗: %s", path)
            return 0, 0
        pages = 0
        with gzip.open(dest, "rb") as gz:
            for raw in gz:
                # instagram の投稿URLを含む行だけ JSON にする（全件パースすると 10 倍遅い）
                if not raw.startswith(b'{"Container"') or b"instagram.com/" not in raw:
                    continue
                if b"/p/" not in raw and b"/reel/" not in raw and b"/tv/" not in raw:
                    continue
                try:
                    rec = json.loads(raw)
                except Exception:  # noqa: BLE001 - 壊れた JSON は捨てる
                    continue
                env = rec.get("Envelope") or {}
                uri = (env.get("WARC-Header-Metadata") or {}).get("WARC-Target-URI") or ""
                hm = (((env.get("Payload-Metadata") or {}).get("HTTP-Response-Metadata") or {})
                      .get("HTML-Metadata") or {})
                codes: set[str] = set()
                anchor_kana = anchor_food = 0
                for ln in hm.get("Links") or []:
                    u = ln.get("url") or ""
                    if "instagram.com" not in u:
                        continue
                    m = RE_IG_POST.search(u)
                    if not m:
                        continue
                    codes.add(m.group(1))
                    text = ln.get("text") or ""
                    anchor_kana += bool(RE_KANA.search(text))
                    anchor_food += bool(RE_FOOD.search(text))
                if not codes:
                    continue
                host = host_of(uri)
                if not host or PLATFORM_HOSTS.search(host):
                    continue
                head = hm.get("Head") or {}
                title = head.get("Title") or ""
                desc = ""
                for m in head.get("Metas") or []:
                    nm = (m.get("name") or m.get("property") or "").lower()
                    if nm in ("description", "og:description") and not desc:
                        desc = m.get("content") or ""
                d = hosts.setdefault(host, {"pages": 0, "posts": 0, "food": 0, "kana": 0, "title": ""})
                d["pages"] += 1
                d["posts"] += len(codes)
                d["food"] += bool(RE_FOOD.search(f"{title} {desc} {uri}") or anchor_food)
                d["kana"] += bool(RE_KANA.search(title + desc) or anchor_kana)
                if not d["title"] and title:
                    d["title"] = title[:120]
                pages += 1
        return pages, os.path.getsize(dest)
    finally:
        if os.path.exists(dest):
            os.remove(dest)


def run_wat(args: argparse.Namespace) -> None:
    with urllib.request.urlopen(urllib.request.Request(
            f"{CC_BASE}crawl-data/{args.crawl}/wat.paths.gz", headers=UA), timeout=180) as r:
        paths = [p for p in gzip.decompress(r.read()).decode().split("\n") if p.strip()]
    # 既に舐めた範囲を飛ばすための slice。4_9 は paths[0:16000] を舐めた実績がある。
    window = paths[args.file_from:args.file_to] if args.file_to else paths[args.file_from:]
    mine = [p for i, p in enumerate(window) if i % max(args.shards, 1) == args.shard][:args.max_files]
    LOGGER.info("crawl %s: 全 %d 本 / 窓 %d 本 / このシャード %d 本", args.crawl, len(paths), len(window), len(mine))

    hosts: dict[str, dict] = {}
    mb = 0.0
    t0 = time.time()
    for n, path in enumerate(mine, 1):
        _, nbytes = scan_wat_file(path, hosts)
        mb += nbytes / 1048576
        if n % 10 == 0 or n == len(mine):
            LOGGER.info("  %d/%d 本 | host %d（日本語×飲食 %d）| %.0fMB | %.0f 分",
                        n, len(mine), len(hosts), sum(1 for d in hosts.values() if d["food"] and d["kana"]),
                        mb, (time.time() - t0) / 60)
            write_hosts(args.out, hosts)
    write_hosts(args.out, hosts)


# --------------------------------------------------------------------------------------
# mode: expand — CDX index から «同じドメインの全サブドメイン» を引く
# --------------------------------------------------------------------------------------
def hosts_under_domain(domain: str, rows: list[list[str]], keys: list[str], crawl: str,
                       max_blocks: int = 60) -> dict[str, int]:
    """CDX は SURT 昇順なので、あるドメインの行は連続している。そのブロックだけ range 取得する。

    `domain` にカンマを含む文字列（例 `com,gurutto-`）を渡すと SURT の前方一致になる。
    号外NET のような «サブドメイン網» だけでなく、ぐるっと系（gurutto-aizu.com /
    gurutto-koriyama.com / gurutto-fukushima.com …）のような **ドメインを分けた網**も、
    SURT が同じ前置で並ぶので 1 回のブロック読みで全部列挙できる。

    CDX へのアクセスそのものは `cc_cdx` が持つ（4_12 と同じ手順を 2 か所に書かない）。
    """
    pfx = cc_cdx.surt_prefix(domain)
    # 前置指定のときはそのまま。ドメイン指定のときは «そのドメイン本体（`)`）とその
    # サブドメイン（`,`）» だけに絞る（`goguynet2.jp` のような別ドメインを巻き込まない）。
    line_prefixes = (pfx,) if "," in domain else (pfx + ",", pfx + ")")
    out: dict[str, int] = {}
    for line in cc_cdx.iter_cdx_lines(pfx, rows, keys, crawl, max_blocks, line_prefixes):
        host = ".".join(reversed(line.split(" ", 1)[0].split(")")[0].split(",")))
        out[host] = out.get(host, 0) + 1
    return out


def run_expand(args: argparse.Namespace) -> None:
    hosts = read_hosts(args.hosts_file)
    by_dom: dict[str, list[str]] = collections.defaultdict(list)
    for h in hosts:
        by_dom[registrable_domain(h)].append(h)
    # ネットワークの目印は «同じドメインに複数のサブドメインが居る» こと。
    # 号外NET・まいぷれはこれで見つかる。1 サブドメインだけのドメインは展開しても増えない。
    # SURT の前置（`com,gurutto-`）はカンマを含むので、区切りは `;`。カンマで切ると
    # `com` と `gurutto-` に割れて «.com 全部» を展開しにいく（実際にやらかした）。
    forced = {d.strip() for d in args.surt_prefixes.split(";") if d.strip()}
    forced |= {d.strip() for d in args.force_domains.split(",") if d.strip() and "." in d}
    doms = {d for d, hs in by_dom.items()
            if len(hs) >= args.min_siblings and "." in d and not RE_HOSTING_DOMAIN.match(d)} | forced
    LOGGER.info("展開対象ドメイン %d 件（host %d 件から）", len(doms), len(hosts))
    rows = cc_cdx.load_cluster_idx(args.crawl, args.cache_dir)
    keys = [r[0] for r in rows]
    out: dict[str, dict] = {h: dict(d, source="input") for h, d in hosts.items()}
    for n, dom in enumerate(sorted(doms), 1):
        found = hosts_under_domain(dom, rows, keys, args.crawl)
        new = 0
        # CC に URL を多く持つ順に採る。網でないドメインを誤って展開したとき、
        # 数千件の無関係 host を 4_12 へ流し込まないための歯止め。
        for h, urls in sorted(found.items(), key=lambda x: -x[1])[:args.max_per_domain]:
            h = h[4:] if h.startswith("www.") else h
            if PLATFORM_HOSTS.search(h) or h in out or urls < args.min_urls:
                continue
            out[h] = {"pages": 0, "posts": 0, "food": 0, "kana": 0,
                      "title": f"(cdx sibling of {dom}; urls={urls})", "source": "cdx_sibling"}
            new += 1
        LOGGER.info("  %d/%d %s: CDX host %d → 新規 %d（累計 %d）", n, len(doms), dom, len(found), new, len(out))
        write_hosts(args.out, out)
    write_hosts(args.out, out)


# --------------------------------------------------------------------------------------
# mode: verify — 本当に埋め込みを持つのかを実際に読んで測る
# --------------------------------------------------------------------------------------
def _crawler():
    """4_12 の sitemap 走査・robots 判定をそのまま借りる（同じ判定を 2 か所に書かない）。"""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import importlib
    return importlib.import_module("4_12_crawl_gourmet_media")


def verify_host(host: str, articles: int, depth_probe: int = 3000) -> dict:
    """sitemap の本数（＝井戸の深さ）と、実際に埋め込みを持つ記事の割合を測る。

    深さを測るのが要点。«埋め込みあり» でも記事が 10 本しか無い host は 4_12 に渡しても
    投稿が数件しか増えない。sitemap の走査は本数に関係なく同じリクエスト数で済む。
    """
    c = _crawler()
    row = {"host": host, "robots": True, "articles_in_sitemap": 0, "fetched": 0,
           "articles_with_embed": 0, "posts": 0, "jp": False, "food": False, "sample": ""}
    if not c._robots_allows(host):
        row["robots"] = False
        return row
    urls = c.article_urls(host, max(depth_probe, articles))
    row["articles_in_sitemap"] = len(urls)
    for u in urls[:articles]:
        raw = c._get(u)
        if raw is None:
            continue
        row["fetched"] += 1
        caps = captions_from_html(raw)
        text = c.page_text(raw)
        if RE_KANA.search(text):
            row["jp"] = True
        if RE_FOOD.search(text):
            row["food"] = True
        if caps:
            row["articles_with_embed"] += 1
            row["posts"] += len(caps)
            if not row["sample"]:
                row["sample"] = u
        time.sleep(0.5)  # 相手を連射しない
    return row


def run_verify(args: argparse.Namespace) -> None:
    hosts = read_hosts(args.hosts_file)
    names = list(hosts)
    if args.only_food:
        names = [h for h in names if hosts[h]["food"] or RE_FOOD_HOST.search(h)]
    random.seed(args.seed)
    random.shuffle(names)
    names = names[:args.sample]
    LOGGER.info("標本 %d host を実際に読みます", len(names))
    rows = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for row in pool.map(lambda h: verify_host(h, args.articles, args.depth_probe), names):
            rows.append(row)
            LOGGER.info("  %s: sitemap %d / 読めた %d / 埋め込み記事 %d / 投稿 %d / jp=%s food=%s",
                        row["host"], row["articles_in_sitemap"], row["fetched"],
                        row["articles_with_embed"], row["posts"], row["jp"], row["food"])
    ok = [r for r in rows if r["articles_with_embed"] > 0]
    jpfood = [r for r in ok if r["jp"] and r["food"]]
    LOGGER.info("結果: %d host 中 埋め込みあり %d（%.0f%%）/ うち日本語かつ飲食 %d（%.0f%%）",
                len(rows), len(ok), 100 * len(ok) / max(len(rows), 1),
                len(jpfood), 100 * len(jpfood) / max(len(rows), 1))
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, indent=1)


# --------------------------------------------------------------------------------------
# mode: export — 4_12 に渡す host 一覧を作る
# --------------------------------------------------------------------------------------
def crawled_hosts() -> set[str]:
    """既に 4_12 が読んだ host（BigQuery は読むだけ）。"""
    from pipeline_common import BigQueryPipeline
    from common_sns import TABLE_POST_RAW
    p = BigQueryPipeline()
    sql = (f"SELECT DISTINCT discovery_query host FROM `{p.table(TABLE_POST_RAW)}` "
           "WHERE discovery_route = 'gourmet_media' AND discovery_query IS NOT NULL")
    return {r["host"] for r in p.execute(sql)}


def run_export(args: argparse.Namespace) -> None:
    hosts = read_hosts(args.hosts_file)
    known = crawled_hosts() if args.exclude_crawled else set()
    picked = []
    for h, d in hosts.items():
        if h in known or PLATFORM_HOSTS.search(h):
            continue
        # 飲食の根拠: CC のページに飲食語があったか、host 名そのものが媒体名になっているか。
        # 日本語の根拠: かなを含むページがあったか、.jp か。
        food = d["food"] >= args.min_food or bool(RE_FOOD_HOST.search(h)) or d.get("source") == "cdx_sibling"
        jp = d["kana"] > 0 or h.endswith(".jp") or d.get("source") == "cdx_sibling"
        if food and jp:
            picked.append((h, d))
    picked.sort(key=lambda x: (-x[1]["food"], -x[1]["posts"], x[0]))
    picked = picked[:args.limit]
    LOGGER.info("host %d 件 → 4_12 に渡す %d 件（クロール済み %d 件を除外）", len(hosts), len(picked), len(known))
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write("\n".join(h for h, _ in picked))
    for i in range(0, len(picked), args.chunk):
        print(",".join(h for h, _ in picked[i:i + args.chunk]))


# --------------------------------------------------------------------------------------
def write_hosts(path: str, hosts: dict) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["host", "pages", "posts", "food", "kana", "source", "title"])
        for h, d in sorted(hosts.items(), key=lambda x: (-x[1]["food"], -x[1]["posts"], x[0])):
            w.writerow([h, d["pages"], d["posts"], d["food"], d["kana"], d.get("source", "wat"), d["title"]])
    os.replace(tmp, path)


def read_hosts(path: str) -> dict[str, dict]:
    out: dict[str, dict] = {}
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out[r["host"]] = {"pages": int(r["pages"]), "posts": int(r["posts"]), "food": int(r["food"]),
                              "kana": int(r["kana"]), "source": r.get("source", "wat"),
                              "title": r.get("title", "")}
    return out


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Instagram を埋め込んでいる日本のページの host を列挙する（4_12 の入力）")
    p.add_argument("--mode", required=True, choices=("wat", "expand", "verify", "export"))
    p.add_argument("--crawl", default="CC-MAIN-2026-34")
    p.add_argument("--out", default="hosts.csv")
    p.add_argument("--hosts-file", default="hosts.csv")
    p.add_argument("--cache-dir", default=os.path.join(tempfile.gettempdir(), "cc_index"))
    # wat
    p.add_argument("--file-from", type=int, default=0, help="wat.paths の何本目から見るか（既走査分を飛ばす）")
    p.add_argument("--file-to", type=int, default=0)
    p.add_argument("--shards", type=int, default=1)
    p.add_argument("--shard", type=int, default=0)
    p.add_argument("--max-files", type=int, default=200)
    # expand
    p.add_argument("--min-siblings", type=int, default=2, help="ネットワークとみなす同一ドメインの host 数")
    p.add_argument("--min-urls", type=int, default=2, help="CDX でこの本数未満しか無い host は捨てる")
    p.add_argument("--force-domains", default="", help="兄弟が 1 件でも展開するドメイン（カンマ区切り）")
    p.add_argument("--surt-prefixes", default="",
                   help="SURT 前方一致で展開する（`;` 区切り。例 `com,gurutto-;jp,gogai`）。"
                        "ドメインを分けた媒体網（ぐるっと系）を丸ごと採るためのもの")
    p.add_argument("--max-per-domain", type=int, default=400, help="1 ドメインから採る host の上限")
    # verify
    p.add_argument("--sample", type=int, default=20)
    p.add_argument("--articles", type=int, default=8, help="1 host あたり実際に読む記事数")
    p.add_argument("--depth-probe", type=int, default=3000, help="sitemap から数える記事本数の上限（井戸の深さ）")
    p.add_argument("--workers", type=int, default=6)
    p.add_argument("--seed", type=int, default=1273)
    p.add_argument("--only-food", action="store_true")
    # export
    p.add_argument("--exclude-crawled", action="store_true", help="4_12 が既に読んだ host を除く（BQ 読み取り）")
    p.add_argument("--min-food", type=int, default=1)
    p.add_argument("--limit", type=int, default=100000)
    p.add_argument("--chunk", type=int, default=200, help="--extra-hosts へ貼れるように何件ずつ出すか")
    return p.parse_args()


def main() -> None:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"),
                        format="%(asctime)s %(levelname)s %(message)s")
    args = parse_args()
    {"wat": run_wat, "expand": run_expand, "verify": run_verify, "export": run_export}[args.mode](args)


if __name__ == "__main__":
    main()
