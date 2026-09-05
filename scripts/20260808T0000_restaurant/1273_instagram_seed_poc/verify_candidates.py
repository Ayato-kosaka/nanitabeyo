"""#1273 serper_bd_pipeline.py が拾った候補ハンドルを business_discovery で裏取りする。

business_discovery は app 単位のレート制限（code 4, is_transient）に当たると数十分止まる。
ここでは **止まったら待って再開する**形にして、トークンが切れるまで回し続ける。
"""
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
GRAPH = "https://graph.facebook.com/v23.0"


def norm(s):
    s = unicodedata.normalize("NFKC", s or "").lower()
    return re.sub(r"[\s　・･'\"()（）\-−ー_,.。、／/]+", "", s)


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


def evidence(store, locality, acct):
    sn, ln = norm(store), norm(locality)
    hay = norm((acct.get("name") or "") + (acct.get("biography") or "")
               + (acct.get("username") or "") + (acct.get("website") or ""))
    return {
        "name_in_account": bool(sn) and len(sn) >= 2 and sn in hay,
        "name_prefix_in_account": len(sn) >= 3 and sn[:4] in hay,
        "locality_in_account": bool(ln) and len(ln) >= 2 and ln in hay,
    }


def main():
    token = os.environ["IG_TOKEN"]
    ig_id = os.environ["IG_USER_ID"]
    deadline = float(os.environ.get("IG_TOKEN_EXPIRES_AT", time.time() + 1800)) - 60

    data = json.load(open(f"{OUT}/serper_bd_pipeline.json"))
    rows = data["rows"]
    todo = [r for r in rows if r.get("candidates") and not r.get("verified")]
    print(f"検証対象 {len(todo)} 店 / 締切まで {int(deadline - time.time())} 秒", flush=True)

    done = 0
    for r in todo:
        if time.time() > deadline:
            print("トークンの期限が近いので打ち切る", flush=True); break
        for h in r["candidates"][:2]:
            while True:
                if time.time() > deadline:
                    break
                acct, err = bd(ig_id, token, h)
                if err and err.get("code") == 4:
                    print(f"  レート制限。60 秒待つ（残り {int(deadline-time.time())}s）", flush=True)
                    time.sleep(60); continue
                break
            if time.time() > deadline:
                break
            if acct:
                ev = evidence(r["name"], r["locality"], acct)
                r["bd_resolved"] = True
                if ev["name_in_account"] or (ev["name_prefix_in_account"] and ev["locality_in_account"]):
                    r["verified"] = h
                    r["evidence"] = ev
                    r["account"] = {k: acct.get(k) for k in
                                    ("username", "name", "biography", "followers_count", "media_count")}
                    break
        done += 1
        if done % 10 == 0:
            v = sum(1 for x in rows if x.get("verified"))
            print(f"  {done}/{len(todo)} verified={v}", flush=True)

    ok = [r for r in rows if "candidates" in r]
    checked = [r for r in ok if r.get("verified") or r.get("bd_resolved")]
    summary = {
        "n_stores": len(ok),
        "with_candidate": sum(1 for r in ok if r["candidates"]),
        "bd_checked": len(checked),
        "verified": sum(1 for r in ok if r.get("verified")),
        "verified_pct_of_checked": round(100 * sum(1 for r in ok if r.get("verified")) / max(len(checked), 1), 2),
        "media_total_of_verified": sum((r.get("account") or {}).get("media_count") or 0 for r in ok),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    json.dump({"summary": summary, "rows": rows},
              open(f"{OUT}/serper_bd_pipeline.json", "w"), ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
