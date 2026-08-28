"""#1273 4.11 の本命: 店名＋住所から Instagram アカウントを検索で見つけられるか。

**正解が分かっている標本で測る。** FSQ OS Places は 57,897 店について `instagram` 列を
持っているので、その店名・住所だけを検索に投げ、返ってきたプロフィール URL が
**FSQ の持っている正解ハンドルと一致するか**を数えれば、目視ラベル無しで
recall と precision の両方が出る。

これが効くなら、open data に Instagram を持たない残り 110 万店にも同じ検索を掛けられる。
"""
import csv
import json
import os
import random
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
PROFILE_RE = re.compile(r"instagram\.com/([A-Za-z0-9._]{1,30})/?(?:$|\?)")
POST_RE = re.compile(r"instagram\.com/(?:p|reel|tv)/([A-Za-z0-9_-]+)")
# プロフィールでない instagram.com 配下のパス
NOT_PROFILE = {"p", "reel", "reels", "tv", "explore", "accounts", "stories", "directory", "about", "developer"}


def search(key, q):
    body = json.dumps({"q": q, "gl": "jp", "hl": "ja"}).encode()
    req = urllib.request.Request("https://google.serper.dev/search", data=body,
                                 headers={"X-API-KEY": key, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def handles_from(d):
    """検索結果から Instagram のプロフィールハンドルを順位順に取り出す。"""
    out = []
    for x in d.get("organic", []):
        link = x.get("link", "") or ""
        m = PROFILE_RE.search(link)
        if m and m.group(1).lower() not in NOT_PROFILE:
            out.append(m.group(1).lower())
            continue
        # 投稿 URL のときは title の「<アカウント> on Instagram」から拾う
        if POST_RE.search(link):
            t = x.get("title") or ""
            a = re.match(r"^([A-Za-z0-9._]{2,30})\s+on Instagram", t)
            if a:
                out.append(a.group(1).lower())
    return out


def main():
    key = os.environ["SERPER_API_KEY"]
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 100
    template = sys.argv[2] if len(sys.argv) > 2 else "{name} {locality} instagram"

    rows = []
    with open(os.path.join(OUT, "fsq_jp_dining_instagram.csv"), newline="") as f:
        for r in csv.DictReader(f):
            h = (r["instagram_handle"] or "").strip().lower().lstrip("@")
            if re.fullmatch(r"[a-z0-9._]{1,30}", h) and (r["name"] or "").strip():
                rows.append(r | {"instagram_handle": h})
    random.seed(20260828)
    sample = random.sample(rows, n)

    res, credits = [], 0
    for i, r in enumerate(sample):
        q = template.format(name=r["name"], locality=r["locality"] or "",
                            region=r["region"] or "", address=r["address"] or "")
        try:
            d = search(key, q)
            credits += 1
        except Exception as e:
            res.append({"name": r["name"], "error": str(e)[:100]}); continue
        got = handles_from(d)
        truth = r["instagram_handle"]
        res.append({
            "name": r["name"], "locality": r["locality"], "query": q,
            "truth": truth, "found": got[:5],
            "hit_top1": bool(got) and got[0] == truth,
            "hit_any": truth in got,
            "any_profile": bool(got),
        })
        time.sleep(0.15)
        if (i + 1) % 20 == 0:
            h1 = sum(1 for x in res if x.get("hit_top1"))
            ha = sum(1 for x in res if x.get("hit_any"))
            print(f"  {i+1}/{n} top1={h1} any={ha} credits={credits}", flush=True)

    ok = [x for x in res if "truth" in x]
    summary = {
        "template": template, "n": len(ok), "credits_used": credits,
        "any_profile_returned": sum(1 for x in ok if x["any_profile"]),
        "hit_top1": sum(1 for x in ok if x["hit_top1"]),
        "hit_any": sum(1 for x in ok if x["hit_any"]),
        "recall_top1_pct": round(100 * sum(1 for x in ok if x["hit_top1"]) / max(len(ok), 1), 2),
        "recall_any_pct": round(100 * sum(1 for x in ok if x["hit_any"]) / max(len(ok), 1), 2),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    tag = re.sub(r"\W+", "_", template)[:40]
    json.dump({"summary": summary, "rows": res},
              open(f"{OUT}/serper_account_discovery_{tag}.json", "w"), ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
