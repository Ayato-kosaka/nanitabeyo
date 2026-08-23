#!/usr/bin/env python3
"""#1345 問い合わせの作り方で裾は変わるのか（オーナーの反論の検証）

## なぜ

「62,000検索が要る」という見積もりは、**裾 1.75 店/検索**という実測から出した。
だがその実測は **広いカテゴリ8種 × 大都市8エリア**での話で、
検索語空間（料理134種 × 都道府県47 = 6,298通り）の **1.0% しか見ていない**。

オーナーの指摘「料理カテゴリ駆動もあり得る（ピザ 山梨 とか）」は、
**私が測っていない領域を指している**ので、測る。

## 比べるもの

同じ抽出器（地名優先 v1）を、集め方だけ変えた2つのプールに当てる。

    A 広いカテゴリ × 大都市    64検索 / 818本   （既測）
    B **長尾の料理 × 非大都市県** 60検索 / ?本   （今回）

**裾（最後の8検索での新規店数）**を比べる。B が明らかに大きければ見積もりは下がる。

## この比較が言えないこと

  - 検索結果は実行ごとに変わる
  - **経路存在率**。目視 precision 70.0% を掛けて実効にすること
  - A と B は検索1回あたりの取得本数が違う（60 と 40）ので、
    **1検索あたり**の比較は取得本数の差を含む。**1本あたり**も併記する

実行:
    python3 measure_shorts_tail_compare.py
"""

from __future__ import annotations

import collections
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from measure_shorts_area_first_matcher import AreaIndex  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
PRECISION = 0.70            # out/shorts_area_first_hit_labels.json（14/20）


def analyse(idx, pool_path: Path, label: str) -> dict:
    pool = json.loads(pool_path.read_text(encoding="utf-8"))
    rows = pool["rows"]
    byq: dict[str, set] = collections.defaultdict(set)
    hits = 0
    for r in rows:
        m = idx.match(r["title"])
        if m:
            hits += 1
            byq[r["query"]].add(m["store"])
    seen: set = set()
    new_per_q = []
    for q in sorted(byq):
        b = len(seen)
        seen |= byq[q]
        new_per_q.append(len(seen) - b)
    tail = new_per_q[-8:] if len(new_per_q) >= 8 else new_per_q
    n_q = pool["n_queries"]
    out = {
        "label": label, "n_queries": n_q, "n_shorts": len(rows),
        "n_hits": hits, "rate": hits / len(rows) if rows else 0,
        "distinct": len(seen),
        "productive_queries": len(byq),
        "tail_new_per_productive_query": sum(tail) / len(tail) if tail else 0,
        "distinct_per_query_all": len(seen) / n_q,
        "distinct_per_1000_videos": len(seen) / len(rows) * 1000 if rows else 0,
    }
    print(f"\n=== {label} ===", file=sys.stderr)
    print(f"  検索 {n_q} / 動画 {len(rows)} / 当たり {hits} = "
          f"{out['rate']*100:.2f}%（実効 {out['rate']*PRECISION*100:.2f}%）", file=sys.stderr)
    print(f"  distinct 店 **{len(seen)}**（実効 約{len(seen)*PRECISION:.0f}店）",
          file=sys.stderr)
    print(f"  **1検索あたり {out['distinct_per_query_all']:.2f} 店**"
          f" / 1000本あたり {out['distinct_per_1000_videos']:.1f} 店", file=sys.stderr)
    print(f"  裾（当たりの出た最後の8検索の新規）{out['tail_new_per_productive_query']:.2f} 店",
          file=sys.stderr)
    return out


def main() -> None:
    idx = AreaIndex()
    a = analyse(idx, OUT_DIR / "shorts_identification_pool.json",
                "A 広いカテゴリ8 × 大都市8")
    b = analyse(idx, OUT_DIR / "shorts_longtail_pool.json",
                "B 長尾の料理 × 非大都市県")

    print("\n=== 比較 ===", file=sys.stderr)
    for k, lab in (("distinct_per_query_all", "1検索あたりの distinct 店"),
                   ("distinct_per_1000_videos", "1000本あたりの distinct 店"),
                   ("rate", "特定率")):
        ratio = (b[k] / a[k]) if a[k] else float("nan")
        print(f"  {lab:26} A {a[k]:8.2f} / B {b[k]:8.2f}  → **{ratio:.2f}倍**",
              file=sys.stderr)

    # 見積もりを引き直す
    target = 0.70 * 1_132_482
    for row in (a, b):
        eff = row["distinct_per_query_all"] * PRECISION
        need = target / eff if eff else float("inf")
        days = need / 100        # YouTube Data API 無償枠 = 1日100検索
        print(f"\n  {row['label']}: 実効 {eff:.2f} 店/検索 → "
              f"792,737店に **{need:,.0f} 検索**"
              f" = 無償枠(1日100検索)で **{days:,.0f} 日**", file=sys.stderr)

    p = OUT_DIR / "shorts_longtail_tail.json"
    p.write_text(json.dumps({"A": a, "B": b, "precision": PRECISION,
                             "caveat": "経路存在率に目視 precision 70.0% を掛けて実効に"
                                       "している。裾が減衰しない仮定なので**上限**である。"
                                       "A と B は1検索あたりの取得本数が違う（60 と 40）。"},
                            ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
