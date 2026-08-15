#!/usr/bin/env python3
"""#1344 飲食ブログを機械的に列挙し、画像の利用可否と店舗被覆を測る

## なぜ

オーナー方針:
  - **料理カテゴリ特化のブロガー**（ラーメン専門・焼肉専門）を狙う
  - 利用可能なサイトが相当数あるなら有力。無ければ一括問い合わせも検討
  - 有料と言われる可能性は高いが、**無料でできるなら採用**

これまでの20件以上は全部「許諾なしで使える範囲を探す」だった。
**権利者から明示的に許諾を得る**枝はこのプロジェクトで初めてである。

## 入口: にほんブログ村

`gourmet.blogmura.com` は**料理カテゴリごとにブログが登録されている**ディレクトリ。
カテゴリページの記事リンクは
`https://link.blogmura.com/out/?ch=...&item=...&url=<実際の記事URL>`
の形で、**url パラメータに外部ブログの実URLが入っている**ので、そこから
ブログのドメインを機械的に集められる。

### 規約の確認（2026-08-15 に実際に取得して確認）

`blogmura.com/robots.txt` には **`User-agent: *` のルールが無い**。
Disallow されているのは proximic / Applebot / ImagesiftBot / SeekportBot の4つと、
bingbot への `Crawl-delay: 10` および `/themes/*/posts/` のみ。
汎用UAでのカテゴリページ取得は禁じられていない。それでも**直列・1.5秒間隔**にする。

## 段階

    --stage discover : カテゴリ×ページを辿り、外部ブログのドメインを集計する
    --stage license  : ドメインごとにトップページを取り、画像の利用可否表記と連絡先を分類
    --stage coverage : ブログの記事から店舗を逆引きし、distinct 店舗数とリンク無し層比を測る

**coverage が本丸。** 記事数ではなく「1ブロガーあたり distinct 何店か」「そのうち
リンク無し層が何%か」で KPI が動くかが決まる（YouTube では 12.28% しか無く純増 0.130pt だった）。

実行:
    python3 measure_food_blogs.py --stage discover
    python3 measure_food_blogs.py --stage license --top 60
"""

from __future__ import annotations

import argparse
import collections
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

UA = "Mozilla/5.0 (compatible; nanitabeyo-research/1.0)"
DELAY = 1.5
TIMEOUT = 25

# にほんブログ村のグルメ系カテゴリ（カテゴリ一覧から採取）
CATEGORIES = [
    "ramen", "cafe", "lunch", "bkyu", "coffee", "tokyogourmet", "kansaigourmet",
    "kantogourmet", "zenkokugourmet", "todayfood", "variousgourmet", "gourmetinfo",
    "takeout", "ordergourmet",
]
# ランキングの並び（in / out / pv）でメンバーが少しずつ違う
ORDERS = ["in", "out"]

_OUT = re.compile(r"link\.blogmura\.com/out/\?[^\"']*?url=([^\"'&]+)")

# 画像の利用可否を示す表記（実際の日本語ブログで使われる語）
POLICY = {
    "転載禁止": re.compile(r"転載を?禁|無断転載|無断使用|無断複製|複製を?禁|"
                       r"転載はご遠慮|画像の使用は?お?断り"),
    "要問い合わせ": re.compile(r"お問い?合わせ|ご連絡ください|許諾|許可を得|"
                          r"使用[をのは]希望|ご一報"),
    "明示的に利用可": re.compile(r"creativecommons\.org|CC BY|クリエイティブ・?コモンズ|"
                           r"自由に(?:ご)?利用|ご自由にお使い|転載(?:は)?自由|フリー素材"),
}
_MAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_FORM = re.compile(r"(お問い?合わせ|contact|フォーム)", re.I)


def get(url: str, timeout: int = TIMEOUT) -> bytes | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read(600_000)
    except Exception:                                        # noqa: BLE001
        return None


