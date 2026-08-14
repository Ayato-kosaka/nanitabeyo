#!/usr/bin/env python3
"""#1273 同名グループの「本物のブランドか」を無料の手がかりで見分けられるか

## なぜ

同名グループの継承は 8.06pt あるが、目視 brand 率が 50.0% しか無いために
正当な継承先は 4.03pt に落ちる。**brand 率が上がれば継承先がそのまま増える。**

外部サービスは使えない（無料・規約順守）。**手元のデータだけ**で使える手がかりは:

  1. 規模帯（11+ は本物のチェーンが多いと実測済み）
  2. **屋号の長さ**（一般語は短い。「ゆ」「Pub」「大原」「monkey」）
  3. **地理的な散らばり**（グループ内の店の最大ペア距離）
     - 本物の全国チェーンは広く散る
     - 地場の複数店は近くに固まる
     - **無関係の同名も広く散る**ので、単独では効かないはず。確かめる

ドメインの共有は使えない（fixture に website URL は 3,000行の標本しか無い）。

## やること

1. 目視済み 60件（`out/samename_visual_labels.json`）に上記の特徴量を付け、
   **どれが brand と generic を分けるか**を見る
2. 分けられそうなら規則を決め、**目視していない次の 60件**（SHA-256順 61-120番）で
   その規則の precision を目視で確かめる

**ネットワークアクセスは一切しない。**

実行:
    python3 measure_brand_signal.py
"""

from __future__ import annotations

import collections
import hashlib
import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_channel_traversal import (  # noqa: E402
    STOPWORD_NAMES, has_cjk, normalize_ja, normalize_latin,
)
from measure_locality_backfill import haversine_km, load_rows  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"


def key_of(name: str) -> str:
    return normalize_ja(name) if has_cjk(name) else normalize_latin(name).strip()


def main() -> None:
    rows = []
    for r in load_rows():
        k = key_of(r["name"])
        if k:
            r["key"] = k
            rows.append(r)

    places: dict[str, set] = collections.defaultdict(set)
    for r in rows:
        places[r["key"]].add((round(r["lat"], 2), round(r["lon"], 2)))
    stop = {normalize_ja(s) for s in STOPWORD_NAMES} | {
        normalize_latin(s).strip() for s in STOPWORD_NAMES}
    multi = {k for k, p in places.items() if len(p) >= 2 and k not in stop}
    print(f"同名2箇所以上の屋号: {len(multi):,}", file=sys.stderr)

    name_of = {}
    for r in rows:
        if r["key"] in multi:
            name_of.setdefault(r["key"], r["name"])

    def spread_km(k: str) -> float:
        """グループ内の最大ペア距離。点が多いときは決定的に 40 点へ間引く。"""
        pts = sorted(places[k])
        if len(pts) > 40:
            step = len(pts) / 40
            pts = [pts[int(i * step)] for i in range(40)]
        best = 0.0
        for i in range(len(pts)):
            for j in range(i + 1, len(pts)):
                d = haversine_km(pts[i][0], pts[i][1], pts[j][0], pts[j][1])
                if d > best:
                    best = d
        return best

    ordered = sorted(multi, key=lambda k: hashlib.sha256(k.encode("utf-8")).hexdigest())

    labels = json.loads((OUT_DIR / "samename_visual_labels.json").read_text(
        encoding="utf-8"))
    label_by_name = {r["name"]: r["kind"] for r in labels["rows"]}

    feats = []
    for k in ordered[:120]:
        nm = name_of[k]
        feats.append({
            "name": nm, "key": k, "n_places": len(places[k]),
            "key_len": len(k), "spread_km": round(spread_km(k), 1),
            "label": label_by_name.get(nm),
        })

    labeled = [f for f in feats if f["label"]]
    print(f"\n目視済み {len(labeled)} 件で特徴量の分離を見る", file=sys.stderr)

    def show(title: str, buckets: dict) -> dict:
        print(f"\n  === {title} ===", file=sys.stderr)
        out = {}
        for b, items in sorted(buckets.items()):
            n = len(items)
            nb = sum(1 for x in items if x["label"] == "brand")
            out[str(b)] = {"n": n, "brand": nb, "rate": nb / max(n, 1)}
            print(f"    {b:>14} n={n:>3}  brand {nb:>3} = {nb / max(n,1)*100:>5.1f}%",
                  file=sys.stderr)
        return out

    by_size = collections.defaultdict(list)
    for f in labeled:
        by_size["2-3" if f["n_places"] <= 3 else
                "4-10" if f["n_places"] <= 10 else "11+"].append(f)
    r_size = show("規模帯", by_size)

    by_len = collections.defaultdict(list)
    for f in labeled:
        by_len["<=4字" if f["key_len"] <= 4 else
               "5-7字" if f["key_len"] <= 7 else "8字以上"].append(f)
    r_len = show("屋号の長さ（正規化後）", by_len)

    by_spread = collections.defaultdict(list)
    for f in labeled:
        by_spread["<50km" if f["spread_km"] < 50 else
                  "50-300km" if f["spread_km"] < 300 else ">=300km"].append(f)
    r_spread = show("グループの広がり（最大ペア距離）", by_spread)

    # 規則を決める（決め方を明記する）: 上の表で brand 率が最も高い側を採る
    def rule(f: dict) -> bool:
        return f["key_len"] >= 8 or f["n_places"] >= 11

    n_rule = sum(1 for f in labeled if rule(f))
    n_rule_brand = sum(1 for f in labeled if rule(f) and f["label"] == "brand")
    print(f"\n  === 規則「屋号8字以上 または 11箇所以上」（目視済み60件での成績）===",
          file=sys.stderr)
    print(f"    通した {n_rule} 件中 brand {n_rule_brand} = "
          f"{n_rule_brand / max(n_rule, 1) * 100:.1f}%"
          f"（全体の brand 率 50.0% に対して）", file=sys.stderr)

    fresh = [f for f in feats if not f["label"]]
    fresh_pass = [f for f in fresh if rule(f)]
    print(f"\n  === 未目視の次の {len(fresh)} 件（61-120番）===", file=sys.stderr)
    print(f"    規則を通した: {len(fresh_pass)} 件（この precision を目視で確かめる）",
          file=sys.stderr)
    for f in fresh_pass[:30]:
        print(f"      {f['name'][:26]:28} {f['n_places']:>4}箇所 "
              f"{f['key_len']:>3}字 広がり{f['spread_km']:>7.0f}km", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "brand_signal.json"
    out_path.write_text(
        json.dumps({"by_size": r_size, "by_len": r_len, "by_spread": r_spread,
                    "rule": "key_len>=8 or n_places>=11",
                    "rule_on_labeled": {"n": n_rule, "brand": n_rule_brand,
                                        "rate": n_rule_brand / max(n_rule, 1)},
                    "features": feats,
                    "fresh_pass": fresh_pass,
                    "caveat": "規則は目視済み60件を見て決めたので、同じ60件での成績は"
                              "過大評価。未目視の61-120番での目視が本番。"},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
