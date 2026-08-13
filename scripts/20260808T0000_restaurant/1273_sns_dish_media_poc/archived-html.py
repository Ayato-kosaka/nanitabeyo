#!/usr/bin/env python3
# #1273 【設計】アイデア「Common Crawl / Wayback 経由で店舗公式サイトのHTMLを取り、
#             #1304 の取得失敗（サイト落ち・移転・ブロック・環境の:80遮断）を回避する」の実測。
# #1273 【仕様】母集団は絶対に変えない。out/supply_ceiling_2026-08-13.json の同じ600店、
#             そのうち Overture websites を持つ305店（#1304 と同一集合）。
# #1273 【設計】本アイデアの成否は「HTMLが取れるか」ではなく
#             「HTMLから出た画像URLが今も生きているか」で決まる。ここを必ず実測する。
# #1273 【バグ】この実行環境では web.archive.org:443 が TLS ハンドシェイク中に
#             Connection reset される（CONNECT は 200 で通るので egress ポリシー拒否ではなく
#             IA 側のデータセンタIP遮断）。よって Wayback は
#             archive.org/wayback/available（疎通OK）で「アーカイブ有無」だけを測り、
#             HTML 実取得は Common Crawl の WARC Range GET で行う。

import gzip
import io
import json
import os
import re
import sys
import time
import threading
import urllib.parse
import urllib.request
import urllib.error
import urllib.robotparser
from collections import defaultdict, Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

from bs4 import BeautifulSoup
from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "out", "archived-html.json")
PREV = os.path.join(BASE, "out", "own-website-images.json")  # #1304 の実測結果

UA = "nanitabeyo-research/0.1 (restaurant dish-image feasibility PoC; contact: sharess117@gmail.com)"
TIMEOUT = 25

# #1273 【仕様】Common Crawl のインデックス。新しい順に最大3期分だけ引く（時間制約）。
CC_INDEXES = ["CC-MAIN-2026-30", "CC-MAIN-2026-25", "CC-MAIN-2026-21"]
WB_N = 120  # Wayback 有無を測るサブセット件数
CC_INDEX_URL = "https://index.commoncrawl.org/%s-index"
CC_DATA = "https://data.commoncrawl.org/"
WB_AVAIL = "https://archive.org/wayback/available?url="

# #1273 【仕様】#1304 と同一の抽出ルール（そのまま流用。比較可能性のため変更しない）。
NEG_RE = re.compile(
    r"(logo|icon|favicon|sprite|banner|btn|button|arrow|bg[_-]|_bg\.|header|footer|"
    r"nav[_-]|sns|share|qr|map|access|line[_-]|blank|spacer|dummy|loading|"
    r"placeholder|badge|ribbon|title[_-]|ttl[_-]|h1[_-]|copyright)", re.I)
FOOD_RE = re.compile(
    r"(料理|メニュー|menu|dish|food|cuisine|コース|course|ランチ|lunch|ディナー|dinner|"
    r"御膳|定食|丼|寿司|鮨|刺身|そば|蕎麦|うどん|ラーメン|らーめん|焼肉|焼鳥|天ぷら|"
    r"ケーキ|パン|パスタ|ピザ|カレー|お造り|前菜|一品|逸品|盛り|鍋|串|弁当|甘味|"
    r"デザート|dessert|drink|ドリンク|酒|ビール|cake|bread|sushi|ramen|yakiniku|"
    r"gohan|osusume|おすすめ|名物|自慢|品書|献立|食事|グラタン|カツ|唐揚|天丼|"
    r"steak|ステーキ|salad|サラダ|soup|スープ|coffee|珈琲|cafe)", re.I)

_host_lock = defaultdict(threading.Lock)
_host_last = defaultdict(float)
_guard = threading.Lock()


# #1273 【仕様】相手サーバ配慮: 店舗オリジンは1ホスト同時1接続・1秒間隔。
#             Common Crawl / archive.org は一括配信を前提にしたCDNなので直列化はせず、
#             同時接続数（ワーカ数）だけで抑える。
BULK_HOSTS = {"index.commoncrawl.org", "data.commoncrawl.org", "archive.org"}


def host_gate(host):
    if host in BULK_HOSTS:
        return None
    with _guard:
        lk = _host_lock[host]
    lk.acquire()
    w = 1.0 - (time.time() - _host_last[host])
    if w > 0:
        time.sleep(w)
    return lk


def host_release(host, lk):
    if lk is None:
        return
    _host_last[host] = time.time()
    lk.release()


