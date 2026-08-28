"""#1273 4.14 の打開策その2: 店舗公式サイトの生 HTML を Common Crawl から取り、Instagram を抜く。

4.3（自前クロール）と同じ結果を、**相手サーバに一切アクセスせず・無料で**得られるかを測る。
cluster.idx を二分探索して当該ホストのブロックだけ range 取得し、
そのホストの WARC レコードを range 取得して href を見る。

FSQ が website を持つ日本の飲食店 312,559 店から標本を取る。
"""
import bisect
import gzip
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
CRAWL = os.environ.get("CC_CRAWL", "CC-MAIN-2026-34")
IDX = f"https://data.commoncrawl.org/cc-index/collections/{CRAWL}/indexes"
UA = "nanitabeyo-poc/1.0 (+https://github.com/Ayato-kosaka/nanitabeyo)"
CLUSTER = "/tmp/cluster.idx"
PROFILE_RE = re.compile(rb"instagram\.com/([A-Za-z0-9._]{2,30})")
NOT_PROFILE = {b"p", b"reel", b"reels", b"tv", b"explore", b"accounts", b"stories", b"about", b"developer", b"legal"}


def surt_host(host):
    host = host.lower().removeprefix("www.")
    return ",".join(reversed(host.split("."))) + ")"


def get(url, rng=None, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    if rng:
        req.add_header("Range", f"bytes={rng[0]}-{rng[1]}")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    rows = [l.rstrip("\n").split("\t") for l in open(CLUSTER) if l.strip()]
    keys = [r[0] for r in rows]

    hosts = []
    with open(f"{OUT}/fsq_jp_with_website_sample.csv", newline="") as f:
        import csv
        for r in csv.DictReader(f):
            try:
                h = urllib.parse.urlparse(r["website"]).netloc
            except Exception:
                continue
            if h:
                hosts.append((r["name"], h))
    hosts = hosts[:n]

    found, in_cc, checked = 0, 0, 0
    detail = []
    for name, host in hosts:
        pfx = surt_host(host)
        lo = bisect.bisect_left(keys, pfx)
        lines = []
        for r in rows[max(0, lo - 1):lo + 1]:
            try:
                raw = get(f"{IDX}/{r[1]}", (int(r[2]), int(r[2]) + int(r[3]) - 1))
                text = gzip.GzipFile(fileobj=io.BytesIO(raw)).read().decode("utf-8", "replace")
            except Exception:
                continue
            lines += [l for l in text.splitlines() if l.startswith(pfx)]
        checked += 1
        if not lines:
            detail.append({"name": name, "host": host, "in_cc": False}); continue
        in_cc += 1
        handles = set()
        recs = []
        for l in lines[:8]:
            try:
                recs.append(json.loads(l.split(" ", 2)[2]))
            except Exception:
                pass
        pages = 0
        for rec in [x for x in recs if x.get("status") == "200"][:5]:
            try:
                raw = get(f"https://data.commoncrawl.org/{rec['filename']}",
                          (int(rec["offset"]), int(rec["offset"]) + int(rec["length"]) - 1))
                html = gzip.decompress(raw)
            except Exception:
                continue
            pages += 1
            for m in PROFILE_RE.finditer(html):
                h = m.group(1)
                if h.lower() not in NOT_PROFILE:
                    handles.add(h.decode("ascii", "ignore").lower())
        if handles:
            found += 1
        detail.append({"name": name, "host": host, "in_cc": True, "cdx_lines": len(lines),
                       "pages_fetched": pages, "handles": sorted(handles)[:5]})
        print(f"  {host}: cdx={len(lines)} pages={pages} handles={sorted(handles)[:3]}", flush=True)

    summary = {"crawl": CRAWL, "hosts_checked": checked, "hosts_in_cc": in_cc,
               "hosts_with_instagram": found,
               "in_cc_pct": round(100 * in_cc / max(checked, 1), 1),
               "instagram_pct_of_checked": round(100 * found / max(checked, 1), 1),
               "instagram_pct_of_in_cc": round(100 * found / max(in_cc, 1), 1)}
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    json.dump({"summary": summary, "detail": detail},
              open(f"{OUT}/cc_store_sites.json", "w"), ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
