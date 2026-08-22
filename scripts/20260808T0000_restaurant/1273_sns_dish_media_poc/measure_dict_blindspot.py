#!/usr/bin/env python3
"""#1345 #1279 逆引き辞書の盲点は地域で偏っているか（KPI② に直接効く）

## なぜ

Shorts のカテゴリ×エリア検索の実測で、妙な並びが出た。

    ラーメン 新宿 → 0店   ラーメン 大阪 → 0店   ラーメン 福岡 → 0店
    ラーメン 札幌 → 2店   ラーメン 仙台 → 2店   ラーメン 高松 → 4店

**大都市ほど店が特定できていない。** 動画の本数は大都市の方が多いのだから、
これは供給の問題ではない。仮説は

    大都市の店ほど同名が全国に存在し、`NameMatcher` の
    「同名2箇所以上は辞書から落とす」規則（#1273 §23）に当たっている

である。もし本当なら、逆引き経路は**KPI② が最も要求する都市部のセルで
構造的に弱い**ことになる。KPI② は「1エリア×1カテゴリに distinct 5店」なので、
都市部が弱いのは致命的である。

## 測るもの（**ネットワークアクセスなし**）

母集団を重複除去したうえで、店ごとに「その屋号が母集団に何箇所あるか」を数え、

  - 都道府県別の**辞書に載らない率**（同名2箇所以上の割合）
  - 政令市・特別区など**人口密集地の市区町村**と、それ以外の比較
  - 店舗密度（市区町村あたりの店数）と辞書落ち率の関係

を出す。これは `NameMatcher` の他の除外（ストップワード等）を通す前の
**「同名」由来だけ**を見る指標である。

## この測定が言えないこと

辞書に載っていても、SNS 側にその店の投稿が無ければ実効カバレッジにはならない。
ここで測るのは**逆引きの上限がどこで削られているか**だけである。

実行:
    python3 measure_dict_blindspot.py
"""

from __future__ import annotations

import collections
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_channel_traversal import has_cjk, normalize_ja, normalize_latin  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
FIXTURES = HERE / "fixtures"
SOURCES = ("overture_jp_food.csv", "ifas_jp_food.csv", "osm_jp_food.csv")


