#!/usr/bin/env python3
# #1273 【設計】アイデアD「店舗公式サイトから料理画像を抽出する」の実測スクリプト。
# #1273 【仕様】カバレッジは必ず out/supply_ceiling_2026-08-13.json の同じ600店で測る。
#             他ソース（YouTube等）との重複を取るため、母集団を絶対に変えない。
# #1273 【仕様】相手サーバへの配慮: robots.txt を必ず尊重し、1ホスト同時1接続・1秒以上間隔。
#             User-Agent は正直に名乗る。画像バイナリは永続保存しない（メタデータのみ）。

import json
import io
import os
import re
import sys
import time
import hashlib
import threading
import urllib.parse
import urllib.request
import urllib.robotparser
from concurrent.futures import ThreadPoolExecutor
from collections import defaultdict

from bs4 import BeautifulSoup
from PIL import Image
import duckdb

BASE = os.path.dirname(os.path.abspath(__file__))
SAMPLE = os.path.join(BASE, "out", "supply_ceiling_2026-08-13.json")
PARQUET = "/tmp/overture-jp.parquet"
OUT = os.path.join(BASE, "out", "own-website-images.json")

UA = "nanitabeyo-research/0.1 (restaurant dish-image feasibility PoC; contact: sharess117@gmail.com)"
TIMEOUT = 10
HTML_MAX = 1_500_000
IMG_MAX = 600_000

# #1273 【仕様】ポータル・SNS・予約サイトのドメイン。ここは「自社サイト」ではないので別集計する。
PORTAL_RE = re.compile(
    r"(tabelog|gnavi|hotpepper|recruit|instagram|twitter|x\.com|facebook|ameblo|"
    r"goo\.ne\.jp|jimdo|wixsite|ubereats|demae-can|retty|ikyu|ozmall|epark|"
    r"toreta|tablecheck|gorp\.jp|owst\.jp|food96\.com|favy\.jp|r\.gnavi|"
    r"line\.me|youtube|tiktok|note\.com|hitosara|yahoo\.co\.jp|google\.)",
    re.I,
)

# #1273 【仕様】ロゴ・アイコン・装飾画像を落とすためのURL/クラス由来の否定パターン。
NEG_RE = re.compile(
    r"(logo|icon|favicon|sprite|banner|btn|button|arrow|bg[_-]|_bg\.|header|footer|"
    r"nav[_-]|sns|share|qr|map|access|line[_-]|blank|spacer|dummy|loading|"
    r"placeholder|badge|ribbon|title[_-]|ttl[_-]|h1[_-]|copyright)",
    re.I,
)
# #1273 【仕様】料理画像とみなす最小辺(px)。当初 300 だったが、目視検証で下げた。
#
# 300 で落ちていた「食語を持つ」画像 28枚(11店)から SHA-256 順に決定的抽出して
# 12枚を実ダウンロードし目視分類した結果:
#     TP 6 / 境界 2 / FP 4 → 厳密 precision 50.0%
# これは現行パイプライン全体の目視 precision 46.7% より**高い**ので、
# 200 まで下げても品質は落ちない。600店標本での実質増分は +0.92pt
# (自社サイト経路 7.16% -> 8.08%)。根拠: out/dimgate_visual_labels.json
#
# 【注意】food_word ゲートのほうは外してはいけない。外すと名目 +4.33pt だが、
# そちらの層の目視 precision は 7.1% で、映画『ショーシャンクの空に』のポスターや
# 医療クリニックのバスが混入する。実質増分は +0.31pt しかない。
# 根拠: out/nofoodword_visual_labels.json
MIN_DISH_IMAGE_PX = 200

# #1273 【仕様】料理を示す語（URL・alt・周辺テキスト）。日本語/英語の両方を見る。
FOOD_RE = re.compile(
    r"(料理|メニュー|menu|dish|food|cuisine|コース|course|ランチ|lunch|ディナー|dinner|"
    r"御膳|定食|丼|寿司|鮨|刺身|そば|蕎麦|うどん|ラーメン|らーめん|焼肉|焼鳥|天ぷら|"
    r"ケーキ|パン|パスタ|ピザ|カレー|お造り|前菜|一品|逸品|盛り|鍋|串|弁当|甘味|"
    r"デザート|dessert|drink|ドリンク|酒|ビール|cake|bread|sushi|ramen|yakiniku|"
    r"gohan|osusume|おすすめ|名物|自慢|品書|献立|食事|グラタン|カツ|唐揚|天丼|"
    r"steak|ステーキ|salad|サラダ|soup|スープ|coffee|珈琲|cafe)",
    re.I,
)
# #1273 【仕様】メニューページへの1ホップ用リンクパターン。
MENULINK_RE = re.compile(r"(menu|food|dish|cuisine|料理|メニュー|品書|献立|おしながき|お品書き)", re.I)

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
    """#1273 【バグ】巨大ファイルでメモリを食わないよう read(maxbytes) で必ず打ち切る。"""
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": accept,
        "Accept-Language": "ja,en;q=0.8",
    })
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.status, dict(r.headers), r.read(maxbytes), r.geturl()


