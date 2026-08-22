#!/usr/bin/env python3
# #1273 【バグ】初回実行で index.commoncrawl.org に同時10接続で叩いた結果、
#             conn_reset / RemoteDisconnected が多発し「CCに無い(not_in_cc)」と
#             「レート制限で引けなかった」が混ざった。これは実測値として使えない。
#             ここでレコード0件の店だけを 低並列＋指数バックオフ で引き直し、
#             取れた店については Phase C（WARC取得→抽出→画像生存確認）もやり直して
#             out/archived-html.json を上書き更新する。
import importlib.util
import json
import os
import time
import urllib.parse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("ah", os.path.join(BASE, "archived-html.py"))
ah = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ah)

OUT = os.path.join(BASE, "out", "archived-html.json")
d = json.load(open(OUT, encoding="utf-8"))
prev = json.load(open(os.path.join(BASE, "out", "own-website-images.json"), encoding="utf-8"))
prev_by_id = {s["id"]: s for s in prev["results"]}
prev_ok = {s["id"]: s["n_verified_dish"] > 0 for s in prev["results"]}

rows = {r["id"]: r for r in d["results"]}
# #1273 【バグ】初回は KeyError で1店落ちていた。ここで補充する。
for sid, s in prev_by_id.items():
    if sid not in rows:
        rows[sid] = {"id": sid, "name": s.get("name", ""), "locality": s.get("locality"),
                     "tier": s.get("tier"), "website": s["website"], "domain": s["domain"],
                     "is_portal": s["is_portal"], "prev_fail_reason": s.get("fail_reason"),
                     "prev_had_dish": prev_ok.get(sid, False), "cc_n_records": 0,
                     "wayback": {}, "pages": [], "html_ok": False, "n_candidates": 0,
                     "verified": [], "n_verified_dish": 0, "img_checks": [],
                     "fail_reason": "not_in_cc"}

todo = [r for r in rows.values() if r["cc_n_records"] == 0]
print("retry targets:", len(todo), flush=True)
t0 = time.time()


def retry_index(row):
    """#1273 【設計】1店につき最大3回×2期。429/reset は指数バックオフして必ず判定を確定させる。"""
    p = urllib.parse.urlsplit(row["website"])
    host, path = p.netloc.lower(), p.path
    # #1273 【設計】まず最新期だけを最大3回引く。0件が確定した店だけ1期前も見る。
    #             （全店×2期を毎回引くと index.commoncrawl.org の応答待ちで時間が溶ける）
    recs, last_err, confirmed_empty = [], None, False
    for idx in ah.CC_INDEXES[:2]:
        for attempt in range(3):
            r, e = ah.cc_index_query(host, idx, path=path)
            if r is not None:
                recs.extend(r)
                if not r:
                    confirmed_empty = True
                last_err = None
                break
            last_err = e
            time.sleep(0.8 * (2 ** attempt))
        if recs or last_err:
            break
    return row["id"], recs, last_err, confirmed_empty


got = {}
errs = {}
empty = set()
with ThreadPoolExecutor(max_workers=6) as ex:
    futs = [ex.submit(retry_index, r) for r in todo]
    done = 0
    for f in as_completed(futs):
        sid, recs, err, ce = f.result()
        got[sid] = recs
        if err:
            errs[sid] = err
        if ce:
            empty.add(sid)
        done += 1
        if done % 25 == 0:
            print("  retry %d/%d %.0fs" % (done, len(todo), time.time() - t0), flush=True)

newly = {sid: r for sid, r in got.items() if r}
print("newly found in CC:", len(newly), " still-unresolved errors:", len(errs), flush=True)

