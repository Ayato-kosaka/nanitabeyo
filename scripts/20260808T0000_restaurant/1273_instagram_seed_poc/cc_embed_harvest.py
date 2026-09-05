"""#1273 4.14 の打開策: Common Crawl から «Instagram 投稿を埋め込んでいる日本語ページ» を採る。

一度目の測定で、Common Crawl に instagram.com 自体は 78 レコード（うち 77 が robots.txt）
しか入っておらず、投稿 URL は 0 本だと分かった。残る経路は仕様書の言うとおり
「他サイトの外向きリンク」だが、WAT の全走査は 1 crawl 15.1TB で現実的でない。

そこで **対象ドメインを絞って cdx index を二分探索し、該当ページの WARC レコードだけを
range 取得する**。cluster.idx は SURT 昇順なので、ドメインごとに数ブロック引けば足りる。
FineWeb-2 のような抽出済みコーパスでは埋め込みの href が落ちる（実測 20,000 文書に 1 本）ので、
**生 HTML でなければならない**。

数えるもの: 1 ページあたりの instagram 投稿 URL 数と、そのページに店名が併記されているか。
"""
import bisect
import gzip
import io
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
CRAWL = os.environ.get("CC_CRAWL", "CC-MAIN-2026-34")
IDX = f"https://data.commoncrawl.org/cc-index/collections/{CRAWL}/indexes"
UA = "nanitabeyo-poc/1.0 (+https://github.com/Ayato-kosaka/nanitabeyo)"
CLUSTER = "/tmp/cluster.idx"

# 日本語の飲食まわりで Instagram を埋め込みがちな媒体。ポータル（食べログ・ぐるなび）は
# #1303 で規約により却下済みなので入れない。
DOMAINS = [
    "prtimes.jp", "macaro-ni.jp", "retrip.jp", "icotto.jp", "favy.jp",
    "tokyo-calendar.jp", "pathee.com", "walkerplus.com", "tabizine.jp",
    "note.com", "ameblo.jp", "hatenablog.com", "mognavi.jp", "dressing-media.jp",
]
POST_RE = re.compile(rb"instagram\.com/(?:p|reel|tv)/([A-Za-z0-9_-]{5,})")
PERMALINK_RE = re.compile(rb'data-instgrm-permalink="[^"]*instagram\.com/(?:p|reel|tv)/([A-Za-z0-9_-]{5,})')


def surt(domain):
    return ",".join(reversed(domain.split("."))) + ")"


def get(url, rng=None, timeout=180):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    if rng:
        req.add_header("Range", f"bytes={rng[0]}-{rng[1]}")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def load_cluster():
    if not os.path.exists(CLUSTER):
        raise SystemExit(f"{CLUSTER} が無い。先に cluster.idx を落とすこと")
    rows = [l.rstrip("\n").split("\t") for l in open(CLUSTER) if l.strip()]
    return rows, [r[0] for r in rows]


def cdx_lines(rows, keys, prefix, max_blocks=2):
    """SURT prefix を含むブロックだけ range 取得して cdx 行を返す。"""
    lo = bisect.bisect_left(keys, prefix)
    out = []
    for r in rows[max(0, lo - 1):lo - 1 + max_blocks]:
        raw = get(f"{IDX}/{r[1]}", (int(r[2]), int(r[2]) + int(r[3]) - 1))
        text = gzip.GzipFile(fileobj=io.BytesIO(raw)).read().decode("utf-8", "replace")
        out += [l for l in text.splitlines() if l.startswith(prefix)]
    return out


def main():
    per_domain = int(sys.argv[1]) if len(sys.argv) > 1 else 25
    rows, keys = load_cluster()
    result = []
    for dom in DOMAINS:
        pfx = surt(dom)
        try:
            lines = cdx_lines(rows, keys, pfx)
        except Exception as e:
            result.append({"domain": dom, "error": str(e)[:120]}); continue
        recs = []
        for l in lines:
            try:
                recs.append(json.loads(l.split(" ", 2)[2]))
            except Exception:
                pass
        recs = [r for r in recs if r.get("status") == "200" and r.get("filename")]
        pages, posts = 0, set()
        for r in recs[:per_domain]:
            off, ln = int(r["offset"]), int(r["length"])
            try:
                raw = get(f"https://data.commoncrawl.org/{r['filename']}", (off, off + ln - 1), timeout=120)
                html = gzip.decompress(raw)
            except Exception:
                continue
            pages += 1
            found = set(POST_RE.findall(html)) | set(PERMALINK_RE.findall(html))
            posts |= found
        result.append({
            "domain": dom, "cdx_lines": len(lines), "records_200": len(recs),
            "pages_fetched": pages, "distinct_post_ids": len(posts),
            "posts_per_page": round(len(posts) / pages, 3) if pages else 0,
        })
        print(f"  {dom}: cdx={len(lines)} fetched={pages} posts={len(posts)}", flush=True)

    tot_pages = sum(r.get("pages_fetched", 0) for r in result)
    tot_posts = sum(r.get("distinct_post_ids", 0) for r in result)
    summary = {"crawl": CRAWL, "domains": len(DOMAINS), "pages_fetched": tot_pages,
               "distinct_post_ids": tot_posts,
               "posts_per_page": round(tot_posts / tot_pages, 3) if tot_pages else 0}
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    json.dump({"summary": summary, "domains": result},
              open(f"{OUT}/cc_embed_harvest.json", "w"), ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
