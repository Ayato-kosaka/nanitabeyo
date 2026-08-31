"""#1273 柱1 最適化: 店の公式サイト本文から «その店固有» の Instagram handle を抽出する。

このモジュールは 2 つの抽出器を持ち、同一の HTML に両方を当てて before→after を測る。

- extract_old(): 既存 cc_store_sites.py / 4.3 と同じ «instagram.com/handle を生バイトから拾い、
  予約語だけ弾く» ロジック。before の基準。
- extract_new(): 取りこぼしを潰した多経路抽出（<a href> / <link> / <meta> / JSON-LD sameAs /
  フッターSNSアイコン / @handle テキスト表記 / URL 変種・エスケープ）。after。

«店固有» の自動判定は目視ラベルの代わりに、標本内で 2 店以上に出る handle（＝チェーン共通・
集約メディアの一般アカウント）を落とし、単独出現かつプラットフォーム blocklist 外の handle を
store_specific とする。domain / 店名一致による裏取りは corroboration として別途記録する。

harness（`--fetch`）は proxy 経由の直接 fetch で HTML を取り（robots 尊重・低速・IG は叩かない）、
website がそのまま instagram.com の店は fetch せず website_is_ig として計上する。
"""
import concurrent.futures
import html as htmllib
import json
import os
import random
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
import urllib.robotparser

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
# robots.txt の照合に使う識別子（bot として素直に名乗る）
BOT_UA = "nanitabeyo-poc/1.0 (+https://github.com/Ayato-kosaka/nanitabeyo)"
# 実 fetch は素の bot UA を弾くサーバが多い（403 が量産される）ため、reachability を
# 正しく測る目的で一般的なブラウザ UA を使う。robots.txt は BOT_UA と "*" で尊重する。
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# instagram.com のパスで «プロフィール handle ではない» 予約セグメント
RESERVED = {
    "p", "reel", "reels", "tv", "explore", "accounts", "stories", "about",
    "developer", "developers", "legal", "directory", "direct", "sharer",
    "profile.php", "pages", "web", "graphql", "api", "oauth", "embed",
    "privacy", "terms", "help", "press", "blog", "download", "emails",
    "session", "challenge", "hashtag", "locations", "your_activity",
    "ig_me", "_u", "_n", "s",
}

# «店固有» ではない一般アカウント（集約メディア・配達・予約・大手プラットフォーム公式）。
# 標本内で単独出現でも店固有に数えないための静的 blocklist。
PLATFORM_HANDLES = {
    "tabelog", "tabelog_official", "gurunavi", "gnavi", "hotpepper",
    "hotpepper_gourmet", "hotpeppergourmet", "retty_official", "retty",
    "ubereats", "ubereats_japan", "ubereatsjp", "demaecan", "demae_can",
    "wolt", "menu_jp", "foodpanda", "instagram", "facebook", "meta",
    "explorepage", "explore", "linktree", "linktr", "google", "googlemaps",
    "gnavi_official", "ekiten", "epark", "hitosara", "toreta",
}

# «website» 自体が店の自前サイトでない（集約メディア・ブログ・SNS・地図・予約）ホスト部分文字列。
# ここに載るホストから取れた handle は corroboration 無しには store_specific にしない。
AGGREGATOR_HOST_SUBSTR = (
    "tabelog.com", "gnavi.co.jp", "gnavi.jp", "hotpepper.jp", "hitosara.com",
    "retty.me", "retty.news", "ubereats.com", "demae-can.com", "menu.jp",
    "ramendb.supleks.jp", "localplace.jp", "its-mo.com", "mypl.net",
    "loco.yahoo.co.jp", "gourmet.yahoo.co.jp", "yahoo.co.jp", "ameblo.jp",
    "exblog.jp", "hatenablog.com", "hatenablog.jp", "hateblo.jp",
    "blog.livedoor.jp", "blogspot.", "fc2.com", "tumblr.com", "jimdofree.com",
    "jimdo.com", "wixsite.com", "strikingly.com", "sites.google.com",
    "business.site", "facebook.com", "twitter.com", "x.com", "linktr.ee",
    "google.com", "google.co.jp", "naver.com", "daum.net", "kakao.com",
    "story.kakao.com", "modoo.at", "owst.jp", "toreta.in", "supleks.jp",
    "omisenomikata.jp", "on.omisenomikata.jp", "dartslive.jp", "biglobe.ne.jp",
    "ocn.ne.jp", "starcat.ne.jp", "moo.jp", "shiga-saku.net", "dip.jp",
    "hp-ez.com", "web.fc2.com", "amp", "thepicta.com", "kti114.net",
    "amatias.com", "osietesite.com", "gurutto-aizu.com", "asobube.com",
    "lineat.jp", "1dining.co.jp",
)

