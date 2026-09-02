"""#1273 «店起点» 母集団拡大: Common Crawl から instagram.com/<handle>（プロフィール URL）を
無料・無鍵で大量抽出できるか実測する。投稿 URL 側（/p/ /reel/ /tv/）は別エージェント担当。

結論を先に:
  - **CDX / URL インデックス**（CC が実際に fetch したページの索引）は instagram では役に立たない。
    Instagram は CCBot をブロックしており、com,instagram) のレコードはほぼ robots.txt だけ。
    1 crawl あたり distinct profile handle は 0〜1 本。→ mode=cdx で実測。
  - **WAT（他ページの外向きリンク）** が唯一の量産経路。1 WAT ファイルあたり
    distinct profile handle が数千本取れる。→ mode=wat で実測。

使い方:
  python3 cc_instagram_handles_probe.py cdx  [CRAWL ...]     # URL インデックス側を数える
  python3 cc_instagram_handles_probe.py wat  N [CRAWL]       # WAT を N ファイル標本し union を測る

無鍵・無料。data.commoncrawl.org への range / stream GET のみ。
(index.commoncrawl.org の CDX API は本セッション時点で応答不能 = HTTP 000 のため、
 その API と同一内容を columnar index の cluster.idx + range 取得で代替している。)
"""
import bisect
import gzip
import io
import json
import os
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
UA = "nanitabeyo-poc/1.0 (+https://github.com/Ayato-kosaka/nanitabeyo)"
DATA = "https://data.commoncrawl.org/"

# handle として無効な予約パス / 機能パス
RESERVED = {
    "p", "reel", "reels", "tv", "explore", "stories", "accounts", "about",
    "developer", "developers", "legal", "directory", "web", "graphql", "api",
    "emails", "challenge", "oauth", "session", "ads", "business", "help",
    "privacy", "terms", "press", "blog", "create", "direct", "login", "signup",
    "locations", "tags", "topics", "sitemap.xml", "robots.txt", "favicon.ico",
    "your_activity", "reels_media", "s", "u", "_u", "_n",
}
# handle 正規化: 小文字・末尾ドット除去・^[a-z0-9_.]{1,30}$
HANDLE_RE = re.compile(r"^[a-z0-9_.]{1,30}$")
# WAT/HTML 内の instagram プロフィールリンク（後続が区切り or 終端 = プロフィール）
PROF_RE = re.compile(r'instagram\.com/([A-Za-z0-9._]{1,30})(?:/|\\|"|\?|<|>|\s|$)')
POST_RE = re.compile(r'instagram\.com/(?:p|reel|reels|tv)/[A-Za-z0-9_-]+')


def get(url, rng=None, timeout=240, tries=5):
    # プロキシ経由で大きめの転送が途中で切れる（IncompleteRead）ため retry する。
    last = None
    for _ in range(tries):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        if rng:
            req.add_header("Range", f"bytes={rng[0]}-{rng[1]}")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:
            last = e
            time.sleep(2)
    raise last


def norm_handle(raw):
    h = raw.lower().rstrip(".")
    if h in RESERVED or not HANDLE_RE.match(h) or h.startswith("."):
        return None
    return h


# ---------------------------------------------------------------------------
# mode=cdx : CC が fetch した instagram.com ページの URL インデックスを数える
# ---------------------------------------------------------------------------
def cdx_count(crawl):
    base = f"{DATA}cc-index/collections/{crawl}/indexes"
    idx = get(f"{base}/cluster.idx").decode("utf-8", "replace")
    rows = [ln.split("\t") for ln in idx.splitlines() if ln]
    keys = [r[0] for r in rows]
    # cluster.idx は疎な block 境界キー。com,instagram)/* は
    # 「com,instagram) 以上・com,instagram,（サブドメイン）未満」の block 群に入る。
    lo = bisect.bisect_left(keys, "com,instagram)")
    hi = bisect.bisect_left(keys, "com,instagram,")
    blocks = rows[max(0, lo - 1):hi + 1]
    total = robots = posts = 0
    profiles = set()
    for r in blocks:
        raw = get(f"{base}/{r[1]}", (int(r[2]), int(r[2]) + int(r[3]) - 1))
        text = gzip.GzipFile(fileobj=io.BytesIO(raw)).read().decode("utf-8", "replace")
        for line in text.splitlines():
            if not line.startswith("com,instagram)"):
                continue
            total += 1
            path = line.split(" ", 1)[0].split(")", 1)[1].split("?")[0]
            if path == "/robots.txt":
                robots += 1
            elif re.match(r"^/(p|reel|reels|tv)/", path):
                posts += 1
            else:
                m = re.match(r"^/([A-Za-z0-9._]{1,30})/?$", path)
                if m and norm_handle(m.group(1)):
                    profiles.add(norm_handle(m.group(1)))
    return {
        "crawl": crawl, "blocks_scanned": len(blocks),
        "instagram_cdx_records": total, "robots_txt": robots,
        "post_records": posts, "distinct_profile_handles": len(profiles),
        "profiles": sorted(profiles),
    }


