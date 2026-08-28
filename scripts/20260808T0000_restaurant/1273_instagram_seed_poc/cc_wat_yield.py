"""#1273 4.14 の未測定点: WAT（外向きリンク）1 ファイルあたりの Instagram 投稿 URL 収率。

「全 WAT = 15.1TB だから非現実的」としてきたが、**1 ファイルあたり何本取れるか**を
測っていなかった。標本から «50万投稿に必要なファイル数 × 帯域 × 時間» を出す。

WAT には各ページの外向きリンクが JSON で入っている。日本語ページかどうかは
WAT では分からないので、リンク元 URL の TLD (.jp) とパスの日本語気配で近似する。
"""
import gzip
import io
import json
import os
import random
import re
import sys
import time
import urllib.request

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
CRAWL = "CC-MAIN-2026-34"
UA = "nanitabeyo-poc/1.0 (+https://github.com/Ayato-kosaka/nanitabeyo)"
POST = re.compile(r"instagram\.com/(?:p|reel|tv)/([A-Za-z0-9_-]{5,})")
PROF = re.compile(r"instagram\.com/([A-Za-z0-9._]{2,30})/?(?:\"|$|\?)")


def main():
    n_files = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    paths = gzip.decompress(urllib.request.urlopen(
        urllib.request.Request(
            f"https://data.commoncrawl.org/crawl-data/{CRAWL}/wat.paths.gz",
            headers={"User-Agent": UA}), timeout=120).read()).decode().splitlines()
    random.seed(20260828)
    sample = random.sample(paths, n_files)

    stats = []
    for p in sample:
        t0 = time.time()
        url = f"https://data.commoncrawl.org/{p}"
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        # ストリームで読みつつ gzip 展開し、行単位で正規表現を当てる
        pages = 0
        posts, posts_jp = set(), set()
        got_bytes = 0
        with urllib.request.urlopen(req, timeout=600) as r:
            gz = gzip.GzipFile(fileobj=r)
            cur_is_jp = False
            while True:
                try:
                    line = gz.readline()
                except Exception:
                    break
                if not line:
                    break
                got_bytes += len(line)
                if line.startswith(b"WARC-Target-URI:"):
                    pages += 1
                    u = line.decode("utf-8", "replace").split(":", 1)[1].strip()
                    cur_is_jp = (".jp/" in u or u.endswith(".jp")
                                 or ".co.jp" in u or ".ne.jp" in u)
                if b"instagram.com" in line:
                    for m in POST.finditer(line.decode("utf-8", "replace")):
                        posts.add(m.group(1))
                        if cur_is_jp:
                            posts_jp.add(m.group(1))
        dt = time.time() - t0
        st = {"file": p.split("/")[-1], "pages": pages,
              "distinct_posts": len(posts), "distinct_posts_from_jp_domains": len(posts_jp),
              "uncompressed_mb": round(got_bytes / 1e6), "seconds": round(dt)}
        stats.append(st)
        print(json.dumps(st, ensure_ascii=False), flush=True)

    tot_posts = sum(s["distinct_posts"] for s in stats)
    tot_jp = sum(s["distinct_posts_from_jp_domains"] for s in stats)
    summary = {
        "crawl": CRAWL, "files_sampled": len(stats),
        "mean_posts_per_file": round(tot_posts / max(len(stats), 1), 1),
        "mean_jp_posts_per_file": round(tot_jp / max(len(stats), 1), 1),
        "total_wat_files": len(paths),
        "extrapolated_posts_full_crawl": tot_posts * len(paths) // max(len(stats), 1),
        "extrapolated_jp_posts_full_crawl": tot_jp * len(paths) // max(len(stats), 1),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    json.dump({"summary": summary, "files": stats},
              open(f"{OUT}/cc_wat_yield.json", "w"), ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