def classify_error(e):
    """#1273 【仕様】取得できない理由を分類して数える（404/DNS/SSL/timeout/robots など）。"""
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
        if "Name or service not known" in str(r) or "nodename" in str(r) or "getaddrinfo" in str(r):
            return "dns"
        if "Connection refused" in str(r) or "refused" in str(r):
            return "conn_refused"
        return "urlerror"
    if isinstance(e, TimeoutError):
        return "timeout"
    return "other:" + type(e).__name__


_robots_cache = {}
_robots_lock = threading.Lock()


def robots_allows(url):
    """#1273 【仕様】robots.txt を取得して Disallow のパスは取得しない。取れなければ許可扱い。"""
    p = urllib.parse.urlsplit(url)
    key = (p.scheme, p.netloc)
    with _robots_lock:
        hit = _robots_cache.get(key)
    if hit is None:
        rp = urllib.robotparser.RobotFileParser()
        # #1273 【バグ】この実行環境は平文HTTP(:80)が透過プロキシに403で塞がれている。
        #             robots.txt は常に https で取りに行く（環境要因の取得失敗を避ける）。
        rurl = "https://%s/robots.txt" % p.netloc
        lk = host_gate(p.netloc)
        try:
            st, hd, body, _ = fetch(rurl, 200_000, "text/plain")
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
    """#1273 【仕様】HTMLを1ページ取得。robots→間隔制御→取得の順。"""
    p = urllib.parse.urlsplit(url)
    if not robots_allows(url):
        return None, "robots_disallow", None
    lk = host_gate(p.netloc)
    try:
        st, hd, body, final = fetch(url, HTML_MAX, "text/html,application/xhtml+xml")
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


def extract_candidates(html, page_url):
    """#1273 【設計】img / og:image / JSON-LD(image, Recipe, Menu, ImageObject) から画像候補を抽出。
    #1273 【仕様】否定パターン（logo/icon 等）を落とし、料理語のヒットでスコアを付ける。"""
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
        cur = cands.get(u)
        rec = cur or {"url": u, "alt": "", "context": "", "origins": []}
        if alt and len(alt) > len(rec["alt"]):
            rec["alt"] = alt[:200]
        if ctx and len(ctx) > len(rec["context"]):
            rec["context"] = ctx[:200]
        if origin not in rec["origins"]:
            rec["origins"].append(origin)
        cands[u] = rec

    # og:image / twitter:image
    for m in soup.find_all("meta"):
        prop = (m.get("property") or m.get("name") or "").lower()
        if prop in ("og:image", "og:image:url", "twitter:image", "twitter:image:src"):
            add(m.get("content"), "", (soup.title.get_text() if soup.title else ""), "og")

    # JSON-LD
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
                            add(v.get("url") or v.get("contentUrl"), v.get("caption", "") or n.get("name", "") or "", t, "jsonld:" + (t or "?"))
                        elif isinstance(v, list):
                            for it in v:
                                if isinstance(it, str):
                                    add(it, n.get("name", "") or "", t, "jsonld:" + (t or "?"))
                                elif isinstance(it, dict):
                                    add(it.get("url") or it.get("contentUrl"), it.get("caption", "") or "", t, "jsonld:" + (t or "?"))
                    elif isinstance(v, (dict, list)):
                        stack.append(v)

    # img タグ（lazy-load 属性も見る）
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
        # #1273 【設計】スコア: 料理語ヒット +2 / 料理ページ由来 +1 / 否定語 -3
        rec["score"] = (2 if food else 0) + (1 if page_food else 0) + (-3 if neg else 0)
        out.append(rec)
    out.sort(key=lambda r: -r["score"])
    return out, soup


def find_menu_link(soup, page_url):
    """#1273 【設計】トップページから料理/メニューページへ1ホップだけ辿る（同一ホストのみ）。"""
    base_host = urllib.parse.urlsplit(page_url).netloc
    best = None
    for a in soup.find_all("a", href=True):
        href = a["href"]
        txt = a.get_text(" ", strip=True)
        u = urllib.parse.urljoin(page_url, href)
        if not u.startswith("http"):
            continue
        if urllib.parse.urlsplit(u).netloc != base_host:
            continue
        if u.rstrip("/") == page_url.rstrip("/"):
            continue
        if MENULINK_RE.search(href) or MENULINK_RE.search(txt):
            if best is None:
                best = u
            if MENULINK_RE.search(txt):
                return u
    return best


