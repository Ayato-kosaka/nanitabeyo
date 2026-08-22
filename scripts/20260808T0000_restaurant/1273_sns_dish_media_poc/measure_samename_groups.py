#!/usr/bin/env python3
"""#1273 「同名2件以上」として辞書から捨てている店は、写真の共有先として使えるか

## なぜ

`NameMatcher` は **同名が2つ以上の場所にある屋号を辞書から落としている**
（支店を確定できないため。#1273 §23）。これは**逆引き**（動画→店舗）としては正しい。

しかし **写真の共有**では話が逆になる。チェーン本部サイトの写真を全店に適用するのは
既に実測済み（9,350ドメイン / 184,905店 = 23.42%、寄与 +7.02pt）。
同じ論理は「同名グループ」にも使える——**同じ屋号の店は同じ料理を出す**からである。

ただし **チェーンドメイン経路で既に数えた店**を二重に数えてはいけない。
本スクリプトは規模と**重複していない部分**を全数で測る。

## 測るもの

fixtures 全 1,244,008 行を「正規化した屋号 × 場所」で束ね、

  1. 同名が2箇所以上ある屋号の数と、そこに属する店の数（規模帯別）
  2. そのうち **website も socials も持たない店**（＝今どの経路にも乗っていない店）
  3. **同名グループの中に website を持つ店が1つでもあるか**
     → あれば「その1店のサイトの写真をグループ全体に配れる」余地がある

**ネットワークアクセスは一切しない。**

## この数字が言えないこと

「同名なら同じ料理」は**仮説**である。のれん分けや無関係の同名（「一番」「大和」等）が
混ざる。ここで出すのは**規模と重複の有無**までで、
実際に配ってよいかは屋号ごとの目視が要る。決定的標本を書き出す。

実行:
    python3 measure_samename_groups.py
"""

from __future__ import annotations

import collections
import csv
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_channel_traversal import (  # noqa: E402
    STOPWORD_NAMES, has_cjk, normalize_ja, normalize_latin,
)
from measure_locality_backfill import load_rows  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
FIXTURES = HERE / "fixtures"

BANDS = ((2, 3), (4, 10), (11, 50), (51, 200), (201, 10**9))


def band_of(n: int) -> str:
    for lo, hi in BANDS:
        if lo <= n <= hi:
            return f"{lo}-{hi}" if hi < 10**8 else f"{lo}+"
    return "1"


def key_of(name: str) -> str:
    return normalize_ja(name) if has_cjk(name) else normalize_latin(name).strip()


def main() -> None:
    csv.field_size_limit(10**7)

    # website / socials の有無は fixture の n_websites / n_socials で見る
    has_site: dict[str, bool] = {}
    rows = []
    for r in load_rows():
        k = key_of(r["name"])
        if not k:
            continue
        r["key"] = k
        rows.append(r)
    print(f"読み込み {len(rows):,} 行", file=sys.stderr)

    # 場所は座標を小数2桁(≒1km)に丸めて識別する（NameMatcher と同じ規則）
    places: dict[str, set] = collections.defaultdict(set)
    for r in rows:
        places[r["key"]].add((round(r["lat"], 2), round(r["lon"], 2)))

    stop = {normalize_ja(s) for s in STOPWORD_NAMES} | {
        normalize_latin(s).strip() for s in STOPWORD_NAMES}

    multi = {k for k, p in places.items() if len(p) >= 2 and k not in stop}
    print(f"同名2箇所以上の屋号: {len(multi):,}", file=sys.stderr)

    # 屋号ごとに集計
    grp_rows: dict[str, list] = collections.defaultdict(list)
    for r in rows:
        if r["key"] in multi:
            grp_rows[r["key"]].append(r)

    by_band = collections.defaultdict(lambda: {"names": 0, "stores": 0,
                                               "nolink_stores": 0,
                                               "groups_with_a_site": 0,
                                               "nolink_in_such_groups": 0})
    total_stores = total_nolink = 0
    reachable_nolink = 0
    samples = []
    for k, rs in grp_rows.items():
        n_places = len(places[k])
        b = band_of(n_places)
        slot = by_band[b]
        slot["names"] += 1
        slot["stores"] += n_places
        total_stores += n_places
        nolink = sum(1 for r in rs if not r["has_link"])
        # 場所単位に直す（同一店が3ソースに重複するため）
        place_link = {}
        for r in rs:
            pk = (round(r["lat"], 2), round(r["lon"], 2))
            place_link[pk] = place_link.get(pk, False) or r["has_link"]
        n_nolink_places = sum(1 for v in place_link.values() if not v)
        slot["nolink_stores"] += n_nolink_places
        total_nolink += n_nolink_places
        if any(place_link.values()):
            slot["groups_with_a_site"] += 1
            slot["nolink_in_such_groups"] += n_nolink_places
            reachable_nolink += n_nolink_places
        samples.append((hashlib.sha256(k.encode()).hexdigest(), {
            "name": rs[0]["name"], "key": k, "n_places": n_places,
            "n_nolink_places": n_nolink_places,
            "has_any_link": any(place_link.values()),
            "sources": sorted({r["source"] for r in rs}),
        }))

    print(f"\n=== 同名グループの規模帯別（場所単位）===", file=sys.stderr)
    print(f"{'規模':>10}{'屋号数':>9}{'店数':>10}{'リンク無し店':>13}"
          f"{'1店でもリンク有りの屋号':>24}{'その中のリンク無し店':>21}", file=sys.stderr)
    out_bands = {}
    for lo, hi in BANDS:
        b = f"{lo}-{hi}" if hi < 10**8 else f"{lo}+"
        s = by_band.get(b)
        if not s:
            continue
        out_bands[b] = dict(s)
        print(f"{b:>10}{s['names']:>9,}{s['stores']:>10,}{s['nolink_stores']:>13,}"
              f"{s['groups_with_a_site']:>24,}{s['nolink_in_such_groups']:>21,}",
              file=sys.stderr)

    print(f"\n  同名グループに属する店（場所単位）: {total_stores:,}", file=sys.stderr)
    print(f"  うちリンク無し                    : {total_nolink:,}", file=sys.stderr)
    print(f"  **同じ屋号にリンク有りの店が1つでもある「リンク無し店」: "
          f"{reachable_nolink:,}**", file=sys.stderr)
    print(f"    = 母集団 1,132,482 seed の {reachable_nolink / 1_132_482 * 100:.2f}%",
          file=sys.stderr)

    samples.sort(key=lambda x: x[0])
    picked = [s[1] for s in samples[:60]]
    print(f"\n=== 決定的標本（SHA-256 順、目視で「同名＝同じ料理」が成り立つか見る）===",
          file=sys.stderr)
    for s in picked[:20]:
        print(f"  {s['name'][:22]:24} {s['n_places']:>5}箇所 "
              f"リンク無し {s['n_nolink_places']:>4} "
              f"{'（リンク有りの店あり）' if s['has_any_link'] else ''}", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "samename_groups.json"
    out_path.write_text(
        json.dumps({"n_rows": len(rows), "n_multi_names": len(multi),
                    "total_stores": total_stores, "total_nolink": total_nolink,
                    "reachable_nolink": reachable_nolink,
                    "reachable_nolink_pct_of_seed": reachable_nolink / 1_132_482 * 100,
                    "by_band": out_bands, "sample": picked,
                    "caveat": "「同名＝同じ料理」は仮説。のれん分けや無関係の同名が混ざる。"
                              "ここで出すのは規模と重複の有無まで。"},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
