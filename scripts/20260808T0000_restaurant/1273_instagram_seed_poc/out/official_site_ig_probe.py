#!/usr/bin/env python3
"""公式サイトに Instagram リンクが実際に載っている割合を curl 実測する。

対象: FSQ が instagram_handle 無しと判定した店 (fsq_jp_no_instagram_sample.csv) を優先し、
補助的に fsq_jp_with_website_sample.csv を足して website を持つ 150 件を標本にする。

各 website をブラウザ相当 UA で curl -L 取得し、HTML から Instagram を検出する。
linktree 等のリンク集に飛んでいたら 1 段だけ辿って再探索する。

推測で埋めない: 数字はすべて curl の実挙動から数える。
"""
import csv
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

# instagram の予約パス / 機能パス。handle として採用しない。
IG_RESERVED = {
    "p", "reel", "reels", "explore", "stories", "story", "tv", "accounts",
    "about", "developer", "developers", "legal", "directory", "web", "api",
    "graphql", "oauth", "emails", "session", "challenge", "privacy", "terms",
    "help", "press", "ads", "business", "creators", "shop", "s", "invites",
    "download", "your_activity", "direct", "sharer", "embed", "login",
    "signup", "hashtag", "static", "images", "public",
}

# リンク集 (aggregator) ドメイン。1 段だけ辿る。
AGGREGATOR_HOSTS = (
    "linktr.ee", "lit.link", "linkstep.jp", "potofu.me", "profchan.com",
    "linky.jp", "profu.link", "myprof.jp", "linkkun.com", "pomme.link",
    "linktree.com", "campsite.bio", "beacons.ai", "tap.bio", "linkpop.com",
    "url.rest", "lnk.bio", "bio.link", "linqapp.com", "koeru.link",
)

IG_HOST_RE = re.compile(
    r"(?:https?:)?//(?:www\.)?instagram\.com/([^\s\"'?#/<>)\\]+)", re.I)
# @handle 形式 (テキスト中の Instagram: @xxx 併記) は誤検出が多いので採らない。


def norm_url(u: str) -> str:
    u = (u or "").strip()
    if not u:
        return ""
    if not re.match(r"^https?://", u, re.I):
        u = "http://" + u
    return u


def fetch(url: str, timeout: int = 15):
    """curl -L でトップページ HTML を取得。(html, http_code, effective_url, err)。"""
    try:
        p = subprocess.run(
            ["curl", "-sSL", "--max-time", str(timeout), "--compressed",
             "-A", UA, "-w", "\n__META__ %{http_code} %{url_effective}", url],
            capture_output=True, timeout=timeout + 5,
        )
        out = p.stdout.decode("utf-8", "replace")
        code, eff = "0", url
        marker = out.rfind("\n__META__ ")
        if marker != -1:
            meta = out[marker + len("\n__META__ "):].strip().split(" ", 1)
            out = out[:marker]
            code = meta[0] if meta else "0"
            eff = meta[1] if len(meta) > 1 else url
        err = ""
        if p.returncode != 0:
            err = p.stderr.decode("utf-8", "replace").strip()[:200] or f"rc={p.returncode}"
        return out, code, eff, err
    except subprocess.TimeoutExpired:
        return "", "0", url, "timeout"
    except Exception as e:  # noqa
        return "", "0", url, str(e)[:200]


ASSET_EXT = (".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg",
             ".ico", ".php", ".html", ".htm", ".json", ".xml", ".webp")


def valid_handle(h: str):
    h = h.strip().strip("/")
    # クエリや余分を除去
    h = h.split("?")[0].split("#")[0].split("/")[0]
    h = h.strip().lower()
    if not h:
        return None
    if h in IG_RESERVED:
        return None
    # embed.js 等のアセットファイル名は handle ではない
    if h.endswith(ASSET_EXT):
        return None
    if not re.match(r"^[a-z0-9_.]{1,30}$", h):
        return None
    if h.replace("_", "").replace(".", "") == "":
        return None
    # 英字を 1 文字も含まない (数字だけ) は handle ではない
    if not re.search(r"[a-z]", h):
        return None
    return h


def find_ig_handles(html: str):
    handles = []
    for m in IG_HOST_RE.finditer(html or ""):
        h = valid_handle(m.group(1))
        if h and h not in handles:
            handles.append(h)
    return handles