def verify_image(url):
    """#1273 【仕様】画像を実際に取得して content-type と実ピクセルサイズを確認する。
    #1273 【設計】バイナリは保存しない。メモリ上で寸法だけ読み、破棄する。"""
    # #1273 【バグ】画像URLが http:// のときも環境の :80 遮断に当たるので https に上げる。
    if url.startswith("http://"):
        url = "https://" + url[len("http://"):]
    p = urllib.parse.urlsplit(url)
    if not robots_allows(url):
        return {"ok": False, "reason": "robots_disallow"}
    lk = host_gate(p.netloc)
    try:
        st, hd, body, final = fetch(url, IMG_MAX, "image/*")
        ct = hd.get("Content-Type", "")
        if "image" not in ct.lower():
            return {"ok": False, "reason": "not_image", "content_type": ct}
        try:
            im = Image.open(io.BytesIO(body))
            w, h = im.size
        except Exception:
            return {"ok": False, "reason": "undecodable", "content_type": ct, "bytes": len(body)}
        return {"ok": True, "content_type": ct, "bytes": len(body), "w": w, "h": h}
    except Exception as e:
        return {"ok": False, "reason": classify_error(e)}
    finally:
        host_release(p.netloc, lk)


def normalize(u):
    u = u.strip()
    if not u.startswith("http"):
        u = "http://" + u
    return u


