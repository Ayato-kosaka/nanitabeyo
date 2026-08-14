#!/usr/bin/env python3
# #1273 【設計】Round7 本命「店舗公式サイト → SNS への橋」の実測。
#   仮説1: 店舗サイトのフッター等に SNS アカウントへのリンクがあり、Overture socials より多く取れる
#   仮説2: 多くの店舗サイトが Instagram フィードを埋め込んでおり、埋め込みHTML/ウィジェット経由で
#          Meta API を通さずに投稿画像へ到達できる
# #1273 【仕様】母集団は必ず out/supply_ceiling_2026-08-13.json の同じ600店。#1304 と同じ取得ルール
#             （robots尊重・1ホスト同時1接続・1秒間隔・UA正直申告・画像バイナリは非永続）。
# #1273 【仕様】instagram.com 本体は robots.txt 冒頭で「自動化手段による収集を禁止」と明記されているため
#             一切取得しない。取得対象は「店舗サイト」と「店舗サイトが埋め込んだ第三者ウィジェット」のみ。

import io
import json
import os
import re
import sys
import time
import hashlib
import threading
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from collections import defaultdict, Counter
from concurrent.futures import ThreadPoolExecutor

from bs4 import BeautifulSoup
from PIL import Image
import duckdb

BASE = os.path.dirname(os.path.abspath(__file__))
SAMPLE = os.path.join(BASE, "out", "supply_ceiling_2026-08-13.json")
PARQUET = "/tmp/overture-jp.parquet"
OUT = os.path.join(BASE, "out", "site-to-sns-bridge.json")
IMGDIR = os.path.join(BASE, "out", "_bridge_imgs")

UA = ("nanitabeyo-research/0.1 (restaurant dish-image feasibility PoC; "
      "contact: sharess117@gmail.com)")
TIMEOUT = 12
HTML_MAX = 2_000_000
IMG_MAX = 900_000

PORTAL_RE = re.compile(
    r"(tabelog|gnavi|hotpepper|recruit|instagram|twitter|x\.com|facebook|ameblo|"
    r"goo\.ne\.jp|ubereats|demae-can|retty|ikyu|ozmall|epark|"
    r"toreta|tablecheck|gorp\.jp|owst\.jp|food96\.com|favy\.jp|r\.gnavi|"
    r"line\.me|youtube|tiktok|note\.com|hitosara|yahoo\.co\.jp|google\.)", re.I)

# ---------------------------------------------------------------- 取得基盤（#1304 流用）
_host_lock = defaultdict(threading.Lock)
_host_last = defaultdict(float)
_lock_guard = threading.Lock()


def host_gate(host):
    """#1273 【仕様】1ホスト同時1接続・前回リクエストから1秒以上を強制する。"""
    with _lock_guard:
        lk = _host_lock[host]
    lk.acquire()
    wait = 1.0 - (time.time() - _host_last[host])
    if wait > 0:
        time.sleep(wait)
    return lk


def host_release(host, lk):
    _host_last[host] = time.time()
    lk.release()


def fetch(url, maxbytes, accept):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": accept,
        "Accept-Language": "ja,en;q=0.8",
    })
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.status, dict(r.headers), r.read(maxbytes), r.geturl()


def classify_error(e):
    import ssl
    import socket
    if isinstance(e, urllib.error.HTTPError):
        return "http_%d" % e.code
    if isinstance(e, urllib.error.URLError):
        r = e.reason
        if isinstance(r, ssl.SSLError) or "SSL" in str(r) or "certificate" in str(r).lower():
            return "ssl"
        if isinstance(r, socket.timeout) or "timed out" in str(r).lower():
            return "timeout"
        if "Name or service not known" in str(r) or "getaddrinfo" in str(r):
            return "dns"
        return "urlerror"
    if isinstance(e, TimeoutError):
        return "timeout"
    return "other:" + type(e).__name__


_robots_cache = {}
_robots_lock = threading.Lock()