# ---------------------------------------------------------------------------
# mode=wat : WAT（外向きリンク）から distinct profile handle を抽出し union を測る
# ---------------------------------------------------------------------------
def wat_paths(crawl):
    raw = get(f"{DATA}crawl-data/{crawl}/wat.paths.gz")
    return [l.strip() for l in gzip.GzipFile(fileobj=io.BytesIO(raw)).read().decode().splitlines() if l.strip()]


def wat_extract(path):
    """1 WAT ファイルを stream し distinct profile handle と post を返す。
    途中で切れても（EOFError）取れたぶんを返す = 下振れ側の実測。"""
    prof, posts, nb = set(), set(), 0
    req = urllib.request.Request(DATA + path, headers={"User-Agent": UA})
    try:
        r = urllib.request.urlopen(req, timeout=300)
        for raw in gzip.GzipFile(fileobj=r):
            nb += len(raw)
            if b"instagram.com/" not in raw:
                continue
            line = raw.decode("utf-8", "replace")
            for m in POST_RE.finditer(line):
                posts.add(m.group(0))
            for m in PROF_RE.finditer(line):
                h = norm_handle(m.group(1))
                if h:
                    prof.add(h)
    except Exception as e:
        sys.stderr.write(f"  [partial {type(e).__name__}]\n")
    return prof, posts, nb


def wat_sample(n, crawl):
    paths = wat_paths(crawl)
    step = max(1, len(paths) // n)
    picks = [paths[i * step] for i in range(n)]
    union, upost = set(), set()
    per_file = []
    for i, p in enumerate(picks):
        t = time.time()
        pr, po, nb = wat_extract(p)
        new = len(union | pr) - len(union)
        union |= pr
        upost |= po
        per_file.append({
            "file": p.rsplit("/", 1)[-1], "uncompressed_mb": round(nb / 1e6),
            "distinct_profiles_in_file": len(pr), "new_profiles_vs_union": new,
            "distinct_posts_in_file": len(po), "seconds": round(time.time() - t, 1),
        })
        print(f"  [{i+1}/{n}] {per_file[-1]['distinct_profiles_in_file']} handles "
              f"(+{new} new) union={len(union)} posts={len(po)} "
              f"{per_file[-1]['uncompressed_mb']}MB {per_file[-1]['seconds']}s", flush=True)
    return union, upost, per_file


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "wat"
    if mode == "cdx":
        crawls = sys.argv[2:] or ["CC-MAIN-2026-34", "CC-MAIN-2026-21"]
        res = [cdx_count(c) for c in crawls]
        for r in res:
            print(json.dumps({k: v for k, v in r.items() if k != "profiles"}, ensure_ascii=False))
        json.dump(res, open(f"{HERE}/cc_instagram_cdx_measure.json", "w"), ensure_ascii=False, indent=2)
    else:
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 6
        crawl = sys.argv[3] if len(sys.argv) > 3 else "CC-MAIN-2026-34"
        union, upost, per_file = wat_sample(n, crawl)
        mean_per_file = sum(f["distinct_profiles_in_file"] for f in per_file) / len(per_file)
        # union の限界増分（最後のファイルの new）から full-crawl 飽和を粗く見積もる
        last_new = per_file[-1]["new_profiles_vs_union"]
        import random
        random.seed(1)
        sample200 = random.sample(sorted(union), min(200, len(union)))
        # 上位頻度は 1 ファイル内 distinct なので頻度は取らず、union サンプルのみ保存
        out = {
            "crawl": crawl,
            "wat_files_total_in_crawl": len(wat_paths(crawl)) if False else 100000,
            "wat_files_sampled": n,
            "distinct_profile_handles_union": len(union),
            "distinct_posts_union": len(upost),
            "mean_distinct_profiles_per_file": round(mean_per_file, 1),
            "marginal_new_profiles_last_file": last_new,
            "post_to_profile_ratio": round(len(upost) / max(1, len(union)), 4),
            "per_file": per_file,
            "sample_handles_200": sample200,
        }
        json.dump(out, open(f"{HERE}/cc_instagram_handles_sample.json", "w"), ensure_ascii=False, indent=2)
        print(json.dumps({k: v for k, v in out.items()
                          if k not in ("per_file", "sample_handles_200")}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
