#!/usr/bin/env python3
"""#1344 「カテゴリ特化ブロガーが本命」という見立てを実測で検証する

## なぜ

オーナーの見立て:

> 特にラーメンとかで絞るであったりとか焼肉とかこんな感じで…
> 料理カテゴリーを絞ってるブログの人を取っていくのがいいと思う

これが本当かは測っていない。測るべきは2つある。

  1. **1ブロガーあたり distinct 何店か**（特化と非特化で差が出るか）
  2. **そのうちリンク無し層が何%か**（KPI① が動くかはここで決まる）

②が重要なのは、恒等式 `0.6969×r_L + 0.3031×r_N = 0.70` から
**リンク無し層に届かない限り 70% には数学的に届かない**ためである。
既測の他経路は YouTube 0.41倍・検索 0.12〜0.28倍（基準 30.31%）で全滅している。

## 前回との違い

  - 前回のブログ実測は **`NameMatcher` の裏取りキーが壊れたまま**の値だった
    （#1349 で修正。チャンネル経路では distinct 1.58倍）。ここでは**修正後**で測る
  - **記事本文をディスクに保存する**。次に照合規則を変えたとき、
    再クロールせずに測り直せるようにする（今回それができずに困った）

## 選び方（決め方を明記する）

`out/blogger_supply.json` の「カテゴリが1つだけのブロガー」を特化群、
「カテゴリが2つ以上のブロガー」を非特化群とし、**記事数の多い順**に同数取る。
記事数の多い順にするのは、サイトマップが辿れる見込みが高いためである
（＝取得できるブログに偏る。これは**下限側**の偏りである）。

## この測定が言えないこと

**経路存在率である。** ブログに店名が書いてあることと、
その記事の写真を `dish_media` にできることは別である（許諾が要る）。

実行:
    python3 measure_blog_yield_by_focus.py --per-group 6 --max-articles 150
"""

from __future__ import annotations

import argparse
import collections
import csv
import gzip
import hashlib
import json
import re
import sys
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_channel_traversal import (  # noqa: E402
    NameMatcher, has_cjk, normalize_ja, normalize_latin,
)

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
TEXT_DIR = OUT_DIR / "_blog_text"          # 記事本文の保存先（再測定用）
FIXTURES = HERE / "fixtures"
UA = "Mozilla/5.0 (compatible; nanitabeyo-research/1.0)"
_TAG = re.compile(r"<[^>]+>")
_SCRIPT = re.compile(r"(?is)<(script|style)[^>]*>.*?</\1>")
_LOC = re.compile(rb"<loc>\s*([^<\s]+)\s*</loc>", re.I)
NOLINK_BASE = 0.3031                        # リンク無し層の母集団比