def robots_allows(url):
    """#1273 【仕様】robots.txt を尊重する。取得できなければ許可扱い。"""
    p = urllib.parse.urlsplit(url)
    key = (p.scheme, p.netloc)
    with _robots_lock:
        hit = _robots_cache.get(key)
    if hit is None:
        rp = urllib.robotparser.RobotFileParser()
        lk = host_gate(p.netloc)
        try:
            st, hd, body, _ = fetch("https://%s/robots.txt" % p.netloc, 200_000, "text/plain")
            rp.parse(body.decode("utf-8", "replace").splitlines())
            hit = rp
        except Exception:
            hit = "none"
        finally:
            host_release(p.netloc, lk)
        with _robots_lock:
            _robots_cache[key] = hit
    if hit == "none":
        return True
    try:
        return hit.can_fetch(UA, url)
    except Exception:
        return True


def get_page(url):
    p = urllib.parse.urlsplit(url)
    if not robots_allows(url):
        return None, "robots_disallow", None
    lk = host_gate(p.netloc)
    try:
        st, hd, body, final = fetch(url, HTML_MAX, "text/html,application/xhtml+xml,*/*")
        ctype = hd.get("Content-Type", "")
        if "html" not in ctype.lower():
            return None, "not_html", final
        enc = "utf-8"
        m = re.search(r"charset=([\w-]+)", ctype, re.I)
        if m:
            enc = m.group(1)
        else:
            m2 = re.search(rb"charset=[\"']?([\w-]+)", body[:4000], re.I)
            if m2:
                enc = m2.group(1).decode("ascii", "ignore")
        try:
            html = body.decode(enc, "replace")
        except LookupError:
            html = body.decode("utf-8", "replace")
        return html, None, final
    except Exception as e:
        return None, classify_error(e), None
    finally:
        host_release(p.netloc, lk)


# ---------------------------------------------------------------- 抽出ロジック
SNS_HOSTS = {
    "instagram": re.compile(r"(?:^|\.)instagram\.com$", re.I),
    "tiktok": re.compile(r"(?:^|\.)tiktok\.com$", re.I),
    "twitter": re.compile(r"(?:^|\.)(?:twitter\.com|x\.com)$", re.I),
    "facebook": re.compile(r"(?:^|\.)(?:facebook\.com|fb\.com|fb\.me|m\.facebook\.com)$", re.I),
    "youtube": re.compile(r"(?:^|\.)(?:youtube\.com|youtu\.be)$", re.I),
}
# #1273 【仕様】アカウント名として無効なパス（機能パス）。プロフィールURLの誤検出を防ぐ。
IG_BAD_PATH = {"p", "reel", "reels", "tv", "explore", "accounts", "developer", "about",
               "legal", "directory", "stories", "embed", "share", "s", "challenge"}
FB_BAD_PATH = {"sharer", "sharer.php", "share.php", "plugins", "tr", "dialog", "login",
               "profile.php", "help", "policies", "sharer%2Fsharer.php", "v2.0", "v3.0"}

# #1273 【設計】埋め込みフィードの痕跡。ウィジェットSaaSは iframe/script のホストで判る。
WIDGET_PATTERNS = [
    ("instagram_blockquote", re.compile(r"class=[\"'][^\"']*instagram-media", re.I)),
    ("instgrm_permalink", re.compile(r"data-instgrm-permalink", re.I)),
    ("instgrm_embed_js", re.compile(r"(?:platform|www)\.instagram\.com/embed\.js", re.I)),
    ("snapwidget", re.compile(r"snapwidget\.com", re.I)),
    ("lightwidget", re.compile(r"lightwidget\.com", re.I)),
    ("elfsight", re.compile(r"elfsight(?:cdn)?\.com|elfsight-app", re.I)),
    ("curator_io", re.compile(r"curator\.io", re.I)),
    ("juicer", re.compile(r"juicer\.io", re.I)),
    ("sociablekit", re.compile(r"sociablekit\.com", re.I)),
    ("taggbox", re.compile(r"taggbox\.com", re.I)),
    ("powr", re.compile(r"powr\.io", re.I)),
    ("behold", re.compile(r"behold\.so", re.I)),
    ("instafeed_js", re.compile(r"instafeed(?:\.min)?\.js|wp-content/plugins/instagram-feed|sb_instagram", re.I)),
    ("embedsocial", re.compile(r"embedsocial\.com", re.I)),
    ("tagembed", re.compile(r"tagembed\.com", re.I)),
    ("fb_page_plugin", re.compile(r"facebook\.com/plugins/(?:page|post|video)\.php", re.I)),
    ("twitter_widget", re.compile(r"platform\.twitter\.com/widgets\.js|class=[\"'][^\"']*twitter-timeline", re.I)),
    ("tiktok_embed", re.compile(r"class=[\"'][^\"']*tiktok-embed|tiktok\.com/embed", re.I)),
]