# instagram の URL を生テキストから拾う（href / meta / link / JSON-LD / エスケープ / 変種）。
# バックスラッシュ・エンコード %2F・www 有無・l.instagram.com のシムは normalize 側で処理。
_IG_URL = re.compile(
    r"""(?:https?:)?\\?/\\?/(?:www\.|m\.|l\.)?instagram\.com\\?/(?:_u\\?/|_n\\?/)?([A-Za-z0-9_.]{1,40})""",
    re.IGNORECASE,
)
# @handle テキスト表記（instagram / インスタ / insta / IG というキーワードの近傍のみ採る）。
_AT_NEAR_IG = re.compile(
    r"(?:instagram|insta|インスタ|ｲﾝｽﾀ|\bIG\b)[^@#\n]{0,40}?[@＠]([A-Za-z0-9_.]{3,30})",
    re.IGNORECASE,
)
# 生バイト版（old ロジック互換）
_IG_URL_BYTES = re.compile(rb"instagram\.com/([A-Za-z0-9._]{2,30})")


def normalize_handle(raw):
    """handle 候補を正規化。無効なら None。"""
    if raw is None:
        return None
    h = raw.strip().lower()
    h = h.split("?")[0].split("#")[0].split("/")[0]
    h = h.strip(".")
    if not re.fullmatch(r"[a-z0-9._]{2,30}", h):
        return None
    if h in RESERVED:
        return None
    if h.isdigit():  # fb 数値 id 等
        return None
    if "." in h and h.rsplit(".", 1)[-1] in ("com", "net", "jp", "php", "html", "js", "css", "png", "jpg"):
        return None
    return h


def extract_old(html_bytes):
    """既存 4.3 / cc_store_sites.py と同じ抽出（before の基準）。"""
    out = set()
    for m in _IG_URL_BYTES.finditer(html_bytes):
        h = m.group(1).decode("ascii", "ignore").lower()
        if h and h not in RESERVED:
            out.add(h)
    return out


def extract_new(text):
    """多経路抽出（after）。handle -> set(source tags) を返す。"""
    found = {}

    def add(h, tag):
        h = normalize_handle(h)
        if h:
            found.setdefault(h, set()).add(tag)

    # 1) instagram.com/<handle> を全体から（href / link / meta / og / JSON-LD sameAs / エスケープ / 変種）
    for m in _IG_URL.finditer(text):
        add(m.group(1), "ig_url")

    # 2) JSON-LD sameAs / og:see_also をタグとして裏取り（store 度が高い信号）
    for m in re.finditer(r'"sameAs"\s*:\s*(\[[^\]]*\]|"[^"]*")', text, re.IGNORECASE):
        blob = m.group(1)
        for u in _IG_URL.finditer(blob):
            add(u.group(1), "jsonld_sameas")

    # 3) @handle テキスト表記（instagram 近傍のみ）
    for m in _AT_NEAR_IG.finditer(text):
        add(m.group(1), "at_text")

    return found


# --- ホスト分類 ---

def host_of(url):
    try:
        p = urllib.parse.urlparse(url if "://" in url else "http://" + url)
        return p.netloc.lower().split(":")[0]
    except Exception:
        return ""


def is_aggregator_host(host):
    return any(s in host for s in AGGREGATOR_HOST_SUBSTR)