def http_get(url, maxbytes=2_000_000, accept="*/*", extra=None, method="GET"):
    hdr = {"User-Agent": UA, "Accept": accept, "Accept-Encoding": "identity"}
    if extra:
        hdr.update(extra)
    req = urllib.request.Request(url, headers=hdr, method=method)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.status, dict(r.headers), r.read(maxbytes)


def classify(e):
    import ssl
    import socket
    if isinstance(e, urllib.error.HTTPError):
        return "http_%d" % e.code
    if isinstance(e, urllib.error.URLError):
        s = str(e.reason)
        if isinstance(e.reason, ssl.SSLError) or "SSL" in s or "certificate" in s.lower():
            return "ssl"
        if "timed out" in s.lower() or isinstance(e.reason, socket.timeout):
            return "timeout"
        if "Name or service not known" in s or "getaddrinfo" in s:
            return "dns"
        if "refused" in s:
            return "conn_refused"
        if "reset" in s.lower():
            return "conn_reset"
        return "urlerror"
    if isinstance(e, TimeoutError):
        return "timeout"
    return "other:" + type(e).__name__


# ---------------------------------------------------------------- CC index

def cc_index_query(host, index_id, limit=300, path=""):
    """#1273 【設計】自社ドメインは matchType=domain でサイト全体を引く。
    #1273 【バグ】ポータル（localplace.jp 等）で domain 指定すると無関係な他店ページが
                 大量に返るので、パスを持つURLは matchType=prefix で自店ページに限定する。"""
    if path and path.strip("/") not in ("", "index.html", "index.php"):
        target, mt = host + path, "prefix"
    else:
        target, mt = host, "domain"
    q = ("%s?url=%s&matchType=%s&output=json&limit=%d"
         "&filter=status:200&filter=~mime:.*html.*" %
         (CC_INDEX_URL % index_id, urllib.parse.quote(target), mt, limit))
    lk = host_gate("index.commoncrawl.org")
    try:
        st, hd, body = http_get(q, 8_000_000, "application/json")
    except Exception as e:
        c = classify(e)
        # #1273 【仕様】CDX API は該当キャプチャ 0 件のとき 404 を返す。エラーではなく「無し」。
        return ([], None) if c == "http_404" else (None, c)
    finally:
        host_release("index.commoncrawl.org", lk)
    recs = []
    for line in body.decode("utf-8", "replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            recs.append(json.loads(line))
        except Exception:
            pass
    return recs, None


def wb_available(url):
    """#1273 【仕様】web.archive.org が本環境で遮断されているため、
    archive.org の availability API でスナップショット有無だけ判定する。"""
    lk = host_gate("archive.org")
    try:
        st, hd, body = http_get(WB_AVAIL + urllib.parse.quote(url, safe=""), 200_000, "application/json")
        d = json.loads(body.decode("utf-8", "replace"))
        snap = (d.get("archived_snapshots") or {}).get("closest")
        if snap and snap.get("available"):
            return {"archived": True, "timestamp": snap.get("timestamp"), "status": snap.get("status")}
        return {"archived": False}
    except Exception as e:
        return {"archived": None, "error": classify(e)}
    finally:
        host_release("archive.org", lk)


# ---------------------------------------------------------------- WARC 取得

def warc_fetch(rec):
    """#1273 【設計】#1281 と同じ Range GET で WARC レコードだけを切り出す。
    #1273 【バグ】gzip は member 単位なので、Range で切った断片をそのまま gunzip できる。"""
    url = CC_DATA + rec["filename"]
    off = int(rec["offset"])
    ln = int(rec["length"])
    lk = host_gate("data.commoncrawl.org")
    try:
        st, hd, body = http_get(url, ln + 4096, "*/*",
                                extra={"Range": "bytes=%d-%d" % (off, off + ln - 1)})
    except Exception as e:
        return None, classify(e)
    finally:
        host_release("data.commoncrawl.org", lk)
    try:
        raw = gzip.decompress(body)
    except Exception:
        try:
            raw = gzip.GzipFile(fileobj=io.BytesIO(body)).read()
        except Exception as e:
            return None, "gunzip:" + type(e).__name__
    # WARC ヘッダ / HTTP ヘッダ / 本文 の3ブロック
    parts = raw.split(b"\r\n\r\n", 2)
    if len(parts) < 3:
        return None, "warc_parse"
    http_hdr = parts[1].decode("latin-1", "replace")
    payload = parts[2]
    enc = "utf-8"
    m = re.search(r"charset=([\w-]+)", http_hdr, re.I)
    if m:
        enc = m.group(1)
    else:
        m2 = re.search(rb"charset=[\"']?([\w-]+)", payload[:4000], re.I)
        if m2:
            enc = m2.group(1).decode("ascii", "ignore")
    try:
        html = payload.decode(enc, "replace")
    except LookupError:
        html = payload.decode("utf-8", "replace")
    return html, None


# ---------------------------------------------------------------- 抽出（#1304 と同一）

def extract_candidates(html, page_url):
    soup = BeautifulSoup(html, "html.parser")
    cands = {}

    def add(src, alt, ctx, origin):
        if not src:
            return
        src = src.strip()
        if src.startswith("data:") or not src:
            return
        u = urllib.parse.urljoin(page_url, src)
        if not u.startswith("http"):
            return
        if u.split("?")[0].lower().endswith(".svg"):
            return
        rec = cands.get(u) or {"url": u, "alt": "", "context": "", "origins": []}
        if alt and len(alt) > len(rec["alt"]):
            rec["alt"] = alt[:200]
        if ctx and len(ctx) > len(rec["context"]):
            rec["context"] = ctx[:200]
        if origin not in rec["origins"]:
            rec["origins"].append(origin)
        cands[u] = rec

    for m in soup.find_all("meta"):
        prop = (m.get("property") or m.get("name") or "").lower()
        if prop in ("og:image", "og:image:url", "twitter:image", "twitter:image:src"):
            add(m.get("content"), "", (soup.title.get_text() if soup.title else ""), "og")

    for s in soup.find_all("script", attrs={"type": re.compile("ld\\+json", re.I)}):
        try:
            data = json.loads(s.string or "{}")
        except Exception:
            continue
        stack = [data]
        while stack:
            n = stack.pop()
            if isinstance(n, list):
                stack.extend(n)
            elif isinstance(n, dict):
                t = str(n.get("@type", ""))
                for k, v in n.items():
                    if k in ("image", "photo", "logo", "contentUrl", "thumbnailUrl"):
                        if isinstance(v, str):
                            add(v, n.get("name", "") or "", t, "jsonld:" + (t or "?"))
                        elif isinstance(v, dict):
                            add(v.get("url") or v.get("contentUrl"),
                                v.get("caption", "") or n.get("name", "") or "", t, "jsonld:" + (t or "?"))
                        elif isinstance(v, list):
                            for it in v:
                                if isinstance(it, str):
                                    add(it, n.get("name", "") or "", t, "jsonld:" + (t or "?"))
                                elif isinstance(it, dict):
                                    add(it.get("url") or it.get("contentUrl"),
                                        it.get("caption", "") or "", t, "jsonld:" + (t or "?"))
                    elif isinstance(v, (dict, list)):
                        stack.append(v)

    for img in soup.find_all("img"):
        src = (img.get("src") or img.get("data-src") or img.get("data-original")
               or img.get("data-lazy-src") or "")
        if not src:
            ss = img.get("srcset") or img.get("data-srcset") or ""
            if ss:
                src = ss.split(",")[0].strip().split(" ")[0]
        alt = img.get("alt") or img.get("title") or ""
        ctx = ""
        par = img.parent
        for _ in range(3):
            if par is None:
                break
            txt = par.get_text(" ", strip=True)
            if txt:
                ctx = txt[:200]
                break
            par = par.parent
        cls = " ".join(img.get("class") or []) + " " + (img.get("id") or "")
        add(src, alt, (ctx + " " + cls).strip(), "img")

    out = []
    for u, rec in cands.items():
        blob = u + " " + rec["alt"] + " " + rec["context"] + " " + " ".join(rec["origins"])
        neg = bool(NEG_RE.search(u)) or bool(NEG_RE.search(rec["alt"] + " " + rec["context"]))
        food = bool(FOOD_RE.search(blob))
        page_food = bool(FOOD_RE.search(page_url))
        rec["negative"] = neg
        rec["food_word"] = food
        rec["page_food"] = page_food
        rec["score"] = (2 if food else 0) + (1 if page_food else 0) + (-3 if neg else 0)
        out.append(rec)
    out.sort(key=lambda r: -r["score"])
    return out


_robots = {}
_rlock = threading.Lock()


def robots_allows(url):
    p = urllib.parse.urlsplit(url)
    key = p.netloc
    with _rlock:
        hit = _robots.get(key)
    if hit is None:
        rp = urllib.robotparser.RobotFileParser()
        lk = host_gate(key)
        try:
            st, hd, body = http_get("https://%s/robots.txt" % key, 200_000, "text/plain")
            rp.parse(body.decode("utf-8", "replace").splitlines())
            hit = rp
        except Exception:
            hit = "none"
        finally:
            host_release(key, lk)
        with _rlock:
            _robots[key] = hit
    if hit == "none":
        return True
    try:
        return hit.can_fetch(UA, url)
    except Exception:
        return True


def verify_image_live(url):
    """#1273 【設計】本アイデアの核心。アーカイブHTMLから出た画像URLが
    「今」オリジンで生きているかを実測する。HTMLが取れても画像が死んでいれば無意味。"""
    if url.startswith("http://"):
        # #1273 【バグ】本環境は平文HTTP(:80)が遮断されるので https に上げて試す。
        url = "https://" + url[len("http://"):]
    p = urllib.parse.urlsplit(url)
    if not robots_allows(url):
        return {"ok": False, "reason": "robots_disallow"}
    lk = host_gate(p.netloc)
    try:
        st, hd, body = http_get(url, 600_000, "image/*")
        ct = hd.get("Content-Type", "")
        if "image" not in ct.lower():
            return {"ok": False, "reason": "not_image", "content_type": ct}
        try:
            im = Image.open(io.BytesIO(body))
            w, h = im.size
        except Exception:
            return {"ok": False, "reason": "undecodable", "bytes": len(body)}
        return {"ok": True, "content_type": ct, "bytes": len(body), "w": w, "h": h}
    except Exception as e:
        return {"ok": False, "reason": classify(e)}
    finally:
        host_release(p.netloc, lk)


def is_dish_like(v, rec):
    """#1273 【仕様】#1304 と同じ合格条件: 実画像・長辺400px以上・アスペクト0.4〜2.5・
    否定語なし・料理語ヒット。"""
    if not v.get("ok"):
        return False
    w, h = v.get("w", 0), v.get("h", 0)
    if max(w, h) < 400:
        return False
    ar = (w / h) if h else 0
    if ar < 0.4 or ar > 2.5:
        return False
    if rec.get("negative"):
        return False
    return bool(rec.get("food_word"))


# ---------------------------------------------------------------- main

def pick_pages(recs, host, cap=3):
    """#1273 【設計】1店あたり最大3ページ。料理語を含むURLを優先し、次にトップページ。"""
    seen = {}
    for r in recs:
        u = r.get("url", "")
        if not u:
            continue
        key = u.split("#")[0]
        if key in seen and seen[key]["timestamp"] >= r["timestamp"]:
            continue
        seen[key] = r
    reg = ".".join(host.split(".")[-2:])
    items = [r for r in seen.values()
             if urllib.parse.urlsplit(r["url"]).netloc.lower().endswith(reg)]

    def rank(r):
        u = r["url"]
        path = urllib.parse.urlsplit(u).path.rstrip("/")
        food = 1 if FOOD_RE.search(u) else 0
        top = 1 if path in ("", "/index.html", "/index.php") else 0
        # #1273 【バグ】リダイレクト用の極小HTML(数百B)を掴むと候補ゼロになるので長さで弾く
        big = 1 if int(r.get("length", 0)) > 3000 else 0
        return (-big, -food, -top, len(path))

    items.sort(key=rank)
    return items[:cap]


def main():
    prev = json.load(open(PREV, encoding="utf-8"))
    stores = prev["results"]  # 305店（600店中 websites を持つ集合）
    prev_ok = {s["id"]: s["n_verified_dish"] > 0 for s in stores}
    prev_fail = {s["id"]: s.get("fail_reason") for s in stores}

    hosts = {}
    for s in stores:
        h = urllib.parse.urlsplit(s["website"]).netloc.lower()
        hosts[s["id"]] = h

    log = lambda *a: (print(*a, flush=True))
    t0 = time.time()

    # ---- Phase A: Common Crawl インデックスにあるか
    log("[A] Common Crawl index (%d stores x %d crawls)" % (len(stores), len(CC_INDEXES)))
    cc_recs = {}
    cc_err = {}

    paths = {s["id"]: urllib.parse.urlsplit(s["website"]).path for s in stores}

    def phase_a(s):
        h = hosts[s["id"]]
        allr, err = [], None
        for idx in CC_INDEXES:
            r, e = cc_index_query(h, idx, path=paths[s["id"]])
            if r is None:
                err = e
                continue
            allr.extend(r)
            if len(allr) >= 40:
                break  # 十分な件数が取れたら古い期は引かない
        return s["id"], allr, err

    with ThreadPoolExecutor(max_workers=10) as ex:
        futs = [ex.submit(phase_a, s) for s in stores]
        done = 0
        for f in as_completed(futs):
            sid, recs, err = f.result()
            cc_recs[sid] = recs
            if err and not recs:
                cc_err[sid] = err
            done += 1
            if done % 50 == 0:
                log("   A %d/%d  %.0fs" % (done, len(stores), time.time() - t0))

    n_cc = sum(1 for s in stores if cc_recs.get(s["id"]))
    log("[A] CC archived: %d/%d = %.2f%%" % (n_cc, len(stores), 100.0 * n_cc / len(stores)))

    # ---- Phase B: Wayback にあるか（availability API）
    # #1273 【仕様】archive.org 側の負荷配慮と時間制約から、Wayback 有無は
    #             SHA-256(id) 昇順の先頭 WB_N 店のサブセットで測る（鉄則1の部分集合規則）。
    import hashlib
    wb_sub = sorted(stores, key=lambda s: hashlib.sha256(s["id"].encode()).hexdigest())[:WB_N]
    log("[B] Wayback availability (subset n=%d)" % len(wb_sub))
    wb = {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(wb_available, s["website"]): s["id"] for s in wb_sub}
        done = 0
        for f in as_completed(futs):
            wb[futs[f]] = f.result()
            done += 1
            if done % 60 == 0:
                log("   B %d/%d  %.0fs" % (done, len(stores), time.time() - t0))
    n_wb = sum(1 for v in wb.values() if v.get("archived"))
    n_wb_den = sum(1 for v in wb.values() if v.get("archived") is not None)
    log("[B] Wayback archived: %d/%d = %.2f%%" % (n_wb, n_wb_den, 100.0 * n_wb / max(n_wb_den, 1)))

    # ---- Phase C: WARC から HTML を取り、画像候補を抽出し、画像の生存を実測
    log("[C] WARC fetch + extract + image liveness")
    results = []

    def phase_c(s):
        sid = s["id"]
        recs = cc_recs.get(sid) or []
        row = {
            # #1273 【バグ】#1304 の results は1件だけ locality/tier を欠く行がある。
            #             KeyError で行ごと落とすと母数が狂うので .get() で受ける。
            "id": sid, "name": s.get("name", ""), "locality": s.get("locality"), "tier": s.get("tier"),
            "website": s["website"], "domain": s["domain"], "is_portal": s["is_portal"],
            "prev_fail_reason": prev_fail.get(sid),
            "prev_had_dish": prev_ok.get(sid, False),
            "cc_n_records": len(recs),
            "wayback": wb.get(sid, {}),
            "pages": [], "html_ok": False, "n_candidates": 0,
            "verified": [], "n_verified_dish": 0, "img_checks": [],
        }
        if not recs:
            row["fail_reason"] = "not_in_cc"
            return row
        pages = pick_pages(recs, hosts[sid], cap=3)
        all_c = []
        for pr in pages:
            html, err = warc_fetch(pr)
            row["pages"].append({"url": pr["url"], "timestamp": pr["timestamp"],
                                 "crawl": pr.get("filename", "")[:40], "err": err,
                                 "len": len(html) if html else 0})
            if html:
                row["html_ok"] = True
                try:
                    all_c.extend(extract_candidates(html, pr["url"]))
                except Exception as e:
                    row["pages"][-1]["extract_err"] = type(e).__name__
        # URL重複排除・スコア降順
        uniq = {}
        for c in all_c:
            if c["url"] not in uniq or c["score"] > uniq[c["url"]]["score"]:
                uniq[c["url"]] = c
        cands = sorted(uniq.values(), key=lambda r: -r["score"])
        row["n_candidates"] = len(cands)
        # #1273 【仕様】上位候補（否定語を除き、スコア>0）を最大5件だけ実際に取得して検証。
        pick = [c for c in cands if c["score"] > 0][:5]
        for c in pick:
            v = verify_image_live(c["url"])
            row["img_checks"].append({"url": c["url"], "ok": v.get("ok"),
                                      "reason": v.get("reason"), "w": v.get("w"), "h": v.get("h")})
            if is_dish_like(v, c):
                row["verified"].append({"url": c["url"], "alt": c["alt"][:120],
                                        "context": c["context"][:120],
                                        "origins": c["origins"], "w": v["w"], "h": v["h"],
                                        "score": c["score"]})
        row["n_verified_dish"] = len(row["verified"])
        if not row["html_ok"]:
            row["fail_reason"] = "warc_fetch_failed"
        elif row["n_verified_dish"] == 0:
            row["fail_reason"] = "no_live_dish_image"
        return row

    with ThreadPoolExecutor(max_workers=12) as ex:
        futs = [ex.submit(phase_c, s) for s in stores]
        done = 0
        for f in as_completed(futs):
            try:
                results.append(f.result())
            except Exception as e:
                log("   C error", type(e).__name__, e)
            done += 1
            if done % 25 == 0:
                log("   C %d/%d  %.0fs" % (done, len(stores), time.time() - t0))

    # ---- 集計
    n = len(stores)
    n_html = sum(1 for r in results if r["html_ok"])
    n_dish = sum(1 for r in results if r["n_verified_dish"] > 0)
    n_img_checked = sum(len(r["img_checks"]) for r in results)
    n_img_live = sum(1 for r in results for c in r["img_checks"] if c["ok"])
    n_store_any_live_img = sum(1 for r in results if any(c["ok"] for c in r["img_checks"]))
    n_store_had_cand = sum(1 for r in results if r["img_checks"])

    # #1304 との比較: あちらで取得失敗した店を救えたか
    rescued = [r for r in results if r["prev_fail_reason"] and r["n_verified_dish"] > 0]
    union_ids = set(s["id"] for s in stores if prev_ok.get(s["id"])) | \
        set(r["id"] for r in results if r["n_verified_dish"] > 0)

    img_fail = Counter()
    for r in results:
        for c in r["img_checks"]:
            if not c["ok"]:
                img_fail[c.get("reason") or "?"] += 1

    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "slug": "archived-html",
        "sample_source": "out/supply_ceiling_2026-08-13.json (600店) の websites 保有305店",
        "sample_size_600": 600,
        "n_with_website": n,
        "cc_indexes_queried": CC_INDEXES,
        "phaseA_cc_archived": n_cc,
        "phaseA_cc_archived_pct_of_305": round(100.0 * n_cc / n, 2),
        "phaseB_wayback_subset_n": len(wb),
        "phaseB_wayback_answered": n_wb_den,
        "phaseB_wayback_archived": n_wb,
        "phaseB_wayback_archived_pct_of_subset": round(100.0 * n_wb / max(n_wb_den, 1), 2),
        "phaseB_wayback_errors": dict(Counter(v.get("error") for v in wb.values() if v.get("error")).most_common()),
        "prev_1304_html_ok": 153,
        "prev_1304_html_ok_pct": 50.2,
        "phaseC_html_ok": n_html,
        "phaseC_html_ok_pct_of_305": round(100.0 * n_html / n, 2),
        "n_store_with_candidates": n_store_had_cand,
        "n_images_checked": n_img_checked,
        "n_images_live": n_img_live,
        "image_liveness_pct": round(100.0 * n_img_live / n_img_checked, 2) if n_img_checked else 0.0,
        "n_store_with_any_live_image": n_store_any_live_img,
        "n_store_with_verified_dish_image": n_dish,
        "coverage_pct_of_600_raw": round(100.0 * n_dish / 600, 2),
        "prev_1304_coverage_pct_of_600_raw": prev["coverage_pct_of_600_raw"],
        "prev_1304_coverage_pct_of_600_precision_adjusted": prev["coverage_pct_of_600_precision_adjusted"],
        "n_rescued_from_1304_failures": len(rescued),
        "union_1304_and_archive_stores": len(union_ids),
        "union_coverage_pct_of_600_raw": round(100.0 * len(union_ids) / 600, 2),
        "image_fail_reasons": dict(img_fail.most_common()),
        "fail_reasons": dict(Counter(r.get("fail_reason") for r in results if r.get("fail_reason")).most_common()),
        "cc_index_errors": dict(Counter(cc_err.values()).most_common()),
        "env_limitation": {
            "note": "web.archive.org:443 が TLS handshake 中に reset される（CONNECT は 200 なので"
                    " egress ポリシー拒否ではなく IA 側の遮断）。Wayback は実HTML取得に使えず、"
                    " archive.org/wayback/available による有無判定のみ実施。",
        },
        "results": results,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=1)
    log("== DONE %.0fs ==" % (time.time() - t0))
    for k, v in summary.items():
        if k != "results":
            log(" ", k, "=", json.dumps(v, ensure_ascii=False, default=str)[:400])


if __name__ == "__main__":
    main()