# #1273 【設計】SNS由来の画像CDN。ここに到達できれば「投稿画像に到達」と言える。
SNS_CDN_RE = re.compile(
    r"https?://[^\s\"'<>\\]*?(?:"
    r"scontent[^\s\"'<>\\]*?\.cdninstagram\.com|cdninstagram\.com|"
    r"scontent[^\s\"'<>\\]*?\.fbcdn\.net|fbcdn\.net|"
    r"pbs\.twimg\.com|"
    r"p1[0-9]-sign[^\s\"'<>\\]*?\.tiktokcdn|tiktokcdn\.com|tiktokcdn-us\.com|"
    r"i\.ytimg\.com|img\.youtube\.com|"
    r"snapwidget\.com/(?:cdn|thumbs)|cdn\.lightwidget\.com|"
    r"cdn\.elfsight\.com"
    r")[^\s\"'<>\\)]*", re.I)

# #1273 【設計】投稿パーマリンク（アカウントではなく個々の投稿）。
POST_RE = re.compile(
    r"https?://(?:www\.)?(?:instagram\.com/(?:p|reel|tv)/[A-Za-z0-9_-]+|"
    r"tiktok\.com/@[\w.\-]+/video/\d+|"
    r"(?:twitter|x)\.com/[\w]+/status/\d+|"
    r"facebook\.com/[^\s\"'<>]*?/posts/[\w\d]+)", re.I)

# #1273 【設計】ウィジェットの iframe。中に画像URLが直接書かれていることがあるので後段で取得する。
WIDGET_IFRAME_RE = re.compile(
    r"https?://[^\s\"'<>]*?(?:snapwidget\.com/embed/[\w\d]+|"
    r"cdn\.lightwidget\.com/widgets/[\w\d]+\.html|"
    r"lightwidget\.com/widgets/[\w\d]+\.html)[^\s\"'<>]*", re.I)


def extract_sns(html, page_url, page_host):
    """#1273 【設計】HTMLから (a) SNSアカウントリンク (b) 投稿パーマリンク
    (c) 埋め込みウィジェット痕跡 (d) SNS画像CDNのURL を抜き出す。"""
    accounts = defaultdict(set)
    soup = BeautifulSoup(html, "html.parser")
    hrefs = set()
    for a in soup.find_all("a", href=True):
        hrefs.add(a["href"])
    # #1273 【バグ】JSで生成されるリンクや data-href にも SNS URL が入るので、生HTMLからも拾う。
    for m in re.finditer(r"https?://(?:www\.)?(?:instagram\.com|tiktok\.com|twitter\.com|"
                         r"x\.com|facebook\.com|fb\.com|fb\.me|youtube\.com|youtu\.be)"
                         r"/[^\s\"'<>\\)]*", html, re.I):
        hrefs.add(m.group(0))

    for h in hrefs:
        u = urllib.parse.urljoin(page_url, h.strip())
        try:
            sp = urllib.parse.urlsplit(u)
        except Exception:
            continue
        host = sp.netloc.lower().split(":")[0]
        for plat, rx in SNS_HOSTS.items():
            if not rx.search(host):
                continue
            segs = [s for s in sp.path.split("/") if s]
            if plat == "instagram":
                if not segs or segs[0].lower() in IG_BAD_PATH:
                    continue
                accounts[plat].add("instagram.com/" + segs[0].lower())
            elif plat == "tiktok":
                if segs and segs[0].startswith("@"):
                    accounts[plat].add("tiktok.com/" + segs[0].lower())
            elif plat == "twitter":
                if segs and segs[0].lower() not in ("share", "intent", "home", "hashtag", "i", "search"):
                    accounts[plat].add("twitter.com/" + segs[0].lower())
            elif plat == "facebook":
                if not segs:
                    continue
                s0 = segs[0].lower()
                if s0 in FB_BAD_PATH or s0.endswith(".php"):
                    continue
                if s0 == "profile.php":
                    continue
                accounts[plat].add("facebook.com/" + s0)
            elif plat == "youtube":
                if "youtu.be" in host:
                    continue
                if segs and (segs[0].startswith("@") or segs[0] in ("channel", "c", "user")):
                    accounts[plat].add("youtube.com/" + "/".join(segs[:2]).lower())

    widgets = [name for name, rx in WIDGET_PATTERNS if rx.search(html)]
    posts = sorted(set(m.group(0) for m in POST_RE.finditer(html)))
    cdn = sorted(set(m.group(0).replace("&amp;", "&") for m in SNS_CDN_RE.finditer(html)))
    iframes = sorted(set(m.group(0).replace("&amp;", "&") for m in WIDGET_IFRAME_RE.finditer(html)))
    return {k: sorted(v) for k, v in accounts.items()}, widgets, posts, cdn, iframes