# ---- 新たに見つかった店について Phase C をやり直す
def phase_c(sid):
    row = rows[sid]
    recs = newly[sid]
    row["cc_n_records"] = len(recs)
    host = urllib.parse.urlsplit(row["website"]).netloc.lower()
    pages = ah.pick_pages(recs, host, cap=3)
    all_c = []
    row["pages"] = []
    for pr in pages:
        html, err = ah.warc_fetch(pr)
        row["pages"].append({"url": pr["url"], "timestamp": pr["timestamp"],
                             "err": err, "len": len(html) if html else 0})
        if html:
            row["html_ok"] = True
            try:
                all_c.extend(ah.extract_candidates(html, pr["url"]))
            except Exception as e:
                row["pages"][-1]["extract_err"] = type(e).__name__
    uniq = {}
    for c in all_c:
        if c["url"] not in uniq or c["score"] > uniq[c["url"]]["score"]:
            uniq[c["url"]] = c
    cands = sorted(uniq.values(), key=lambda r: -r["score"])
    row["n_candidates"] = len(cands)
    row["img_checks"] = []
    row["verified"] = []
    for c in [x for x in cands if x["score"] > 0][:5]:
        v = ah.verify_image_live(c["url"])
        row["img_checks"].append({"url": c["url"], "ok": v.get("ok"), "reason": v.get("reason"),
                                  "w": v.get("w"), "h": v.get("h")})
        if ah.is_dish_like(v, c):
            row["verified"].append({"url": c["url"], "alt": c["alt"][:120],
                                    "context": c["context"][:120], "origins": c["origins"],
                                    "w": v["w"], "h": v["h"], "score": c["score"]})
    row["n_verified_dish"] = len(row["verified"])
    row["fail_reason"] = (None if row["n_verified_dish"] else
                          ("warc_fetch_failed" if not row["html_ok"] else "no_live_dish_image"))
    return sid


if newly:
    with ThreadPoolExecutor(max_workers=8) as ex:
        list(as_completed([ex.submit(phase_c, sid) for sid in newly]))

for sid in errs:
    if not newly.get(sid):
        rows[sid]["fail_reason"] = "cc_index_unavailable(" + errs[sid] + ")"

results = list(rows.values())
n = len(results)
n_cc = sum(1 for r in results if r["cc_n_records"] > 0)
n_unresolved = sum(1 for r in results if str(r.get("fail_reason", "")).startswith("cc_index_unavailable"))
n_html = sum(1 for r in results if r["html_ok"])
n_dish = sum(1 for r in results if r["n_verified_dish"] > 0)
n_img = sum(len(r["img_checks"]) for r in results)
n_live = sum(1 for r in results for c in r["img_checks"] if c["ok"])
n_any_live = sum(1 for r in results if any(c["ok"] for c in r["img_checks"]))
n_cand = sum(1 for r in results if r["img_checks"])
rescued = [r for r in results if r["prev_fail_reason"] and r["n_verified_dish"] > 0]
union_ids = set(sid for sid in prev_ok if prev_ok[sid]) | set(r["id"] for r in results if r["n_verified_dish"] > 0)
img_fail = Counter(c.get("reason") or "?" for r in results for c in r["img_checks"] if not c["ok"])

d["retry_pass"] = {
    "note": "初回の並列10は index.commoncrawl.org にレート制限され、not_in_cc と "
            "取得失敗が混ざっていた。0件の店を並列6＋指数バックオフで再判定した結果。",
    "retried": len(todo), "newly_found": len(newly), "still_unresolved": n_unresolved,
}
d["n_evaluated"] = n
d["phaseA_cc_archived"] = n_cc
d["phaseA_cc_archived_pct_of_305"] = round(100.0 * n_cc / n, 2)
d["phaseA_cc_unresolved"] = n_unresolved
d["phaseC_html_ok"] = n_html
d["phaseC_html_ok_pct_of_305"] = round(100.0 * n_html / n, 2)
d["n_store_with_candidates"] = n_cand
d["n_images_checked"] = n_img
d["n_images_live"] = n_live
d["image_liveness_pct"] = round(100.0 * n_live / n_img, 2) if n_img else 0.0
d["n_store_with_any_live_image"] = n_any_live
d["n_store_with_verified_dish_image"] = n_dish
d["coverage_pct_of_600_raw"] = round(100.0 * n_dish / 600, 2)
d["n_rescued_from_1304_failures"] = len(rescued)
d["rescued_examples"] = [{"name": r["name"], "prev_fail": r["prev_fail_reason"],
                          "n_dish": r["n_verified_dish"]} for r in rescued[:15]]
d["union_1304_and_archive_stores"] = len(union_ids)
d["union_coverage_pct_of_600_raw"] = round(100.0 * len(union_ids) / 600, 2)
d["image_fail_reasons"] = dict(img_fail.most_common())
d["fail_reasons"] = dict(Counter(r.get("fail_reason") for r in results if r.get("fail_reason")).most_common())
d["results"] = results
json.dump(d, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
for k, v in d.items():
    if k != "results":
        print(" ", k, "=", json.dumps(v, ensure_ascii=False, default=str)[:300], flush=True)
