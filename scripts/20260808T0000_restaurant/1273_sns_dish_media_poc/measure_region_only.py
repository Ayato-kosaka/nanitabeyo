#!/usr/bin/env python3
"""#1273 裏取りの「都道府県だけ一致」は残すべきか

## なぜ

目視80対で残った最大の誤り類型は**多拠点の別店舗**だった。

  - 丸幸ラーメンセンター … 登録は佐賀市、動画は基山町（どちらも**佐賀県**）
  - ハーブ庭園旅日記 … 登録は甲府市、動画は富士河口湖（どちらも**山梨県**）
  - らーめんゴッチ … 登録は山武市、動画は東金市（どちらも**千葉県**）

3件とも**市区町村は違うが都道府県は同じ**である。`match_corroborated` は

    (locality 丸ごと) or (市区町村トークン) or (**region**)

の**和集合**で裏取りしているので、region だけで通ってしまう。
前ラウンドで「これは支店同定が要るので除外できない」と書いたが、**外れていた**。
`region` を外すだけで、この類型はまとめて落ちる。

## 測るもの

裏取りが**何で通ったか**でペアを3群に分ける。

  - loc  : locality 丸ごとで通った
  - needle: 市区町村トークンで通った
  - **region_only : 都道府県でしか通っていない**

region_only を外したときに失う distinct 店舗数（recall の代償）と、
region_only の precision（外して得るもの）を目視で測る。

**recall の代償が大きく precision が変わらないなら、外すべきではない。**
両方を数字で出してから決める。

**ネットワークアクセスは一切しない。**

実行:
    python3 measure_region_only.py --sample 40
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_channel_traversal import NameMatcher, normalize_ja  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
STATE = OUT_DIR / "crawl_scaleup_state.json"


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=40)
    args = ap.parse_args()

    m = NameMatcher()
    state = json.loads(STATE.read_text(encoding="utf-8"))

    by_kind: dict[str, list] = collections.defaultdict(list)
    stores_all: set[str] = set()
    stores_strict: set[str] = set()   # region を外した場合に残る店

    for c in state["channels"].values():
        for v in c.get("videos") or []:
            t = (v.get("title") or "").strip()
            if not t:
                continue
            tja = normalize_ja(t)
            for key in m.match(t):
                loc, region = m.area.get(key, ("", ""))
                needle = m.needle.get(key, "")
                hit_loc = bool(loc and loc in tja)
                hit_needle = bool(needle and needle in tja)
                hit_region = bool(region and region in tja)
                if not (hit_loc or hit_needle or hit_region):
                    continue
                stores_all.add(key)
                if hit_loc or hit_needle:
                    kind = "loc" if hit_loc else "needle"
                    stores_strict.add(key)
                else:
                    kind = "region_only"
                by_kind[kind].append((key, t))

    n_all = sum(len(v) for v in by_kind.values())
    print(f"\n=== 裏取りが何で通ったか（(店,動画)対 {n_all:,}）===", file=sys.stderr)
    for k in ("loc", "needle", "region_only"):
        v = by_kind[k]
        print(f"  {k:12} {len(v):>7,} 対 = {len(v)/max(n_all,1)*100:>5.2f}%",
              file=sys.stderr)

    lost = stores_all - stores_strict
    print(f"\n=== region を外したときの代償 ===", file=sys.stderr)
    print(f"  distinct 店舗 {len(stores_all):,} -> {len(stores_strict):,} "
          f"({len(lost):,} 店 = {len(lost)/max(len(stores_all),1)*100:.2f}% を失う)",
          file=sys.stderr)

    ro = by_kind["region_only"]
    ordered = sorted(ro, key=lambda p: hashlib.sha256(
        f"RO/{p[0]}/{p[1]}".encode()).hexdigest())
    seen, sample = set(), []
    for key, t in ordered:
        if key in seen:
            continue
        seen.add(key)
        loc, region = m.area.get(key, ("", ""))
        sample.append({"store_key": key, "locality": loc, "region": region,
                       "needle": m.needle.get(key, ""), "title": t,
                       "only_in_region_only": key in lost})
        if len(sample) >= args.sample:
            break

    print(f"\n=== region だけで通ったペアの標本（{len(sample)}件・SHA-256順）===",
          file=sys.stderr)
    for i, r in enumerate(sample, 1):
        mark = "★失う" if r["only_in_region_only"] else "     "
        print(f"{i:>3}. {mark} 屋号「{r['store_key']}」 {r['region']}/{r['locality']}",
              file=sys.stderr)
        print(f"       {r['title'][:84]}", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "region_only.json"
    p.write_text(json.dumps(
        {"n_pairs": n_all,
         "by_kind": {k: len(v) for k, v in by_kind.items()},
         "stores_all": len(stores_all), "stores_strict": len(stores_strict),
         "stores_lost": len(lost),
         "lost_pct": len(lost) / max(len(stores_all), 1) * 100,
         "sample": sample,
         "caveat": "region_only の precision は目視で別途つける。"
                   "recall の代償と precision の両方を見てから決める。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