def find_ig_signals(html: str):
    """handle は取れないが Instagram が «載っている» 証拠。
    embed ウィジェット (embed.js) や 個別投稿/リール への直リンク。"""
    low = (html or "").lower()
    embed = "instagram.com/embed.js" in low or "instgrm.embeds" in low \
        or 'class="instagram-media"' in low
    post = bool(re.search(
        r"instagram\.com/(?:p|reel|reels|tv)/[A-Za-z0-9_-]+", html or "", re.I))
    return embed, post


def find_aggregator_links(html: str):
    links = []
    for host in AGGREGATOR_HOSTS:
        for m in re.finditer(
            r"(?:https?:)?//(?:www\.)?" + re.escape(host) + r"/[^\s\"'<>)\\]*",
            html or "", re.I,
        ):
            u = m.group(0)
            if u.startswith("//"):
                u = "https:" + u
            if u not in links:
                links.append(u)
    return links[:2]


def probe(store):
    name = store.get("name", "")
    url = norm_url(store.get("website", ""))
    rec = {
        "store": name, "website": url, "source": store.get("_source", ""),
        "http_code": None, "effective_url": None, "fetched": False,
        "found_handle": None, "handles": [], "via_linktree": False,
        "aggregator_url": None, "js_suspect": False, "error": None,
        "ig_embed": False, "ig_post_link": False, "ig_present": False,
    }
    if not url:
        rec["error"] = "no_website"
        return rec
    html, code, eff, err = fetch(url)
    rec["http_code"] = code
    rec["effective_url"] = eff
    if err and not html:
        rec["error"] = err
        return rec
    rec["fetched"] = bool(html)
    if not html:
        rec["error"] = err or "empty_body"
        return rec

    embed, post = find_ig_signals(html)
    rec["ig_embed"] = embed
    rec["ig_post_link"] = post

    handles = find_ig_handles(html)
    if handles:
        rec["handles"] = handles
        rec["found_handle"] = handles[0]
        rec["ig_present"] = True
        return rec

    # リンク集を 1 段辿る
    aggs = find_aggregator_links(html)
    for agg in aggs:
        ahtml, acode, aeff, aerr = fetch(agg)
        if ahtml:
            ah = find_ig_handles(ahtml)
            if ah:
                rec["handles"] = ah
                rec["found_handle"] = ah[0]
                rec["via_linktree"] = True
                rec["aggregator_url"] = agg
                rec["ig_present"] = True
                return rec

    # handle は取れないが embed / 投稿リンクがあれば IG は «載っている»
    if embed or post:
        rec["ig_present"] = True
        return rec

    # IG 見つからず。JS レンダリング疑い判定:
    # HTML が薄い / SPA マウント点だけ / instagram 文字列が script 内にしか無い
    low = html.lower()
    text_len = len(re.sub(r"<[^>]+>", "", html))
    spa = bool(re.search(r'id=["\'](root|app|__next|__nuxt)["\']', html, re.I))
    mentions_ig = "instagram" in low
    if (text_len < 800 or spa) and mentions_ig:
        rec["js_suspect"] = True
    elif spa and text_len < 500:
        rec["js_suspect"] = True
    return rec


def load_sample(limit=150):
    seen = set()
    sample = []
    # 優先: no_instagram (FSQ が IG 無しと判定した店)
    order = [
        ("fsq_jp_no_instagram_sample.csv", "no_instagram"),
        ("fsq_jp_with_website_sample.csv", "with_website"),
    ]
    for fname, src in order:
        path = os.path.join(HERE, fname)
        if not os.path.exists(path):
            continue
        for r in csv.DictReader(open(path)):
            w = norm_url(r.get("website", ""))
            if not w:
                continue
            key = re.sub(r"^https?://(www\.)?", "", w.lower()).rstrip("/")
            if key in seen:
                continue
            seen.add(key)
            r["_source"] = src
            sample.append(r)
            if len(sample) >= limit:
                return sample
    return sample