def main() -> None:
    csv.field_size_limit(10**7)

    # --- 重複除去（店単位）--------------------------------------------------
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
                if pk not in places:
                    places[pk] = {"key": k,
                                  "region": (r.get("region") or "").strip(),
                                  "locality": (r.get("locality") or "").strip()}

    rows = list(places.values())
    # 屋号ごとの「異なる地点の数」
    pts: dict[str, set] = collections.defaultdict(set)
    for pk in places:
        pts[pk[0]].add((round(pk[1], 2), round(pk[2], 2)))
    print(f"重複除去後の店 {len(rows):,} / 屋号 {len(pts):,}", file=sys.stderr)

    multi = {k for k, v in pts.items() if len(v) >= 2}
    n_multi = sum(1 for r in rows if r["key"] in multi)
    print(f"**同名2箇所以上で辞書に載らない店 {n_multi:,} = "
          f"{n_multi/len(rows)*100:.2f}%**（全国）", file=sys.stderr)

    # --- 都道府県別 ---------------------------------------------------------
    per_reg: dict[str, list] = collections.defaultdict(lambda: [0, 0])
    for r in rows:
        reg = r["region"] or "（不明）"
        per_reg[reg][0] += 1
        if r["key"] in multi:
            per_reg[reg][1] += 1
    reg_rows = sorted(((k, v[0], v[1], v[1] / v[0] * 100)
                       for k, v in per_reg.items() if v[0] >= 500),
                      key=lambda x: -x[3])
    print(f"\n=== 都道府県別 辞書落ち率（500店以上の県のみ）===", file=sys.stderr)
    print(f"{'':12}{'店':>9}{'辞書落ち':>9}{'率':>8}", file=sys.stderr)
    for k, n, m, p in reg_rows[:10]:
        print(f"  高い {k[:8]:10}{n:>9,}{m:>9,}{p:>7.2f}%", file=sys.stderr)
    for k, n, m, p in reg_rows[-10:]:
        print(f"  低い {k[:8]:10}{n:>9,}{m:>9,}{p:>7.2f}%", file=sys.stderr)

    # --- 市区町村別（店数の多い順＝人口密集地の代理）------------------------
    per_loc: dict[tuple, list] = collections.defaultdict(lambda: [0, 0])
    for r in rows:
        key = (r["region"] or "?", r["locality"] or "?")
        per_loc[key][0] += 1
        if r["key"] in multi:
            per_loc[key][1] += 1
    locs = sorted(per_loc.items(), key=lambda kv: -kv[1][0])
    print(f"\n=== 店数の多い市区町村 上位15 ===", file=sys.stderr)
    for (reg, loc), (n, m) in locs[:15]:
        print(f"  {reg[:6]:8}{loc[:12]:14}{n:>7,}店  辞書落ち {m:>6,} "
              f"= {m/n*100:5.2f}%", file=sys.stderr)
    print(f"\n=== 店数の少ない市区町村 15（10店以上）===", file=sys.stderr)
    small = [x for x in locs if x[1][0] >= 10][-15:]
    for (reg, loc), (n, m) in small:
        print(f"  {reg[:6]:8}{loc[:12]:14}{n:>7,}店  辞書落ち {m:>6,} "
              f"= {m/n*100:5.2f}%", file=sys.stderr)

    # --- 密度帯ごとの比較（決め方を明記する）--------------------------------
    # 市区町村を店数で5分位に分け、各分位の辞書落ち率を出す。
    # 分位は「市区町村の数」が等しくなるように切る（店数で切ると上位が1つになる）。
    ordered = [x for x in locs if x[1][0] >= 10]
    q = max(1, len(ordered) // 5)
    print(f"\n=== 市区町村を店数で5分位（多い順）===", file=sys.stderr)
    bands = []
    for i in range(5):
        chunk = ordered[i * q: (i + 1) * q] if i < 4 else ordered[4 * q:]
        n = sum(v[0] for _, v in chunk)
        m = sum(v[1] for _, v in chunk)
        rng = f"{chunk[0][1][0]:,}〜{chunk[-1][1][0]:,}店" if chunk else "-"
        bands.append({"band": i + 1, "n_localities": len(chunk), "n_places": n,
                      "n_multi": m, "rate": m / max(n, 1) * 100, "range": rng})
        print(f"  第{i+1}分位 市区町村 {len(chunk):>4} ({rng:>16})  "
              f"店 {n:>8,}  **辞書落ち {m/max(n,1)*100:5.2f}%**", file=sys.stderr)

    top, bot = bands[0]["rate"], bands[-1]["rate"]
    print(f"\n  **最も店が多い帯 {top:.2f}% ／ 最も少ない帯 {bot:.2f}% "
          f"= {top/max(bot,0.01):.2f}倍**", file=sys.stderr)
    print(f"  KPI② は『1エリア×1カテゴリに distinct 5店』なので、"
          f"店の多いセルほど逆引きが効かないのは痛い。", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "dict_blindspot.json"
    p.write_text(json.dumps(
        {"n_places": len(rows), "n_names": len(pts), "n_multi": n_multi,
         "rate_all": n_multi / len(rows) * 100,
         "by_region": [{"region": k, "n": n, "multi": m, "rate": r}
                       for k, n, m, r in reg_rows],
         "top_localities": [{"region": a, "locality": b, "n": v[0], "multi": v[1],
                             "rate": v[1] / v[0] * 100}
                            for (a, b), v in locs[:60]],
         "bands": bands,
         "caveat": "「同名2箇所以上」由来の辞書落ちだけを見た。"
                   "ストップワード等の他の除外は含まない。経路存在率の上限の話であって"
                   "実効カバレッジではない。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