def is_instagram_host(host):
    return host.endswith("instagram.com")


def domain_token(host):
    """裏取り用: ホストの主要トークン（www / co / jp 等を除いた最長ラベル）。"""
    host = host.removeprefix("www.")
    labels = [l for l in host.split(".") if l not in ("www", "com", "co", "jp", "net", "org", "ne", "or", "info", "biz")]
    return max(labels, key=len) if labels else ""


def store_specific_handles(rec):
    """1 店の fetch 結果（process_store の出力）→ «店固有候補» handle。

    本番 4_4 と POC 測定の両方がこの 1 つの純関数を通す（判定の写経を作らない）。
    ここで落とすのは **1 店だけ見れば決まるもの** に限る:
      - PLATFORM_HANDLES（集約メディア・配達・大手公式）の blocklist
      - «website» が集約メディアの店では、店名/domain 裏取りの無い handle
    ⚠️ «複数 google_place_id に同じ handle が付く» グローバルチェーン除去は、
       1 店だけでは判定できないため **ここには入れない**（バッチ分割で全件が
       見えないため）。それは全件を読む 4_1 --source official_site_crawl 側で行う。

    返り値: {handle: {"tags": [source tag...], "corroborated": bool}}
    """
    host = rec.get("host", "") or ""
    name = rec.get("name", "") or ""
    agg = bool(rec.get("aggregator_host", False))
    out = {}
    for h, tags in (rec.get("new_handles") or {}).items():
        if h in PLATFORM_HANDLES:
            continue
        corr = corroborated(h, host, name, allow_domain=not agg)
        if agg and not corr:
            # 集約メディア上の handle は «その店» の裏取り（店名一致）が無ければ店固有としない
            continue
        out[h] = {"tags": sorted(tags) if isinstance(tags, (list, set, tuple)) else [tags],
                  "corroborated": corr}
    return out


def corroborated(handle, host, name, allow_domain=True):
    """handle がその店に紐づく «裏取り» があるか（domain トークン一致 / 店名英字一致）。

    allow_domain=False（集約メディア上）では domain 一致は «その媒体自身の公式アカウント»
    を拾ってしまうため使わず、店名一致だけを裏取りとする。
    """
    hclean = handle.replace("_", "").replace(".", "")
    if allow_domain:
        dt = domain_token(host)
        if dt and len(dt) >= 4 and (dt in hclean or hclean in dt):
            return True
    name_ascii = re.sub(r"[^a-z0-9]", "", (name or "").lower())
    if len(name_ascii) >= 4 and (name_ascii in hclean or hclean in name_ascii):
        return True
    return False


# --- fetch harness ---

_robots_cache = {}
_robots_lock = threading.Lock()


def robots_allows(url):
    host = host_of(url)
    scheme = "https" if url.startswith("https") else "http"
    with _robots_lock:
        rp = _robots_cache.get(host, "pending")
    if rp == "pending":
        rp = urllib.robotparser.RobotFileParser()
        try:
            req = urllib.request.Request(f"{scheme}://{host}/robots.txt", headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=15) as r:
                lines = r.read().decode("utf-8", "replace").splitlines()
            rp.parse(lines)
        except Exception:
            rp = None  # robots 取得不可 → 既定で許可
        with _robots_lock:
            _robots_cache[host] = rp
    if rp is None:
        return True
    try:
        # "*" が禁止しているパスは尊重する（bot 名でも同様）
        return rp.can_fetch("*", url) and rp.can_fetch(BOT_UA, url)
    except Exception:
        return True


def fetch(url, timeout=20):
    last = None
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept-Language": "ja,en;q=0.8",
            })
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read(3_000_000)
            return raw, None
        except Exception as e:
            last = f"{type(e).__name__}: {e}"
            time.sleep(1.5 * (attempt + 1))
    return None, last