def process(rec):
    """#1273 【設計】1店舗ぶんの処理: トップ取得 → メニュー1ホップ → 候補抽出 → 上位を実取得検証。"""
    res = {
        "id": rec["id"], "name": rec["name"], "locality": rec["locality"],
        "tier": rec["tier"], "website": rec["website"], "domain": rec["domain"],
        "is_portal": rec["is_portal"], "pages": [], "fail_reason": None,
        "candidates": [], "verified": [], "n_verified_dish": 0,
    }
    url = normalize(rec["website"])
    # #1273 【バグ】平文HTTPは実行環境の透過プロキシが403を返すため、http:// は必ず https:// を先に試す。
    #             それでも駄目なときだけ元の http:// を試し、403なら env_http_blocked として分類する。
    tries = [url]
    if url.startswith("http://"):
        tries = ["https://" + url[len("http://"):], url]
    html = err = final = None
    errs = []
    for t in tries:
        html, e1, final = get_page(t)
        errs.append(e1)
        if html is not None:
            err = None
            break
    if html is None:
        # #1273 【バグ】最初(https)の失敗理由を主因として残す。以前は最後(http)の403で
        #             上書きしてしまい、原因分類が「環境の:80遮断」に偏っていた。
        err = errs[0]
        if len(errs) > 1 and errs[1] == "http_403":
            # https も駄目で http が403 = この実行環境の平文HTTP遮断で判定不能
            err = "env_http80_blocked(https_err=%s)" % errs[0]
        res["fail_reason"] = err
        res["attempt_errors"] = errs
        return res
    res["pages"].append(final or url)
    cands, soup = extract_candidates(html, final or url)

    # #1273 【設計】トップに料理語ヒットが少ないときだけメニューページを1ホップ辿る（負荷抑制）。
    if len([c for c in cands if c["score"] >= 2]) < 4:
        mlink = find_menu_link(soup, final or url)
        if mlink:
            h2, e2, f2 = get_page(mlink)
            if h2:
                res["pages"].append(f2 or mlink)
                c2, _ = extract_candidates(h2, f2 or mlink)
                seen = {c["url"] for c in cands}
                cands += [c for c in c2 if c["url"] not in seen]
            else:
                res["menu_fail"] = e2

    # #1273 【バグ】JSが必須のページはimgが0件になる。これを js_required として分類する。
    if not cands:
        low = html.lower()
        if "<noscript" in low or "__next" in low or "ng-app" in low or low.count("<img") == 0:
            res["fail_reason"] = "js_required_or_no_img"
        else:
            res["fail_reason"] = "no_image_tag"
        return res

    cands.sort(key=lambda r: -r["score"])
    res["candidates"] = cands[:40]

    # #1273 【パフォーマンス】検証の実取得は上位5枚まで。相手サーバへの負荷を抑える。
    for c in cands[:5]:
        if c["score"] < 0:
            continue
        v = verify_image(c["url"])
        v["url"] = c["url"]
        v["alt"] = c["alt"]
        v["context"] = c["context"]
        v["score"] = c["score"]
        v["food_word"] = c["food_word"]
        res["verified"].append(v)
        # #1273 【仕様】「料理画像」判定: 実取得成功 かつ MIN_DISH_IMAGE_PX 以上 かつ 料理語ヒット
        if (
            v.get("ok")
            and min(v.get("w", 0), v.get("h", 0)) >= MIN_DISH_IMAGE_PX
            and c["food_word"]
        ):
            res["n_verified_dish"] += 1
    return res


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    d = json.load(open(SAMPLE))
    sample = [r["restaurant"] for r in d["results"]]
    ids = [s["id"] for s in sample]
    by_id = {s["id"]: s for s in sample}

    con = duckdb.connect()
    con.execute("create temp table s(id varchar)")
    con.executemany("insert into s values (?)", [(i,) for i in ids])
    rows = con.execute(
        "select s.id, o.websites from s left join '%s' o on o.id=s.id" % PARQUET
    ).fetchall()

    targets = []
    for rid, ws in rows:
        if not ws:
            continue
        u = normalize(ws[0])
        dom = urllib.parse.urlsplit(u).netloc.lower().lstrip("www.")
        r = by_id[rid]
        targets.append({
            "id": rid, "name": r["name"], "locality": r.get("locality"),
            "tier": r.get("tier"), "website": ws[0], "domain": dom,
            "is_portal": bool(PORTAL_RE.search(dom)),
        })

    # #1273 【仕様】部分集合を取る場合は SHA-256(id) 昇順の先頭N件で決定的にする。
    targets.sort(key=lambda t: hashlib.sha256(t["id"].encode()).hexdigest())
    if limit:
        targets = targets[:limit]

    # #1273 【設計】retryモード: 既存 out/own-website-images.json のうち失敗した店だけ再実行し、
    #             成功分は据え置いてマージする（全件やり直すと相手サーバに無駄な負荷をかける）。
    prev = {}
    if os.environ.get("RETRY_FAILED") == "1" and os.path.exists(OUT):
        old = json.load(open(OUT))
        prev = {r["id"]: r for r in old["results"]}
        keep = [r for r in old["results"] if not r.get("fail_reason")]
        targets = [t for t in targets if prev.get(t["id"], {}).get("fail_reason")]
        print("retry mode: keep=%d retry=%d" % (len(keep), len(targets)), flush=True)

    print("sample=600 with_website=%d" % len(targets), flush=True)
    results = []
    done = [0]
    lock = threading.Lock()

    def work(t):
        try:
            r = process(t)
        except Exception as e:
            r = {"id": t["id"], "name": t["name"], "website": t["website"],
                 "domain": t["domain"], "is_portal": t["is_portal"],
                 "fail_reason": "crash:" + type(e).__name__, "candidates": [],
                 "verified": [], "n_verified_dish": 0}
        with lock:
            results.append(r)
            done[0] += 1
            if done[0] % 20 == 0:
                print("progress %d/%d" % (done[0], len(targets)), flush=True)
        return r

    with ThreadPoolExecutor(max_workers=48) as ex:
        list(ex.map(work, targets))

    if prev:
        got = {r["id"] for r in results}
        results += [r for r in prev.values() if r["id"] not in got]

    n_cov = sum(1 for r in results if r["n_verified_dish"] >= 1)
    fails = defaultdict(int)
    for r in results:
        if r.get("fail_reason"):
            fails[r["fail_reason"]] += 1
    own = [r for r in results if not r["is_portal"]]
    n_cov_own = sum(1 for r in own if r["n_verified_dish"] >= 1)

    out = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "slug": "own-website-images",
        "sample_source": "out/supply_ceiling_2026-08-13.json (600 stores)",
        "sample_size": 600,
        "n_with_website": len(targets),
        "n_evaluated": len(results),
        "n_own_domain": len(own),
        "n_portal_domain": len(results) - len(own),
        "n_store_with_verified_dish_image": n_cov,
        "coverage_pct_of_600": round(100.0 * n_cov / 600, 2),
        "coverage_pct_of_with_website": round(100.0 * n_cov / max(len(targets), 1), 2),
        "n_own_domain_with_dish_image": n_cov_own,
        "fail_reasons": dict(sorted(fails.items(), key=lambda kv: -kv[1])),
        "dish_images_per_covered_store_top5cap": round(
            sum(r["n_verified_dish"] for r in results) / max(n_cov, 1), 2),
        "results": results,
    }
    json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in out.items() if k != "results"},
                     ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