def main():
    sample = load_sample(150)
    print(f"sampled {len(sample)} stores with website "
          f"(no_instagram優先)", file=sys.stderr)
    results = []
    with ThreadPoolExecutor(max_workers=12) as ex:
        futs = {ex.submit(probe, s): s for s in sample}
        done = 0
        for fut in as_completed(futs):
            results.append(fut.result())
            done += 1
            if done % 20 == 0:
                print(f"  ...{done}/{len(sample)}", file=sys.stderr)

    n_sampled = len(sample)
    n_fetched = sum(1 for r in results if r["fetched"])
    n_handle = sum(1 for r in results if r["found_handle"])   # 抽出可能な handle
    n_present = sum(1 for r in results if r["ig_present"])     # IG が載っている
    n_via_lt = sum(1 for r in results if r["via_linktree"])
    n_embed_only = sum(1 for r in results
                       if r["ig_present"] and not r["found_handle"])
    n_js = sum(1 for r in results if r["js_suspect"] and not r["ig_present"])
    n_err = sum(1 for r in results if not r["fetched"])

    # no_instagram サブセット (本命の分母)
    ni = [r for r in results if r["source"] == "no_instagram"]
    ni_fetched = sum(1 for r in ni if r["fetched"])
    ni_present = sum(1 for r in ni if r["ig_present"])

    ig_rate = (n_present / n_fetched) if n_fetched else 0.0       # 掲載率
    handle_rate = (n_handle / n_fetched) if n_fetched else 0.0    # handle 抽出率
    ni_rate = (ni_present / ni_fetched) if ni_fetched else 0.0

    out = {
        "n_sampled": n_sampled,
        "n_fetched": n_fetched,
        "n_fetch_failed": n_err,
        "n_with_ig": n_present,
        "n_with_clean_handle": n_handle,
        "n_ig_present_no_handle": n_embed_only,
        "ig_rate": round(ig_rate, 4),
        "ig_rate_pct": round(ig_rate * 100, 1),
        "handle_extract_rate_pct": round(handle_rate * 100, 1),
        "n_via_linktree": n_via_lt,
        "n_js_suspect_no_ig": n_js,
        "denominator_note": (
            "ig_rate = n_with_ig / n_fetched。分子=IG 掲載(handle/linktree/"
            "embed/投稿リンクのいずれか)、分母=curl 取得成功サイト"),
        "no_instagram_subset": {
            "n": len(ni), "n_fetched": ni_fetched, "n_with_ig": ni_present,
            "ig_rate_pct": round(ni_rate * 100, 1),
            "note": "FSQ が instagram_handle 無しと判定した店だけの真の掲載率",
        },
        "sample_found": [
            {"store": r["store"], "website": r["website"],
             "found_handle": r["found_handle"], "via_linktree": r["via_linktree"],
             "ig_embed": r["ig_embed"], "ig_post_link": r["ig_post_link"]}
            for r in results if r["ig_present"]
        ][:30],
        "sample_all": results,
    }
    outpath = os.path.join(HERE, "official_site_ig_probe.json")
    with open(outpath, "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print("=" * 60)
    print(f"標本 {n_sampled} 件 (website あり, no_instagram 優先)")
    print(f"  取得成功  n_fetched = {n_fetched} / 取得失敗 = {n_err}")
    print(f"  IG 掲載   n_with_ig = {n_present} "
          f"(handle {n_handle} + embed/投稿のみ {n_embed_only})")
    print(f"  真の IG 掲載率 = {n_present}/{n_fetched} = {ig_rate*100:.1f}% "
          f"(分母: 取得成功サイト)")
    print(f"  うち handle まで機械抽出できた率 = "
          f"{n_handle}/{n_fetched} = {handle_rate*100:.1f}%")
    print(f"  うち linktree 等リンク集経由 = {n_via_lt}")
    print(f"  JS レンダリングで取れなかった疑い = {n_js}")
    print("-" * 60)
    print(f"[本命] FSQ が IG 無しと判定した店だけ (no_instagram):")
    print(f"  {ni_present}/{ni_fetched} = {ni_rate*100:.1f}% に IG が実在")
    print("-" * 60)
    print(f"従来集計値 15% との比較: 実測 {ig_rate*100:.1f}%  "
          f"(差 {ig_rate*100-15:+.1f}pt)")
    print(f"JS 未取得ぶんを足すと上限は "
          f"{(n_present+n_js)/n_fetched*100:.1f}% まで伸びうる")
    print(f"\n-> {outpath}")


if __name__ == "__main__":
    main()
