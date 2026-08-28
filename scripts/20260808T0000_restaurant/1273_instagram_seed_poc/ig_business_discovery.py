"""#1273 4.8 補遺: business_discovery が実在の飲食店アカウントで何割通るかを測る。

#1273 / #1284 は「Instagram は App Review 必須で実機ブロック済み」としていたが、
オーナー発行のトークン（scopes: instagram_basic / instagram_manage_insights /
pages_read_engagement / pages_show_list / business_management）で
**第三者アカウントに business_discovery が通った**。したがって測るべきは権限ではなく歩留まりである。

- 通らないアカウントは Business / Creator でない（個人アカウント）か、消えている
- レート制限に当たるまで叩き、実効スループットを記録する

IG_TOKEN と IG_USER_ID を環境変数で渡す。トークンはコミットしない。
"""
import csv
import json
import os
import random
import re
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
GRAPH = "https://graph.facebook.com/v23.0"


def call(ig_id, token, fields):
    q = urllib.parse.urlencode({"fields": fields, "access_token": token})
    req = urllib.request.Request(f"{GRAPH}/{ig_id}?{q}", headers={"User-Agent": "nanitabeyo-poc/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return json.load(r), dict(r.headers)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try:
            return json.loads(body), dict(e.headers)
        except Exception:
            return {"error": {"code": -1, "message": body[:200]}}, dict(e.headers)


def load_handles(n, seed=20260828):
    hs = set()
    with open(os.path.join(OUT, "fsq_jp_dining_instagram.csv"), newline="") as f:
        for row in csv.DictReader(f):
            h = (row["instagram_handle"] or "").strip().lower().lstrip("@")
            if re.fullmatch(r"[a-z0-9._]{1,30}", h):
                hs.add(h)
    random.seed(seed)
    return random.sample(sorted(hs), n)


def main():
    token = os.environ["IG_TOKEN"]
    ig_id = os.environ["IG_USER_ID"]
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 400
    handles = load_handles(n)

    rows, t0 = [], time.time()
    for i, h in enumerate(handles):
        d, hdr = call(ig_id, token,
                      f"business_discovery.username({h})"
                      "{username,followers_count,media_count,media.limit(25)"
                      "{id,permalink,media_type,timestamp}}")
        if "error" in d:
            e = d["error"]
            rows.append({"handle": h, "ok": False, "code": e.get("code"),
                         "subcode": e.get("error_subcode"), "message": str(e.get("message"))[:120]})
            if e.get("code") in (4, 17, 32, 613):   # レート制限系はここで止める
                print(f"RATE LIMIT at {i}: {e}", flush=True)
                break
        else:
            b = d["business_discovery"]
            media = b.get("media", {}).get("data", [])
            rows.append({
                "handle": h, "ok": True,
                "followers_count": b.get("followers_count"),
                "media_count": b.get("media_count"),
                "media_returned": len(media),
                "has_next_page": bool(b.get("media", {}).get("paging", {}).get("cursors", {}).get("after")),
                "first_permalink": media[0]["permalink"] if media else None,
                "media_types": sorted({m.get("media_type") for m in media}),
            })
        if (i + 1) % 25 == 0:
            ok = sum(1 for r in rows if r["ok"])
            print(f"  {i+1}/{n} ok={ok} ({100*ok/(i+1):.1f}%) elapsed={time.time()-t0:.0f}s"
                  f" usage={hdr.get('x-business-use-case-usage','')[:120]}", flush=True)

    ok = [r for r in rows if r["ok"]]
    ng = [r for r in rows if not r["ok"]]
    from collections import Counter
    summary = {
        "attempted": len(rows),
        "resolved": len(ok),
        "resolve_pct": round(100 * len(ok) / max(len(rows), 1), 2),
        "error_codes": Counter(f"{r['code']}/{r['subcode']}" for r in ng).most_common(),
        "media_count_total": sum(r["media_count"] or 0 for r in ok),
        "media_count_median": sorted(r["media_count"] or 0 for r in ok)[len(ok) // 2] if ok else 0,
        "with_next_page": sum(1 for r in ok if r["has_next_page"]),
        "elapsed_sec": round(time.time() - t0, 1),
        "calls_per_hour": round(3600 * len(rows) / max(time.time() - t0, 1)),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    json.dump({"summary": summary, "rows": rows},
              open(f"{OUT}/ig_business_discovery.json", "w"), ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
