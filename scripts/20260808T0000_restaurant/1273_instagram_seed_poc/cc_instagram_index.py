"""#1273 4.14 Common Crawl の URL index に Instagram の URL が何本あるかを数える。

WAT（外向きリンク）の全走査は無料枠では現実的でないため、まず cdx index の
SURT キーが `com,instagram)` で始まるブロックだけを range 取得して数える。
cluster.idx は SURT 昇順なので、対象ブロックだけ引けば全走査は要らない。
"""
import gzip
import io
import json
import re
import sys
import urllib.request

CRAWL = sys.argv[1] if len(sys.argv) > 1 else "CC-MAIN-2026-34"
BASE = f"https://data.commoncrawl.org/cc-index/collections/{CRAWL}/indexes"
UA = "nanitabeyo-poc/1.0 (+https://github.com/Ayato-kosaka/nanitabeyo)"
OUT = "/home/user/nanitabeyo/scripts/20260808T0000_restaurant/1273_instagram_seed_poc/out"


def get(url, rng=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    if rng:
        req.add_header("Range", f"bytes={rng[0]}-{rng[1]}")
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def main():
    idx = get(f"{BASE}/cluster.idx").decode("utf-8", "replace")
    rows = [ln.split("\t") for ln in idx.splitlines() if ln]
    blocks = [r for r in rows if r[0].startswith("com,instagram)")]
    print(f"crawl={CRAWL} cluster_rows={len(rows)} instagram_blocks={len(blocks)}", flush=True)
    posts, profiles, total = set(), set(), 0
    for i, r in enumerate(blocks):
        cdx_file, off, ln = r[1], int(r[2]), int(r[3])
        raw = get(f"{BASE}/{cdx_file}", (off, off + ln - 1))
        text = gzip.GzipFile(fileobj=io.BytesIO(raw)).read().decode("utf-8", "replace")
        for line in text.splitlines():
            if not line.startswith("com,instagram)"):
                continue
            total += 1
            path = line.split(" ", 1)[0].split(")", 1)[1].split("?")[0]
            if re.match(r"^/(p|reel|tv)/[^/]+", path):
                posts.add(path)
            elif re.match(r"^/[a-zA-Z0-9._]+/?$", path):
                profiles.add(path)
        if i % 5 == 0:
            print(f"  block {i+1}/{len(blocks)} total={total}", flush=True)
    result = {
        "crawl": CRAWL,
        "instagram_cdx_records": total,
        "distinct_post_paths": len(posts),
        "distinct_profile_paths": len(profiles),
    }
    print(json.dumps(result, indent=2))
    with open(f"{OUT}/cc_instagram_index.json", "w") as f:
        json.dump(result, f, indent=2)


if __name__ == "__main__":
    main()
