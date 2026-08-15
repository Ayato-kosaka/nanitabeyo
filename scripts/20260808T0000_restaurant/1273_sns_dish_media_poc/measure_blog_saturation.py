#!/usr/bin/env python3
"""#1344 「1ブロガーの全アーカイブは何店になるか」— 打ち切りを外して曲線で測る

## なぜ（これが必要人数を1桁も2桁も変える）

`measure_blogger_supply.py` は、5.3店/ブロガー という実測から
**94,808人必要**と出した。オーナーの見立て「千ブロガーぐらい」の 95倍である。

しかしこの 5.3店 は **`--max-articles 150` という私が決めた打ち切りの結果**であって、
ブロガーの実力ではない。実際 umai-net.com はサイトマップに 2,000本以上あり、
そのうち 136本しか読んでいない。0.082店/記事のまま線形に伸びるなら
2,000記事で 164店になり、必要人数は 3,000人台に落ちる。**桁が変わる。**

線形か飽和かは**測らないと分からない**（同じ店を何度も書く、シリーズ物が多い等で
飽和する可能性が十分ある）。だから曲線で測る。

## 測るもの

サイトマップの全記事を（上限まで）順に読み、
**読んだ記事数 N に対する distinct 店舗数 S(N) の曲線**を記録する。

  - S(N) が直線なら … 記事数に比例。必要人数は「記事総数」で決まる
  - S(N) が寝てくるなら … 1ブロガーの上限がある。必要人数は減らない

飽和の度合いは、後半区間の傾き ÷ 前半区間の傾き で出す
（この指標の定義はここで決めたものである。1.0 なら線形、0 なら完全飽和）。

## この測定が言えないこと

  - 経路存在率であって実効カバレッジではない
  - ブロガー間の重複は測っていない（別ブロガーが同じ有名店を書く分は
    ここでは差し引かれない。必要人数の楽観側の誤差になる）
  - サイトマップがあるブログに限る

実行:
    python3 measure_blog_saturation.py --blogs 3 --max-articles 900
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_channel_traversal import NameMatcher  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
UA = "Mozilla/5.0 (compatible; nanitabeyo-research/1.0)"
_TAG = re.compile(r"<[^>]+>")
_LOC = re.compile(rb"<loc>\s*([^<\s]+)\s*</loc>", re.I)


def get(u: str, timeout: int = 18) -> bytes | None:
    try:
        req = urllib.request.Request(u, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read(400_000)
    except Exception:                                        # noqa: BLE001
        return None


def article_urls(host: str, cap: int) -> list[str]:
    urls: set[str] = set()
    queue = [f"https://{host}/sitemap.xml", f"https://{host}/sitemap_index.xml",
             f"https://{host}/wp-sitemap.xml"]
    seen: set[str] = set()
    while queue and len(urls) < cap * 3 and len(seen) < 60:
        sm = queue.pop(0)
        if sm in seen:
            continue
        seen.add(sm)
        body = get(sm, timeout=25)
        time.sleep(0.6)
        if not body:
            continue
        if body[:2] == b"\x1f\x8b":
            try:
                body = gzip.decompress(body)
            except Exception:                                # noqa: BLE001
                continue
        for loc in _LOC.findall(body):
            u = loc.decode("utf-8", "replace")
            if u.endswith(".xml") or u.endswith(".xml.gz"):
                queue.append(u)
            elif host in u:
                urls.add(u)
    return sorted(urls)[:cap]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--blogs", type=int, default=3)
    ap.add_argument("--max-articles", type=int, default=900)
    ap.add_argument("--delay", type=float, default=0.7)
    args = ap.parse_args()

    deep = json.loads((OUT_DIR / "food_blogs_deep.json").read_text(encoding="utf-8"))
    hosts = [r["domain"] for r in deep["rows"] if r["n_articles_ok"] > 0][: args.blogs]
    # 記事の多いブログから見たいので、サイトマップ本数の多い順に
    hosts.sort(key=lambda h: -next(r["n_sitemap_urls"] for r in deep["rows"]
                                   if r["domain"] == h))
    m = NameMatcher()
    rows = []

    for host in hosts:
        arts = article_urls(host, args.max_articles)
        print(f"\n{host}  サイトマップ記事 {len(arts):,}（上限 {args.max_articles}）",
              file=sys.stderr)
        stores: set[str] = set()
        curve = []
        n_ok = 0
        t0 = time.time()
        for a in arts:
            b = get(a)
            time.sleep(args.delay)
            if not b:
                continue
            n_ok += 1
            stores |= m.match_corroborated(
                _TAG.sub(" ", b.decode("utf-8", "replace"))[:25000])
            if n_ok % 25 == 0:
                curve.append((n_ok, len(stores)))
                print(f"    記事 {n_ok:>4} → distinct 店 {len(stores):>4} "
                      f"（{len(stores)/n_ok:.3f}店/記事）", file=sys.stderr)
        curve.append((n_ok, len(stores)))
        # 飽和の指標（定義はここで決めた）: 後半の傾き ÷ 前半の傾き
        half = n_ok // 2
        s_half = next((s for n, s in curve if n >= half), 0)
        slope_1 = s_half / max(half, 1)
        slope_2 = (len(stores) - s_half) / max(n_ok - half, 1)
        ratio = slope_2 / slope_1 if slope_1 else 0.0
        rows.append({"domain": host, "n_articles": n_ok, "n_stores": len(stores),
                     "curve": curve, "slope_first_half": slope_1,
                     "slope_second_half": slope_2, "linearity": ratio,
                     "seconds": time.time() - t0})
        print(f"  **{host}: {n_ok} 記事 → {len(stores)} 店** "
              f"（前半 {slope_1:.3f} → 後半 {slope_2:.3f} 店/記事、"
              f"線形度 {ratio:.2f}）", file=sys.stderr)

    if not rows:
        print("**1ブログも読めなかった。数字を出さない。**", file=sys.stderr)
        raise SystemExit(2)

    tot_a = sum(r["n_articles"] for r in rows)
    tot_s = sum(r["n_stores"] for r in rows)
    lin = sum(r["linearity"] for r in rows) / len(rows)
    print(f"\n=== まとめ ===", file=sys.stderr)
    print(f"  ブログ {len(rows)} / 記事 {tot_a:,} → distinct 店 {tot_s:,}",
          file=sys.stderr)
    print(f"  **{tot_s/len(rows):.1f}店/ブロガー**（150記事打ち切り版は 5.3店）",
          file=sys.stderr)
    print(f"  1記事あたり {tot_s/max(tot_a,1):.3f}店", file=sys.stderr)
    print(f"  **線形度 {lin:.2f}**（1.0=線形、0=完全飽和）", file=sys.stderr)
    gap = 502_482
    print(f"\n  70%までの不足 {gap:,}店 ÷ {tot_s/len(rows):.1f}店/人 = "
          f"**{gap/max(tot_s/len(rows),1):,.0f} 人必要**"
          f"（重複無視の楽観値）", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "blog_saturation.json"
    p.write_text(json.dumps(
        {"n_blogs": len(rows), "n_articles": tot_a, "n_stores": tot_s,
         "stores_per_blogger": tot_s / len(rows),
         "stores_per_article": tot_s / max(tot_a, 1),
         "linearity_mean": lin, "rows": rows,
         "caveat": "経路存在率。ブロガー間の重複は差し引いていない。"
                   "線形度の定義は後半の傾き÷前半の傾き（本スクリプトで決めた指標）。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