def get(u: str, timeout: int = 18) -> bytes | None:
    try:
        req = urllib.request.Request(u, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read(400_000)
    except Exception:                                        # noqa: BLE001
        return None


def article_urls(host: str, cap: int, delay: float) -> list[str]:
    urls: set[str] = set()
    queue = [f"https://{host}/sitemap.xml", f"https://{host}/sitemap_index.xml",
             f"https://{host}/wp-sitemap.xml", f"https://{host}/sitemap-index.xml"]
    seen: set[str] = set()
    while queue and len(urls) < cap * 3 and len(seen) < 30:
        sm = queue.pop(0)
        if sm in seen:
            continue
        seen.add(sm)
        body = get(sm, timeout=25)
        time.sleep(delay)
        if not body:
            continue
        if body[:2] == b"\x1f\x8b":
            try:
                body = gzip.decompress(body)
            except Exception:                                # noqa: BLE001
                continue
        for loc in _LOC.findall(body):
            u = loc.decode("utf-8", "replace")
            if u.endswith((".xml", ".xml.gz")):
                queue.append(u)
            elif host in u:
                urls.add(u)
    return sorted(urls)[:cap]


def load_link_map() -> dict[str, bool]:
    csv.field_size_limit(10**7)
    link_of: dict[str, bool] = {}
    for fn in ("overture_jp_food.csv", "ifas_jp_food.csv", "osm_jp_food.csv"):
        fp = FIXTURES / fn
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
    return link_of


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-group", type=int, default=6)
    ap.add_argument("--max-articles", type=int, default=150)
    ap.add_argument("--delay", type=float, default=0.7)
    args = ap.parse_args()

    sup = json.loads((OUT_DIR / "blogger_supply.json").read_text(encoding="utf-8"))
    focused = [t for t in sup["top_focused"]]
    # 非特化群は blogger_supply に入っていないので discover から作る
    disc = json.loads((OUT_DIR / "food_blogs_discover.json").read_text(encoding="utf-8"))
    multi_hosts = [(h, v) for h, v in disc["domains"].items()
                   if len(v.get("categories", [])) >= 2]
    multi_hosts.sort(key=lambda kv: -kv[1]["n_articles"])

    focus_hosts, seen = [], set()
    for t in focused:
        h = urlparse(t["sample"]).netloc
        if h and h not in seen:
            seen.add(h)
            focus_hosts.append((h, t["cat"]))
        if len(focus_hosts) >= args.per_group * 4:
            break
    general_hosts = [(h, "+".join(v["categories"][:3]))
                     for h, v in multi_hosts[: args.per_group * 4]]

    m = NameMatcher()
    # 【自戒・重要】#1349 で緩めた裏取り（市名・区名から行政区画語を落とした形）は
    # **短文（動画タイトル）では 95% の precision が出たが、長文では破綻する**。
    # 実測: umai-net.com の 134記事で 11店 → **96店**に増えたが、目視すると
    # 『新宿御苑』が全記事に付く（サイドバーに地名があるため、ページ内のどこかに
    # 「新宿」があれば裏取りが通ってしまう）。近傍±120字に限っても 35店で、
    # 『横浜スタジアム』『クリーム』『スペース』が残った。
    # **ブログ本文では緩めない。** 比較のため両方数えるが、採用するのは strict 側。
    strict = {k: frozenset(x for x in (loc, m.needle.get(k, ""), reg) if x)
              for k, (loc, reg) in m.area.items()}

    def match_strict(text: str) -> set[str]:
        tja = normalize_ja(text)
        out = set()
        for k in m.match(text):
            for w in strict.get(k, ()):
                if w in tja:
                    out.add(k)
                    break
        return out

    link_of = load_link_map()
    TEXT_DIR.mkdir(parents=True, exist_ok=True)

    def run_group(hosts, label):
        rows, done = [], 0
        for host, cat in hosts:
            if done >= args.per_group:
                break
            arts = article_urls(host, args.max_articles, args.delay)
            if not arts:
                continue
            stores: set[str] = set()
            stores_relaxed: set[str] = set()
            n_ok = 0
            for a in arts:
                b = get(a)
                time.sleep(args.delay)
                if not b:
                    continue
                n_ok += 1
                text = _TAG.sub(" ", _SCRIPT.sub(
                    " ", b.decode("utf-8", "replace")))[:25000]
                # 【今回の改善】本文を保存する。次に照合規則を変えたとき再クロール不要
                fp = TEXT_DIR / f"{hashlib.sha256(a.encode()).hexdigest()[:20]}.txt"
                fp.write_text(f"{a}\n{text}", encoding="utf-8")
                stores |= match_strict(text)
                stores_relaxed |= m.match_corroborated(text)
            if n_ok == 0:
                continue
            done += 1
            known = [s for s in stores if s in link_of]
            nol = [s for s in known if not link_of[s]]
            rows.append({"group": label, "domain": host, "cat": cat,
                         "n_articles": n_ok, "n_stores": len(stores),
                         "n_stores_relaxed": len(stores_relaxed),
                         "n_known": len(known), "n_nolink": len(nol),
                         "stores": sorted(stores)[:120]})
            print(f"  [{label}] {host[:30]:32} 記事 {n_ok:>4} → 店 {len(stores):>4}"
                  f"(緩め {len(stores_relaxed):>4})"
                  f"  リンク無し {len(nol):>3}/{len(known):<4}"
                  f" = {len(nol)/max(len(known),1)*100:5.2f}%", file=sys.stderr)
        return rows

    print(f"=== カテゴリ特化群（1カテゴリだけ）===", file=sys.stderr)
    rows_f = run_group(focus_hosts, "特化")
    print(f"\n=== 非特化群（2カテゴリ以上）===", file=sys.stderr)
    rows_g = run_group(general_hosts, "非特化")

    def summarize(rows, label):
        if not rows:
            print(f"  {label}: 0ブログ。数字を出さない。", file=sys.stderr)
            return None
        a = sum(r["n_articles"] for r in rows)
        s = sum(r["n_stores"] for r in rows)
        k = sum(r["n_known"] for r in rows)
        n = sum(r["n_nolink"] for r in rows)
        u = {x for r in rows for x in r["stores"]}
        print(f"\n  **{label}** ブログ {len(rows)} / 記事 {a:,}", file=sys.stderr)
        print(f"    1ブロガーあたり distinct 店 **{s/len(rows):.1f}**", file=sys.stderr)
        print(f"    1記事あたり {s/max(a,1):.3f} 店", file=sys.stderr)
        print(f"    **リンク無し層 {n}/{k} = {n/max(k,1)*100:.2f}%**"
              f"（基準 30.31% の {n/max(k,1)/NOLINK_BASE:.2f}倍）", file=sys.stderr)
        print(f"    群全体の重複除去 distinct {len(u):,}", file=sys.stderr)
        return {"n_blogs": len(rows), "n_articles": a, "sum_stores": s,
                "stores_per_blogger": s / len(rows), "n_known": k, "n_nolink": n,
                "nolink_rate": n / max(k, 1), "distinct_all": len(u)}

    print(f"\n=== まとめ ===", file=sys.stderr)
    sf = summarize(rows_f, "カテゴリ特化")
    sg = summarize(rows_g, "非特化")
    if sf and sg:
        print(f"\n  **特化 / 非特化 の比**: "
              f"1人あたり店 {sf['stores_per_blogger']/max(sg['stores_per_blogger'],0.01):.2f}倍 / "
              f"リンク無し率 {sf['nolink_rate']/max(sg['nolink_rate'],0.0001):.2f}倍",
              file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "blog_yield_by_focus.json"
    p.write_text(json.dumps(
        {"focused": sf, "general": sg, "rows": rows_f + rows_g,
         "nolink_base": NOLINK_BASE,
         "caveat": "経路存在率。ブログに店名が書いてあることと、その写真を dish_media に"
                   "できることは別（許諾が要る）。サイトマップが辿れるブログに偏るので下限。"
                   "本文は out/_blog_text/ に保存済み（再測定にクロール不要）。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}（本文は {TEXT_DIR.name}/ に保存）", file=sys.stderr)


if __name__ == "__main__":
    main()
