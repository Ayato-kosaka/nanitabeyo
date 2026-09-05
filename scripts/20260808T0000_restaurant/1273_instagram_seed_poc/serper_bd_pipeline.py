"""#1273 分水嶺の実験: open data に Instagram を持たない店を、検索で見つけて本人確認できるか。

- 母集団: FSQ の日本の飲食（営業中）のうち `instagram` 列が空の店（実測 199,757 店の標本）
- 発見: Serper で「店名 + 市区町村 + instagram」（1 credit / 店）
- 本人確認: 見つけた候補ハンドルを business_discovery に投げ、返る name / biography が
  店名・地名と一致するかを機械的に採点する。**目視ラベルの代わりに API 側の事実で裏を取る**

正解が分かっている標本（serper_account_discovery.py）で recall 79〜84% だったので、
ここで測るのは «そもそも Instagram を持っている店がどれだけあるか» に近い。
"""
import csv
import urllib.parse
import json
import os
import re
import sys
import time
import unicodedata
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
GRAPH = "https://graph.facebook.com/v23.0"
PROFILE_RE = re.compile(r"instagram\.com/([A-Za-z0-9._]{1,30})/?(?:$|\?)")
POST_RE = re.compile(r"instagram\.com/(?:p|reel|tv)/([A-Za-z0-9_-]+)")
NOT_PROFILE = {"p", "reel", "reels", "tv", "explore", "accounts", "stories", "directory", "about", "developer"}


def norm(s):
    s = unicodedata.normalize("NFKC", s or "").lower()
    return re.sub(r"[\s　・･'\"()（）\-−ー_,.。、／/]+", "", s)


def serper(key, q):
    body = json.dumps({"q": q, "gl": "jp", "hl": "ja"}).encode()
    req = urllib.request.Request("https://google.serper.dev/search", data=body,
                                 headers={"X-API-KEY": key, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def candidates(d):
    out = []
    for x in d.get("organic", []):
        link = x.get("link", "") or ""
        m = PROFILE_RE.search(link)
        if m and m.group(1).lower() not in NOT_PROFILE:
            out.append(m.group(1).lower())
        elif POST_RE.search(link):
            a = re.match(r"^([A-Za-z0-9._]{2,30})\s+on Instagram", x.get("title") or "")
            if a:
                out.append(a.group(1).lower())
    seen, uniq = set(), []
    for h in out:
        if h not in seen:
            seen.add(h); uniq.append(h)
    return uniq


def bd(ig_id, token, handle):
    fields = (f"business_discovery.username({handle})"
              "{username,name,biography,website,followers_count,media_count,"
              "media.limit(3){permalink,timestamp}}")
    q = urllib.parse.urlencode({"fields": fields, "access_token": token})
    req = urllib.request.Request(f"{GRAPH}/{ig_id}?{q}", headers={"User-Agent": "nanitabeyo-poc/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return json.load(r).get("business_discovery"), None
    except urllib.error.HTTPError as e:
        try:
            return None, json.loads(e.read().decode())["error"]
        except Exception:
            return None, {"code": -1}


def score(store, locality, acct):
    """店名・地名が、アカウントの name / biography / username / website に現れるかで採点。"""
    sn, ln = norm(store), norm(locality)
    hay = norm((acct.get("name") or "") + (acct.get("biography") or "")
               + (acct.get("username") or "") + (acct.get("website") or ""))
    ev = {}
    ev["name_in_account"] = bool(sn) and len(sn) >= 2 and sn in hay
    core = sn[:4]
    ev["name_prefix_in_account"] = bool(core) and len(core) >= 3 and core in hay
    ev["locality_in_account"] = bool(ln) and len(ln) >= 2 and ln in hay
    ev["website_matches"] = False
    return ev


def main():
    import urllib.parse as _  # noqa
    key = os.environ["SERPER_API_KEY"]
    token = os.environ["IG_TOKEN"]
    ig_id = os.environ["IG_USER_ID"]
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 130

    stores = list(csv.DictReader(open(os.path.join(OUT, "fsq_jp_no_instagram_sample.csv"), newline="")))[:n]
    rows, bd_blocked = [], False
    for i, s in enumerate(stores):
        q = f"{s['name']} {s['locality']} instagram"
        try:
            cands = candidates(serper(key, q))
        except Exception as e:
            rows.append({"name": s["name"], "error": str(e)[:90]}); continue
        rec = {"name": s["name"], "locality": s["locality"], "query": q,
               "candidates": cands[:3], "verified": None, "account": None}
        for h in cands[:2]:
            if bd_blocked:
                break
            acct, err = bd(ig_id, token, h)
            if err and err.get("code") == 4:
                bd_blocked = True
                print(f"BD rate limit at store {i}", flush=True)
                break
            if acct:
                ev = score(s["name"], s["locality"], acct)
                if ev["name_in_account"] or (ev["name_prefix_in_account"] and ev["locality_in_account"]):
                    rec["verified"] = h
                    rec["account"] = {k: acct.get(k) for k in
                                      ("username", "name", "biography", "followers_count", "media_count")}
                    rec["evidence"] = ev
                    break
        rows.append(rec)
        time.sleep(0.15)
        if (i + 1) % 20 == 0:
            v = sum(1 for r in rows if r.get("verified"))
            c = sum(1 for r in rows if r.get("candidates"))
            print(f"  {i+1}/{n} candidate={c} verified={v} bd_blocked={bd_blocked}", flush=True)

    ok = [r for r in rows if "candidates" in r]
    summary = {
        "n": len(ok),
        "with_candidate": sum(1 for r in ok if r["candidates"]),
        "verified": sum(1 for r in ok if r.get("verified")),
        "verified_pct": round(100 * sum(1 for r in ok if r.get("verified")) / max(len(ok), 1), 2),
        "bd_rate_limited": bd_blocked,
        "media_total_of_verified": sum((r["account"] or {}).get("media_count") or 0
                                       for r in ok if r.get("verified")),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    json.dump({"summary": summary, "rows": rows},
              open(f"{OUT}/serper_bd_pipeline.json", "w"), ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