def process_store(store):
    url = (store.get("website") or "").strip()
    rec = {"id": store["id"], "name": store["name"], "website": url}
    if not url:
        rec["status"] = "no_website"
        return rec
    if "://" not in url:
        url = "http://" + url
    host = host_of(url)
    rec["host"] = host

    # website がそのまま instagram.com → fetch 不要
    if is_instagram_host(host):
        p = urllib.parse.urlparse(url)
        h = normalize_handle(p.path.strip("/").split("/")[0])
        rec["status"] = "website_is_ig"
        rec["website_is_ig"] = True
        rec["old_handles"] = [h] if h else []
        rec["new_handles"] = {h: ["website_is_ig"]} if h else {}
        rec["aggregator_host"] = False
        return rec

    rec["aggregator_host"] = is_aggregator_host(host)

    if not robots_allows(url):
        rec["status"] = "robots_blocked"
        rec["old_handles"] = []
        rec["new_handles"] = {}
        return rec

    time.sleep(random.uniform(0.2, 0.8))  # 低速化
    raw, err = fetch(url)
    if raw is None:
        # スキーム+ホストのルートで再挑戦
        root = f"{'https' if url.startswith('https') else 'http'}://{host}/"
        if root != url:
            raw, err2 = fetch(root)
            err = err if raw is not None else f"{err} | root:{err2}"
    if raw is None:
        rec["status"] = "fetch_failed"
        rec["error"] = err
        rec["old_handles"] = []
        rec["new_handles"] = {}
        return rec

    rec["status"] = "ok"
    rec["bytes"] = len(raw)
    text = raw.decode("utf-8", "replace")
    text = htmllib.unescape(text)
    old = extract_old(raw)
    new = extract_new(text)
    rec["old_handles"] = sorted(old)
    rec["new_handles"] = {h: sorted(t) for h, t in new.items()}
    return rec


def run_fetch(sample_path, out_path, workers=8, limit=None):
    stores = json.load(open(sample_path))
    if limit:
        stores = stores[:limit]
    results = []
    done = 0
    lock = threading.Lock()
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(process_store, s): s for s in stores}
        for fut in concurrent.futures.as_completed(futs):
            rec = fut.result()
            with lock:
                results.append(rec)
                done += 1
                if done % 20 == 0:
                    print(f"  {done}/{len(stores)} done", flush=True)
    results.sort(key=lambda r: stores.index(next(s for s in stores if s["id"] == r["id"])))
    json.dump(results, open(out_path, "w"), ensure_ascii=False, indent=1)
    print(f"saved {len(results)} -> {out_path}", flush=True)
    return results


# --- measurement ---