def verify_image(url, save_as=None):
    """#1273 【仕様】画像を実取得し content-type と実ピクセルサイズを確認する。
    #1273 【設計】目視検証ぶんだけ一時保存し、検証後に破棄する（永続保存はしない）。"""
    if url.startswith("http://"):
        url = "https://" + url[len("http://"):]
    p = urllib.parse.urlsplit(url)
    lk = host_gate(p.netloc)
    try:
        st, hd, body, final = fetch(url, IMG_MAX, "image/*,*/*")
        ct = hd.get("Content-Type", "")
        if "image" not in ct.lower():
            return {"ok": False, "reason": "not_image", "content_type": ct, "url": url}
        try:
            im = Image.open(io.BytesIO(body))
            w, h = im.size
        except Exception:
            return {"ok": False, "reason": "undecodable", "bytes": len(body), "url": url}
        if save_as:
            os.makedirs(IMGDIR, exist_ok=True)
            with open(save_as, "wb") as f:
                f.write(body)
        return {"ok": True, "content_type": ct, "bytes": len(body), "w": w, "h": h, "url": url}
    except Exception as e:
        return {"ok": False, "reason": classify_error(e), "url": url}
    finally:
        host_release(p.netloc, lk)


def normalize(u):
    u = u.strip()
    if not u.startswith("http"):
        u = "http://" + u
    return u


# #1273 【設計】SNSリンクはトップページのフッターにあることが多いが、無い場合は
#   about/contact/access ページに回ることがある。SNSが0件のときだけ1ホップ追加する。
HOP_RE = re.compile(r"(contact|about|access|company|info|shop|store|概要|会社|店舗|"
                    r"アクセス|お問|問い合わせ|instagram|sns)", re.I)


def find_hop(soup, page_url):
    base_host = urllib.parse.urlsplit(page_url).netloc
    for a in soup.find_all("a", href=True):
        u = urllib.parse.urljoin(page_url, a["href"])
        if not u.startswith("http"):
            continue
        if urllib.parse.urlsplit(u).netloc != base_host:
            continue
        if u.rstrip("/") == page_url.rstrip("/"):
            continue
        if HOP_RE.search(a["href"]) or HOP_RE.search(a.get_text(" ", strip=True)):
            return u
    return None


def process(rec):
    res = {"id": rec["id"], "name": rec["name"], "locality": rec["locality"],
           "tier": rec["tier"], "website": rec["website"], "domain": rec["domain"],
           "is_portal": rec["is_portal"], "pages": [], "fail_reason": None,
           "accounts": {}, "widgets": [], "posts": [], "cdn_urls": [], "widget_iframes": []}
    url = normalize(rec["website"])
    tries = [url]
    if url.startswith("http://"):
        tries = ["https://" + url[len("http://"):], url]
    html = None
    errs = []
    for t in tries:
        html, e1, final = get_page(t)
        errs.append(e1)
        if html is not None:
            break
    if html is None:
        res["fail_reason"] = errs[0]
        res["attempt_errors"] = errs
        return res
    page = final or url
    res["pages"].append(page)
    host = urllib.parse.urlsplit(page).netloc
    acc, wid, posts, cdn, ifr = extract_sns(html, page, host)
    if not acc:
        try:
            soup = BeautifulSoup(html, "html.parser")
            hop = find_hop(soup, page)
        except Exception:
            hop = None
        if hop:
            h2, e2, f2 = get_page(hop)
            if h2:
                res["pages"].append(f2 or hop)
                a2, w2, p2, c2, i2 = extract_sns(h2, f2 or hop, host)
                for k, v in a2.items():
                    acc.setdefault(k, [])
                    acc[k] = sorted(set(acc[k]) | set(v))
                wid = sorted(set(wid) | set(w2))
                posts = sorted(set(posts) | set(p2))
                cdn = sorted(set(cdn) | set(c2))
                ifr = sorted(set(ifr) | set(i2))
    res["accounts"] = acc
    res["widgets"] = wid
    res["posts"] = posts[:50]
    res["cdn_urls"] = cdn[:60]
    res["widget_iframes"] = ifr[:10]
    return res


