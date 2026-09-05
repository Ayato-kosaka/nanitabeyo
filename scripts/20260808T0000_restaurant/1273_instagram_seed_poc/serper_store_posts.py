"""#1273 4.11 の本丸: «その店について誰かが投稿しているか» を店名で直接引く。

Route A（店 → その店の公式アカウント → 投稿）は、店が Instagram をやっていないと成立しない。
しかし `site:instagram.com/p "<店名>" <市区町村>` は **誰の投稿でもよい**ので、
店が Instagram をやっていなくても当たりうる。母集団 1,177,934 店に対する
«投稿が 1 本でも見つかる店の割合» が、条件 (b) を満たせるかどうかを決める。

判定は自動でやる。タイトル（＝キャプション）に **店名が現れるか**を見る。
キャプションに店名が入っていれば、あとの店舗一致（オーナー指示により後回し）でも使える。
"""
import csv
import json
import os
import random
import re
import sys
import time
import unicodedata
import urllib.request

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
POST = re.compile(r"instagram\.com/(?:p|reel|tv)/([A-Za-z0-9_-]+)")


def norm(s):
    s = unicodedata.normalize("NFKC", s or "").lower()
    return re.sub(r"[\s　・･'\"()（）\-−ー_,.。、／/]+", "", s)


def search(key, q):
    b = json.dumps({"q": q, "gl": "jp", "hl": "ja"}).encode()
    r = urllib.request.Request("https://google.serper.dev/search", data=b,
                               headers={"X-API-KEY": key, "Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(r, timeout=60))


def main():
    key = os.environ["SERPER_API_KEY"]
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 80
    src = sys.argv[2] if len(sys.argv) > 2 else "fsq_jp_no_instagram_sample.csv"

    stores = list(csv.DictReader(open(os.path.join(OUT, src), newline="")))
    random.seed(20260828); random.shuffle(stores)
    stores = stores[:n]

    rows = []
    for i, s in enumerate(stores):
        name = (s.get("name") or "").strip()
        loc = (s.get("locality") or "").strip()
        if not name:
            continue
        q = f'site:instagram.com/p "{name}" {loc}'
        try:
            d = search(key, q)
        except Exception as e:
            rows.append({"name": name, "error": str(e)[:90]}); continue
        posts, named = [], []
        nn = norm(name)
        for x in d.get("organic", []):
            m = POST.search(x.get("link", "") or "")
            if not m:
                continue
            posts.append(m.group(1))
            if nn and len(nn) >= 2 and nn in norm(x.get("title") or ""):
                named.append(m.group(1))
        rows.append({"name": name, "locality": loc, "query": q,
                     "posts": len(posts), "posts_naming_store": len(named),
                     "sample": [x.get("title", "")[:60] for x in d.get("organic", [])[:2]]})
        time.sleep(0.15)
        if (i + 1) % 20 == 0:
            wp = sum(1 for r in rows if r.get("posts"))
            wn = sum(1 for r in rows if r.get("posts_naming_store"))
            print(f"  {i+1}/{n} any_post={wp} named={wn}", flush=True)

    ok = [r for r in rows if "posts" in r]
    summary = {
        "source": src, "n": len(ok),
        "stores_with_any_post": sum(1 for r in ok if r["posts"]),
        "stores_with_post_naming_store": sum(1 for r in ok if r["posts_naming_store"]),
        "pct_any_post": round(100 * sum(1 for r in ok if r["posts"]) / max(len(ok), 1), 2),
        "pct_named": round(100 * sum(1 for r in ok if r["posts_naming_store"]) / max(len(ok), 1), 2),
        "mean_posts_per_store": round(sum(r["posts"] for r in ok) / max(len(ok), 1), 2),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    json.dump({"summary": summary, "rows": rows},
              open(f"{OUT}/serper_store_posts.json", "w"), ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