def measure(results):
    n = len(results)

    # 各 arm の handle 出現店数（チェーン共通判定用）
    old_freq, new_freq = {}, {}
    for r in results:
        for h in set(r.get("old_handles", [])):
            old_freq[h] = old_freq.get(h, 0) + 1
        for h in set((r.get("new_handles") or {}).keys()):
            new_freq[h] = new_freq.get(h, 0) + 1

    def store_specific_set(r, handles, freq):
        host = r.get("host", "")
        name = r.get("name", "")
        agg = r.get("aggregator_host", False)
        out = set()
        for h in handles:
            if h in PLATFORM_HANDLES:
                continue
            if freq.get(h, 0) >= 2:   # 標本内で複数店に出る = チェーン共通/一般アカウント
                continue
            if agg and not corroborated(h, host, name, allow_domain=False):
                continue  # 集約メディア上の handle は «店名» 裏取りが無ければ店固有としない
            out.add(h)
        return out

    old_union = old_ss = new_union = new_ss = 0
    old_handles_all, new_handles_all = set(), set()
    for r in results:
        oh = set(r.get("old_handles", []))
        nh = set((r.get("new_handles") or {}).keys())
        if r.get("website_is_ig"):
            oh |= set(r.get("old_handles", []))
        if oh:
            old_union += 1
        if nh:
            new_union += 1
        if store_specific_set(r, oh, old_freq):
            old_ss += 1
        if store_specific_set(r, nh, new_freq):
            new_ss += 1
        old_handles_all |= oh
        new_handles_all |= nh

    # 追加内訳: strict（全件で domain/店名の裏取りを必須）/ own vs aggregator / 経路タグ / チェーン
    from collections import Counter
    src_tags = Counter()
    at_text_net_new = 0
    own_union = own_ss = agg_union = agg_ss = new_ss_strict = 0
    for r in results:
        nh = r.get("new_handles") or {}
        for h, tags in nh.items():
            for t in tags:
                src_tags[t] += 1
        oh = set(r.get("old_handles", []))
        only_at = {h for h, t in nh.items() if set(t) == {"at_text"}}
        if only_at and not (set(nh) - only_at) and not oh:
            at_text_net_new += 1
        nk = set(nh.keys())
        agg = r.get("aggregator_host", False)
        s = store_specific_set(r, nk, new_freq)
        # strict: 集約でなくても domain/店名裏取りを必須にする
        sstrict = {h for h in s if corroborated(h, r.get("host", ""), r.get("name", ""),
                                                allow_domain=not agg)}
        if sstrict:
            new_ss_strict += 1
        if agg:
            if nk:
                agg_union += 1
            if s:
                agg_ss += 1
        else:
            if nk:
                own_union += 1
            if s:
                own_ss += 1

    chains = {h: c for h, c in new_freq.items() if c >= 2}
    website_is_ig = sum(1 for r in results if r.get("website_is_ig"))
    reachable = sum(1 for r in results if r.get("status") in ("ok", "website_is_ig"))
    return {
        "n_sample": n,
        "fetch_ok": sum(1 for r in results if r.get("status") == "ok"),
        "website_is_ig": website_is_ig,
        "fetch_failed": sum(1 for r in results if r.get("status") == "fetch_failed"),
        "robots_blocked": sum(1 for r in results if r.get("status") == "robots_blocked"),
        "reachable": reachable,
        "unreachable_pct": round(100 * (n - reachable) / n, 2),
        "aggregator_hosts": sum(1 for r in results if r.get("aggregator_host")),
        "new_handle_source_tags": dict(src_tags),
        "at_text_net_new_stores": at_text_net_new,
        "chain_handles_ge2_stores": dict(sorted(chains.items(), key=lambda x: -x[1])),
        # 同一 HTML A/B: 抽出ロジックの before(old byte-regex) → after(multi-source)
        "before_old": {
            "union": old_union, "union_pct": round(100 * old_union / n, 2),
            "store_specific": old_ss, "store_specific_pct": round(100 * old_ss / n, 2),
            "distinct_handles": len(old_handles_all),
        },
        "after_new": {
            "union": new_union, "union_pct": round(100 * new_union / n, 2),
            "store_specific": new_ss, "store_specific_pct": round(100 * new_ss / n, 2),
            "store_specific_strict": new_ss_strict,
            "store_specific_strict_pct": round(100 * new_ss_strict / n, 2),
            "distinct_handles": len(new_handles_all),
        },
        "own_site": {"fetched": sum(1 for r in results if not r.get("aggregator_host") and r.get("status") in ("ok", "website_is_ig")),
                     "union": own_union, "store_specific": own_ss},
        "aggregator_site": {"union": agg_union, "store_specific": agg_ss},
    }


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--fetch":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else None
        res = run_fetch(f"{OUT}/pillar1_sample_stores.json", f"{OUT}/pillar1_site_extract.json",
                        workers=8, limit=limit)
        summ = measure(res)
        json.dump(summ, open(f"{OUT}/pillar1_measure.json", "w"), ensure_ascii=False, indent=2)
        print(json.dumps(summ, ensure_ascii=False, indent=2))
    elif len(sys.argv) > 1 and sys.argv[1] == "--measure":
        res = json.load(open(f"{OUT}/pillar1_site_extract.json"))
        summ = measure(res)
        json.dump(summ, open(f"{OUT}/pillar1_measure.json", "w"), ensure_ascii=False, indent=2)
        print(json.dumps(summ, ensure_ascii=False, indent=2))
