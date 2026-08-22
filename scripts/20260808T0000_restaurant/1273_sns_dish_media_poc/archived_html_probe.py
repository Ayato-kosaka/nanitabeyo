#!/usr/bin/env python3
# #1273 【設計】index.commoncrawl.org が並列アクセスに対してレート制限（RST/RemoteDisconnected）を
#             返すため、305店中171店が「CCに有るか無いか」を判定できないまま残った。
#             ここは並列を一切使わず、1リクエストずつ間隔を空けて確実に判定する。
#             母集団は未判定171店のうち SHA-256(id) 昇順の先頭 N 店（鉄則1の部分集合規則）。
#             得られた比率で全体の CC 収録率を区間として押さえる。
import hashlib
import importlib.util
import json
import os
import sys
import time
import urllib.parse

BASE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("ah", os.path.join(BASE, "archived-html.py"))
ah = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ah)

N = int(sys.argv[1]) if len(sys.argv) > 1 else 45
d = json.load(open(os.path.join(BASE, "out", "archived-html.json"), encoding="utf-8"))
unres = [r for r in d["results"] if str(r.get("fail_reason", "")).startswith("cc_index_unavailable")]
unres.sort(key=lambda r: hashlib.sha256(r["id"].encode()).hexdigest())
sub = unres[:N]
print("unresolved=%d probing=%d" % (len(unres), len(sub)), flush=True)

out = []
t0 = time.time()
for i, r in enumerate(sub):
    p = urllib.parse.urlsplit(r["website"])
    verdict, recs, err = None, [], None
    for idx in ah.CC_INDEXES[:2]:
        for attempt in range(4):
            rr, e = ah.cc_index_query(p.netloc.lower(), idx, path=p.path)
            if rr is not None:
                recs = rr
                err = None
                break
            err = e
            time.sleep(3.0 * (attempt + 1))
        if recs or err is None:
            break
    if err:
        verdict = "unresolved"
    elif recs:
        verdict = "in_cc"
    else:
        verdict = "not_in_cc"
    out.append({"id": r["id"], "name": r["name"], "website": r["website"],
                "verdict": verdict, "n_recs": len(recs), "err": err,
                "prev_fail_reason": r["prev_fail_reason"], "prev_had_dish": r["prev_had_dish"]})
    print("  %d/%d %s %s" % (i + 1, len(sub), verdict, r["website"][:60]), flush=True)
    time.sleep(2.0)  # #1273 【仕様】相手への配慮とレート制限回避のため1件2秒あける

n_in = sum(1 for o in out if o["verdict"] == "in_cc")
n_not = sum(1 for o in out if o["verdict"] == "not_in_cc")
n_un = sum(1 for o in out if o["verdict"] == "unresolved")
res = {"probed": len(out), "in_cc": n_in, "not_in_cc": n_not, "still_unresolved": n_un,
       "in_cc_rate_of_answered": round(100.0 * n_in / max(n_in + n_not, 1), 2),
       "elapsed_s": round(time.time() - t0), "detail": out}
json.dump(res, open(os.path.join(BASE, "out", "archived-html_probe.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print(json.dumps({k: v for k, v in res.items() if k != "detail"}, ensure_ascii=False), flush=True)