def stage_discover(args) -> None:
    dom_cat: dict[str, set] = collections.defaultdict(set)
    dom_articles: dict[str, set] = collections.defaultdict(set)
    n_pages = 0
    for cat in CATEGORIES:
        found_before = len(dom_cat)
        for order in ORDERS:
            for page in range(1, args.pages + 1):
                url = f"https://gourmet.blogmura.com/{cat}/ranking/{order}"
                if page > 1:
                    url += f"?p={page}"
                body = get(url)
                n_pages += 1
                time.sleep(DELAY)
                if not body:
                    continue
                html = body.decode("utf-8", "replace")
                for enc in _OUT.findall(html):
                    real = urllib.parse.unquote(enc)
                    try:
                        host = urllib.parse.urlparse(real).netloc.lower()
                    except ValueError:
                        continue
                    if not host:
                        continue
                    host = host[4:] if host.startswith("www.") else host
                    dom_cat[host].add(cat)
                    dom_articles[host].add(real)
        print(f"  {cat:18} 累計ドメイン {len(dom_cat):>5}"
              f"（+{len(dom_cat)-found_before}）", file=sys.stderr)

    print(f"\n=== 発見したブログドメイン {len(dom_cat):,}（{n_pages} ページ取得）===",
          file=sys.stderr)
    # 記事数が多い＝そのカテゴリで活発
    top = sorted(dom_articles.items(), key=lambda kv: -len(kv[1]))[:40]
    for d, arts in top:
        print(f"  {d[:44]:46} 記事 {len(arts):>3}  cat={','.join(sorted(dom_cat[d]))[:34]}",
              file=sys.stderr)

    # カテゴリ特化（1カテゴリだけに出る）ブログ
    focused = {d for d, cs in dom_cat.items() if len(cs) == 1}
    print(f"\n  1カテゴリだけに出るブログ（特化型）: {len(focused):,} "
          f"= {len(focused)/max(len(dom_cat),1)*100:.1f}%", file=sys.stderr)
    ramen_only = {d for d, cs in dom_cat.items() if cs == {"ramen"}}
    print(f"  うち ramen 専門: {len(ramen_only):,}", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "food_blogs_discover.json"
    p.write_text(json.dumps(
        {"n_domains": len(dom_cat), "n_pages_fetched": n_pages,
         "domains": {d: {"categories": sorted(cs),
                         "articles": sorted(dom_articles[d])[:20],
                         "n_articles": len(dom_articles[d])}
                     for d, cs in dom_cat.items()},
         "n_focused": len(focused), "n_ramen_only": len(ramen_only),
         "caveat": "blogmura のランキングページに出た記事リンクから採取。"
                   "ランキング上位に偏るので、これは母数の下限。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


def stage_license(args) -> None:
    src = OUT_DIR / "food_blogs_discover.json"
    if not src.exists():
        raise SystemExit("先に --stage discover を実行する")
    d = json.loads(src.read_text(encoding="utf-8"))
    doms = sorted(d["domains"].items(), key=lambda kv: -kv[1]["n_articles"])
    doms = doms[: args.top]

    rows = []
    cnt = collections.Counter()
    for host, info in doms:
        body = get(f"https://{host}/")
        time.sleep(DELAY)
        if not body:
            rows.append({"domain": host, "ok": False})
            cnt["取得失敗"] += 1
            continue
        html = body.decode("utf-8", "replace")
        text = re.sub(r"<[^>]+>", " ", html)
        label = "記載なし"
        for k in ("明示的に利用可", "転載禁止", "要問い合わせ"):
            if POLICY[k].search(text):
                label = k
                break
        mails = sorted(set(_MAIL.findall(text)))[:3]
        rows.append({"domain": host, "ok": True, "policy": label,
                     "has_form": bool(_FORM.search(text)),
                     "mails": mails,
                     "categories": info["categories"],
                     "n_articles": info["n_articles"]})
        cnt[label] += 1
        print(f"  {host[:40]:42} {label:8} "
              f"{'form' if _FORM.search(text) else '    '} "
              f"{'mail' if mails else ''}", file=sys.stderr)

    ok = [r for r in rows if r.get("ok")]
    print(f"\n=== 画像の利用可否表記（トップページのみ・n={len(ok)}）===", file=sys.stderr)
    for k, v in cnt.most_common():
        print(f"  {k:12} {v:>4} = {v/max(len(rows),1)*100:>5.1f}%", file=sys.stderr)
    reachable = sum(1 for r in ok if r["mails"] or r["has_form"])
    print(f"\n  **連絡先がある（メール or フォーム）: {reachable}/{len(ok)} = "
          f"{reachable/max(len(ok),1)*100:.1f}%**", file=sys.stderr)

    p = OUT_DIR / "food_blogs_license.json"
    p.write_text(json.dumps({"n": len(rows), "counts": dict(cnt),
                             "reachable": reachable, "rows": rows,
                             "caveat": "トップページの本文のみで判定。"
                                       "実際の規約は別ページにあることが多いので下限。"},
                            ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"-> {p.name}", file=sys.stderr)


_FEED = re.compile(r'href="([^"]*(?:rss|feed|atom)[^"]*)"', re.I)
_LINK = re.compile(r'<link>\s*([^<\s]+)\s*</link>', re.I)
_TAG = re.compile(r"<[^>]+>")


def stage_coverage(args) -> None:
    """**本丸**: 1ブロガーあたり distinct 何店か / そのうちリンク無し層が何%か。

    YouTube では 1ch あたり 15.85店・リンク無し 12.28%（基準率 30.31% の 0.41倍）で、
    純増 0.130pt しか無かった。ブログでも同じ偏りが出るなら KPI は動かない。
    """
    sys.path.insert(0, str(HERE))
    from measure_channel_traversal import NameMatcher, has_cjk, normalize_ja, normalize_latin
    import csv
    csv.field_size_limit(10**7)

    # 屋号 -> リンク有無（母集団から）
    link_of: dict[str, bool] = {}
    for fn in ("overture_jp_food.csv", "ifas_jp_food.csv", "osm_jp_food.csv"):
        fp = HERE / "fixtures" / fn
        if not fp.exists():
            continue
        with fp.open(encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                nm = (r.get("name") or "").strip()
                if not nm:
                    continue
                k = normalize_ja(nm) if has_cjk(nm) else normalize_latin(nm).strip()
                if not k:
                    continue
                has = (int(r.get("n_socials") or 0) > 0
                       or int(r.get("n_websites") or 0) > 0)
                link_of[k] = link_of.get(k, False) or has

    src = OUT_DIR / "food_blogs_discover.json"
    d = json.loads(src.read_text(encoding="utf-8"))
    doms = sorted(d["domains"].items(), key=lambda kv: -kv[1]["n_articles"])
    doms = [x for x in doms if x[0] not in ("note.com", "ameblo.jp")][: args.blogs]

    m = NameMatcher()
    rows = []
    for host, info in doms:
        arts = list(info["articles"])
        # RSS があれば記事を増やす
        body = get(f"https://{host}/")
        time.sleep(DELAY)
        if body:
            html = body.decode("utf-8", "replace")
            feeds = [urllib.parse.urljoin(f"https://{host}/", u)
                     for u in _FEED.findall(html)][:2]
            for f in feeds:
                fb = get(f)
                time.sleep(DELAY)
                if fb:
                    arts += [u for u in _LINK.findall(fb.decode("utf-8", "replace"))
                             if host in u][:40]
        arts = list(dict.fromkeys(arts))[: args.articles]

        stores: set[str] = set()
        n_ok = 0
        for a in arts:
            ab = get(a, timeout=20)
            time.sleep(DELAY)
            if not ab:
                continue
            n_ok += 1
            text = _TAG.sub(" ", ab.decode("utf-8", "replace"))
            stores |= m.match_corroborated(text[:20000])
        nolink = sum(1 for s in stores if link_of.get(s) is False)
        rows.append({"domain": host, "n_articles_tried": len(arts),
                     "n_articles_ok": n_ok, "n_stores": len(stores),
                     "n_nolink": nolink, "stores": sorted(stores)[:50]})
        print(f"  {host[:36]:38} 記事 {n_ok:>3}/{len(arts):<3} → "
              f"distinct 店 {len(stores):>3}（リンク無し {nolink:>2}）", file=sys.stderr)

    tot_s = sum(r["n_stores"] for r in rows)
    tot_n = sum(r["n_nolink"] for r in rows)
    tot_a = sum(r["n_articles_ok"] for r in rows)
    print(f"\n=== ブログ経路の収量 ===", file=sys.stderr)
    print(f"  ブログ {len(rows)} / 記事 {tot_a:,}", file=sys.stderr)
    print(f"  **1ブログあたり distinct 店舗 {tot_s/max(len(rows),1):.2f}店**"
          f"（YouTube 1ch は 15.85店）", file=sys.stderr)
    print(f"  1記事あたり {tot_s/max(tot_a,1):.3f}店", file=sys.stderr)
    print(f"  **リンク無し層の比 {tot_n}/{tot_s} = {tot_n/max(tot_s,1)*100:.2f}%**"
          f"（母集団基準 30.92% / YouTube は 12.28%）", file=sys.stderr)

    p2 = OUT_DIR / "food_blogs_coverage.json"
    p2.write_text(json.dumps(
        {"n_blogs": len(rows), "n_articles": tot_a, "sum_stores": tot_s,
         "stores_per_blog": tot_s / max(len(rows), 1),
         "nolink": tot_n, "nolink_pct": tot_n / max(tot_s, 1) * 100,
         "rows": rows,
         "caveat": "記事本文から NameMatcher で逆引き。経路存在率であって実効ではない。"
                   "許諾が取れるかは別。RSS が無いブログは discover 由来の記事のみ。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"-> {p2.name}", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", choices=("discover", "license", "coverage"), required=True)
    ap.add_argument("--blogs", type=int, default=12)
    ap.add_argument("--articles", type=int, default=25)
    ap.add_argument("--pages", type=int, default=3)
    ap.add_argument("--top", type=int, default=60)
    args = ap.parse_args()
    {"discover": stage_discover, "license": stage_license,
     "coverage": stage_coverage}[args.stage](args)


if __name__ == "__main__":
    main()