# ---------------------------------------------------------------- フェーズ2: 到達性検証
def resolve_widget_iframe(url):
    """#1273 【設計】SnapWidget/LightWidget の iframe を取得すると、中に投稿画像URLと
    投稿パーマリンクが直接書かれている。これは Meta API を一切通らない経路になる。"""
    html, err, final = get_page(url)
    if html is None:
        return {"ok": False, "reason": err, "url": url, "imgs": [], "posts": []}
    imgs = sorted(set(m.group(0).replace("&amp;", "&") for m in SNS_CDN_RE.finditer(html)))
    # #1273 【バグ】widget CDN 自身のホスト（cdn.snapwidget.com 等）も画像として拾う必要がある。
    for m in re.finditer(r"https?://[^\s\"'<>\\]*?(?:snapwidget|lightwidget)[^\s\"'<>\\]*?"
                         r"\.(?:jpg|jpeg|png|webp)[^\s\"'<>\\)]*", html, re.I):
        imgs.append(m.group(0).replace("&amp;", "&"))
    posts = sorted(set(m.group(0) for m in POST_RE.finditer(html)))
    return {"ok": True, "url": url, "imgs": sorted(set(imgs))[:30], "posts": posts[:30]}


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    d = json.load(open(SAMPLE))
    sample = [r["restaurant"] for r in d["results"]]
    by_id = {s["id"]: s for s in sample}
    ids = list(by_id)

    con = duckdb.connect()
    con.execute("create temp table s(id varchar)")
    con.executemany("insert into s values (?)", [(i,) for i in ids])
    rows = con.execute(
        "select s.id, o.websites, o.socials from s left join '%s' o on o.id=s.id" % PARQUET
    ).fetchall()

    # #1273 【仕様】Overture socials のプラットフォーム別ベースライン（比較の分母）。
    ov = {}
    targets = []
    for rid, ws, soc in rows:
        plats = set()
        for u in (soc or []):
            lu = u.lower()
            for p, rx in SNS_HOSTS.items():
                if p == "twitter" and ("twitter.com" in lu or "x.com" in lu):
                    plats.add(p)
                elif p in lu:
                    plats.add(p)
        ov[rid] = sorted(plats)
        if not ws:
            continue
        u = normalize(ws[0])
        dom = urllib.parse.urlsplit(u).netloc.lower()
        if dom.startswith("www."):
            dom = dom[4:]
        r = by_id[rid]
        targets.append({"id": rid, "name": r["name"], "locality": r.get("locality"),
                        "tier": r.get("tier"), "website": ws[0], "domain": dom,
                        "is_portal": bool(PORTAL_RE.search(dom))})
    targets.sort(key=lambda t: hashlib.sha256(t["id"].encode()).hexdigest())
    print("sample=600 with_website=%d" % len(targets), flush=True)

    results = []
    done = [0]
    lock = threading.Lock()

    def work(t):
        try:
            r = process(t)
        except Exception as e:
            r = dict(t, fail_reason="crash:" + type(e).__name__, accounts={}, widgets=[],
                     posts=[], cdn_urls=[], widget_iframes=[], pages=[])
        with lock:
            results.append(r)
            done[0] += 1
            if done[0] % 25 == 0:
                print("crawl %d/%d" % (done[0], len(targets)), flush=True)
        return r

    with ThreadPoolExecutor(max_workers=48) as ex:
        list(ex.map(work, targets))

    # ---- フェーズ2: ウィジェット iframe を解決して投稿画像URLを得る
    ifr_jobs = []
    for r in results:
        for u in r.get("widget_iframes", [])[:2]:
            ifr_jobs.append((r["id"], u))
    print("widget_iframes=%d" % len(ifr_jobs), flush=True)
    ifr_res = {}
    if ifr_jobs:
        with ThreadPoolExecutor(max_workers=16) as ex:
            for (rid, u), out in zip(ifr_jobs, ex.map(lambda j: resolve_widget_iframe(j[1]), ifr_jobs)):
                ifr_res.setdefault(rid, []).append(out)
    for r in results:
        r["widget_resolved"] = ifr_res.get(r["id"], [])

    # ---- フェーズ3: 画像URLの実到達検証（店舗ごとに最大3枚）
    img_jobs = []
    for r in results:
        urls = list(r.get("cdn_urls", []))
        for w in r.get("widget_resolved", []):
            urls += w.get("imgs", [])
        seen = set()
        picked = []
        for u in urls:
            if u in seen:
                continue
            seen.add(u)
            picked.append(u)
            if len(picked) >= 3:
                break
        for u in picked:
            img_jobs.append((r["id"], u))
    print("img_jobs=%d" % len(img_jobs), flush=True)
    img_res = defaultdict(list)
    if img_jobs:
        with ThreadPoolExecutor(max_workers=24) as ex:
            outs = list(ex.map(lambda j: verify_image(j[1]), img_jobs))
        for (rid, u), o in zip(img_jobs, outs):
            img_res[rid].append(o)
    for r in results:
        r["image_checks"] = img_res.get(r["id"], [])
        r["n_reached_images"] = sum(1 for c in r["image_checks"]
                                    if c.get("ok") and min(c.get("w", 0), c.get("h", 0)) >= 200)

    # ---- 集計
    n = 600
    ov_counts = Counter()
    for rid, plats in ov.items():
        for p in plats:
            ov_counts[p] += 1
    ov_any = sum(1 for p in ov.values() if p)

    site_counts = Counter()
    site_any = 0
    for r in results:
        got = [p for p, v in (r.get("accounts") or {}).items() if v]
        if got:
            site_any += 1
        for p in got:
            site_counts[p] += 1

    # 統合（Overture socials ∪ サイト抽出）
    union_counts = Counter()
    union_any = 0
    by_res = {r["id"]: r for r in results}
    for rid in ids:
        plats = set(ov.get(rid, []))
        rr = by_res.get(rid)
        if rr:
            plats |= {p for p, v in (rr.get("accounts") or {}).items() if v}
        if plats:
            union_any += 1
        for p in plats:
            union_counts[p] += 1

    widget_counts = Counter()
    for r in results:
        for w in r.get("widgets", []):
            widget_counts[w] += 1

    n_html_ok = sum(1 for r in results if not r.get("fail_reason"))
    n_with_post_url = sum(1 for r in results if r.get("posts"))
    n_with_cdn = sum(1 for r in results if r.get("cdn_urls"))
    n_reached = sum(1 for r in results if r.get("n_reached_images", 0) >= 1)
    fails = Counter(r["fail_reason"] for r in results if r.get("fail_reason"))

    out = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "slug": "site-to-sns-bridge",
        "sample_source": "out/supply_ceiling_2026-08-13.json (600 stores)",
        "sample_size": n,
        "n_with_website": len(targets),
        "n_html_ok": n_html_ok,
        "overture_socials_baseline": {"any": ov_any, "any_pct": round(100.0 * ov_any / n, 2),
                                      "per_platform": dict(ov_counts)},
        "site_extracted": {"any": site_any, "any_pct": round(100.0 * site_any / n, 2),
                           "per_platform": dict(site_counts)},
        "union": {"any": union_any, "any_pct": round(100.0 * union_any / n, 2),
                  "per_platform": dict(union_counts)},
        "instagram_lift_vs_overture": {
            "overture": ov_counts.get("instagram", 0),
            "site": site_counts.get("instagram", 0),
            "union": union_counts.get("instagram", 0),
            "multiple": round(union_counts.get("instagram", 0) / max(ov_counts.get("instagram", 0), 1), 2),
        },
        "embed_widgets": dict(widget_counts.most_common()),
        "n_store_with_post_permalink": n_with_post_url,
        "n_store_with_sns_cdn_url": n_with_cdn,
        "n_store_reached_post_image": n_reached,
        "coverage_pct_of_600_reached": round(100.0 * n_reached / n, 2),
        "fail_reasons": dict(fails.most_common()),
        "results": results,
    }
    json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in out.items() if k != "results"}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
