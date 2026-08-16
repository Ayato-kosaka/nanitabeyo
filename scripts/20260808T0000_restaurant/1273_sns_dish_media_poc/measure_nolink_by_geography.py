#!/usr/bin/env python3
"""#1273 リンク無し層に届く経路は「地方を狙う」ことで作れるのか

## なぜ

70% への到達は恒等式 `0.6969×r_L + 0.3031×r_N = 0.70` に支配されており、
**リンク無し層（343,247店）に届かないと数学的に届かない**。
ところが実測した経路は全部そこに届かなかった。

| 経路 | リンク無し比 | 基準 30.31% との比 |
|---|---:|---:|
| カテゴリ×エリア検索 | 3.73〜8.38% | 0.12〜0.28x |
| YouTube 長尺チャンネル | 12.28% | 0.41x |
| Shorts チャンネル | 18.84% | 0.62x |
| ブログ（特化6人） | 20.69% | 0.68x |

**ただし1件だけ例外があった。** ブログ `kimamanashimoblog.com` は
5/12 = **41.67%** で基準を上回った。**何が違うのか。**

仮説: **リンク有無は地理で決まる**。都市の店はサイトや SNS を持ち、
地方の店は持たない。だとすれば、**地方を狙って掘れば
同じ SNS 経路のままリンク無し層に届く**かもしれない。

## 測るもの（**ネットワークアクセスなし**）

1. 母集団側で、**市区町村の店舗密度帯ごとのリンク有無率**
   （地理でリンク有無が決まるのか、そもそもの確認）
2. SNS 経路で見つけた店（長尺 1,972 / Shorts 276）を同じ帯に割り当て、
   **経路が都市に偏っているのか**を見る
3. もし「地方の店はリンク無しが多い」かつ「経路が都市に偏っている」なら、
   **地方に寄せたときのリンク無し率の上限**を計算する

## この測定が言えないこと

母集団側の話であって、**地方に寄せて実際に SNS 投稿が見つかるか**は別である
（見つからないから都市に偏っている、という因果もありうる）。
ここで出るのは**上限**である。

実行:
    python3 measure_nolink_by_geography.py
"""

from __future__ import annotations

import collections
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_channel_traversal import (  # noqa: E402
    NameMatcher, has_cjk, normalize_ja, normalize_latin,
)

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
FIXTURES = HERE / "fixtures"
SOURCES = ("overture_jp_food.csv", "ifas_jp_food.csv", "osm_jp_food.csv")
NOLINK_BASE = 0.3031


def main() -> None:
    csv.field_size_limit(10**7)

    # --- 母集団を「屋号 -> (市区町村, リンク有無)」で持つ -------------------
    places: dict[tuple, dict] = {}
    for fn in SOURCES:
        fp = FIXTURES / fn
        if not fp.exists():
            continue
        with fp.open(encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                nm = (r.get("name") or "").strip()
                if not nm:
                    continue
                try:
                    lat, lon = float(r["latitude"]), float(r["longitude"])
                except (TypeError, ValueError, KeyError):
                    continue
                k = normalize_ja(nm) if has_cjk(nm) else normalize_latin(nm).strip()
                if not k:
                    continue
                pk = (k, round(lat, 3), round(lon, 3))
                has = (int(r.get("n_socials") or 0) > 0
                       or int(r.get("n_websites") or 0) > 0)
                cur = places.get(pk)
                loc = (r.get("locality") or "").strip()
                if cur is None:
                    places[pk] = {"key": k, "loc": loc, "has": has}
                else:
                    cur["has"] = cur["has"] or has
                    cur["loc"] = cur["loc"] or loc

    rows = list(places.values())
    # 市区町村ごとの店数（密度の代理）
    loc_n: collections.Counter = collections.Counter(r["loc"] for r in rows if r["loc"])
    ordered = [l for l, _ in loc_n.most_common()]
    rank = {l: i for i, l in enumerate(ordered)}
    q = max(1, len(ordered) // 5)

    def band_of(loc: str) -> int | None:
        if not loc or loc not in rank:
            return None
        return min(4, rank[loc] // q)

    print(f"重複除去後の店 {len(rows):,} / 市区町村 {len(loc_n):,}", file=sys.stderr)

    # --- 1. 密度帯ごとのリンク有無 ------------------------------------------
    band = collections.defaultdict(lambda: [0, 0])   # [店, リンク無し]
    for r in rows:
        b = band_of(r["loc"])
        if b is None:
            continue
        band[b][0] += 1
        if not r["has"]:
            band[b][1] += 1
    print(f"\n=== 母集団: 市区町村を店数で5分位（第1=多い）===", file=sys.stderr)
    print(f"{'帯':>4}{'店':>12}{'リンク無し':>12}{'率':>9}", file=sys.stderr)
    band_rate = {}
    for b in range(5):
        n, nl = band[b]
        if not n:
            continue
        band_rate[b] = nl / n
        print(f"  第{b+1}{n:>11,}{nl:>12,}{nl/n*100:>8.2f}%", file=sys.stderr)

    hi = band_rate.get(4, 0)
    lo = band_rate.get(0, 0)
    print(f"\n  **最も店が少ない帯 {hi*100:.2f}% / 最も多い帯 {lo*100:.2f}% "
          f"= {hi/max(lo,0.0001):.2f}倍**", file=sys.stderr)
    if hi / max(lo, 0.0001) < 1.15:
        print(f"  → **地理でリンク有無はほとんど決まらない。仮説は外れ。**",
              file=sys.stderr)
    else:
        print(f"  → 地方ほどリンク無しが多い。仮説は成立しうる。", file=sys.stderr)

    # --- 2. SNS 経路で見つけた店はどの帯にいるか ----------------------------
    m = NameMatcher()
    name_loc = {k: loc for k, (loc, _reg) in m.area.items()}
    link_of: dict[str, bool] = {}
    for r in rows:
        link_of[r["key"]] = link_of.get(r["key"], False) or r["has"]

    def route_stores(path: str, keys: tuple[str, ...]) -> set[str]:
        p = OUT_DIR / path
        if not p.exists():
            return set()
        d = json.loads(p.read_text(encoding="utf-8"))
        out: set[str] = set()

        def walk(o):
            if isinstance(o, dict):
                for k, v in o.items():
                    if k in keys and isinstance(v, list):
                        out.update(x for x in v if isinstance(x, str))
                    else:
                        walk(v)
            elif isinstance(o, list):
                for x in o:
                    walk(x)
        walk(d)
        return out

    routes = {
        "Shorts チャンネル": route_stores("shorts_route_channels.json", ("stores",)),
        "長尺チャンネル(57ch)": route_stores("channel_traversal_v2.json",
                                        ("stores", "restaurants")),
    }
    print(f"\n=== SNS 経路で見つけた店は、どの密度帯にいるか ===", file=sys.stderr)
    out_routes = {}
    for label, st in routes.items():
        if not st:
            print(f"  {label}: 0店（読み取れず）", file=sys.stderr)
            continue
        cnt = collections.Counter()
        nl = collections.Counter()
        for s in st:
            b = band_of(name_loc.get(s, ""))
            if b is None:
                continue
            cnt[b] += 1
            if link_of.get(s) is False:
                nl[b] += 1
        tot = sum(cnt.values())
        print(f"\n  {label}（帯を判定できた {tot} 店）", file=sys.stderr)
        for b in range(5):
            if not cnt[b]:
                continue
            print(f"    第{b+1}帯 {cnt[b]:>5} 店 = {cnt[b]/tot*100:5.2f}%  "
                  f"うちリンク無し {nl[b]:>4} = {nl[b]/cnt[b]*100:5.2f}%"
                  f"（母集団の同帯 {band_rate.get(b,0)*100:5.2f}%）", file=sys.stderr)
        out_routes[label] = {"by_band": {b: [cnt[b], nl[b]] for b in range(5)},
                             "total": tot}

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "nolink_by_geography.json"
    p.write_text(json.dumps(
        {"n_places": len(rows), "band_nolink_rate": band_rate,
         "routes": out_routes, "nolink_base": NOLINK_BASE,
         "caveat": "母集団側の話。地方に寄せて実際に SNS 投稿が見つかるかは別で、"
                   "ここで出るのは上限。密度帯は市区町村の店数で5分位に切った（本測定で決めた）。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
