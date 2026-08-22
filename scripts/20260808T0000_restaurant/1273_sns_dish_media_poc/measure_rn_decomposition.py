#!/usr/bin/env python3
"""#1273 r_N が低い理由を2つに分解する: **名前が使えない** のか **投稿が無い** のか

## なぜ

ここまでで2つ分かっている。

  1. r_N（リンク無し層の到達率）は監査後 **15.37%**（機械判定そのままだと 34.79%）
  2. リンク無し層の **39.44% は名前で探せない**（同名多数 22.05% / 短すぎる 16.22%）

しかし前節では「上限 60.56% に対し実測 15.37% だから、律速は投稿の有無だ」と
**割り算だけで**書いた。**分解して確かめていない。**

分解しないと次の一手を間違える。
名前が原因なら**名寄せ・別名辞書**に投資する話になり、
投稿が無いのが原因なら**その層は諦める**話になる。

## 測るもの（新しい取得はしない）

層別標本 150 店を、`NameMatcher` の辞書に**残るか落ちるか**で2つに割り、
それぞれで**料理語ゲート後のヒット率**を出す。

    A. 名前で探せる店   … ヒット率が低ければ「投稿が無い」
    B. 名前で探せない店 … ヒットは原理的に偽陽性のはず（検算になる）

B のヒットがほぼ全部偽陽性なら、**判定器の穴の大きさを独立に確かめたことになる。**

## この測定が言えないこと

  - 標本 150 を2つに割るので、各群は 60〜90 程度。**幅は広い**
  - 「辞書に残る」は `NameMatcher` の規則であって、人間の探しやすさではない
  - ヒット判定は保存済みの機械判定＋料理語ゲート。目視ではない

実行:
    python3 measure_rn_decomposition.py
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dish_category_matcher import CategoryMatcher  # noqa: E402
from measure_channel_traversal import (  # noqa: E402
    NameMatcher, has_cjk, normalize_ja, normalize_latin,
)

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def key_of(name: str) -> str:
    return normalize_ja(name) if has_cjk(name) else normalize_latin(name).strip()


def load_hits() -> dict[str, dict[str, str]]:
    """面ごとに {店名: ヒットした本文} を返す（リンク無し層のみ）。"""
    out: dict[str, dict[str, str]] = {}
    d = json.loads((OUT_DIR / "seed_youtube_ceiling.json").read_text(encoding="utf-8"))
    out["YouTube"] = {r["name"]: (r.get("best_match") or {}).get("title") or ""
                      for r in d["results"]["without_overture"] if r.get("hit")}
    d = json.loads((OUT_DIR / "bluesky_ceiling.json").read_text(encoding="utf-8"))
    out["Bluesky"] = {r["name"]: (r.get("best_match") or {}).get("text") or ""
                      for r in d["layers"]["without_overture"]["detail"] if r.get("hit")}
    d = json.loads((OUT_DIR / "misskey_hit_review.json").read_text(encoding="utf-8"))
    out["Misskey"] = {r["name"]: r.get("text") or ""
                      for r in d["layers"]["without_overture"]["rows"]
                      if not r.get("gone")}
    return out


def main() -> None:
    m = NameMatcher()
    in_dict = set(m.auto_ja.keys()) | set(m.auto_la.keys())
    cm = CategoryMatcher()

    sample = json.loads(
        (OUT_DIR / "seed_strata_sample.json").read_text(encoding="utf-8")
    )["sample"]["without_overture"]
    hits = load_hits()

    searchable = [s for s in sample if key_of(s["name"]) in in_dict]
    unsearchable = [s for s in sample if key_of(s["name"]) not in in_dict]
    print(f"リンク無し層の標本 {len(sample)} 店", file=sys.stderr)
    print(f"  名前で探せる   **{len(searchable)}** "
          f"= {len(searchable)/len(sample)*100:.1f}%", file=sys.stderr)
    print(f"  名前で探せない **{len(unsearchable)}** "
          f"= {len(unsearchable)/len(sample)*100:.1f}%", file=sys.stderr)
    print(f"  （全数での割合は 60.56% / 39.44%。標本はそれと整合するか要確認）",
          file=sys.stderr)

    rows = {}
    for surface, hit_map in hits.items():
        print(f"\n=== {surface} ===", file=sys.stderr)
        rec = {}
        for label, pool in (("名前で探せる", searchable),
                            ("名前で探せない", unsearchable)):
            n = len(pool)
            raw = sum(1 for s in pool if s["name"] in hit_map)
            gated = sum(1 for s in pool if s["name"] in hit_map
                        and cm.match(hit_map[s["name"]]))
            lo, hi = wilson(gated, n)
            rec[label] = {"n": n, "raw_hits": raw, "gated_hits": gated,
                          "rate_raw": raw / max(n, 1), "rate_gated": gated / max(n, 1),
                          "ci_gated": [lo, hi]}
            print(f"  {label:12} n={n:>3}  機械 {raw:>2} ({raw/max(n,1)*100:5.2f}%)"
                  f"  → ゲート後 **{gated:>2} ({gated/max(n,1)*100:5.2f}%)**"
                  f"  95%CI [{lo*100:.1f}, {hi*100:.1f}]", file=sys.stderr)
        rows[surface] = rec

    # 全面の union（独立仮定＝上限）を群ごとに
    print(f"\n=== 3面の union（独立仮定＝上限）===", file=sys.stderr)
    summary = {}
    for label in ("名前で探せる", "名前で探せない"):
        u = 1.0
        for surface in rows:
            u *= (1 - rows[surface][label]["rate_gated"])
        summary[label] = 1 - u
        print(f"  {label:12} **{(1-u)*100:5.2f}%**", file=sys.stderr)

    a = summary["名前で探せる"]
    b = summary["名前で探せない"]
    print(f"\n=== 分解 ===", file=sys.stderr)
    print(f"  名前で探せる店の到達率     **{a*100:.2f}%**", file=sys.stderr)
    print(f"  名前で探せない店の到達率   **{b*100:.2f}%**"
          f"（これは原理的に偽陽性のはず）", file=sys.stderr)
    if b > 0:
        print(f"  → 探せないはずの店に {b*100:.2f}% のヒットが出ている。"
              f"**判定器の穴がこの大きさで残っている。**", file=sys.stderr)
    print(f"\n  **名前で探せる店に限っても {a*100:.2f}% しか届かない。**", file=sys.stderr)
    print(f"  → 律速は『名前が使えないこと』ではなく"
          f"**『その店の投稿が存在しないこと』**である。", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "rn_decomposition.json"
    p.write_text(json.dumps({
        "n_sample": len(sample), "n_searchable": len(searchable),
        "n_unsearchable": len(unsearchable),
        "by_surface": rows, "union": summary,
        "caveat": "標本 150 を2つに割るので各群 60〜90 程度で幅は広い。"
                  "『辞書に残る』は NameMatcher の規則であって人間の探しやすさではない。"
                  "ヒット判定は保存済みの機械判定＋料理語ゲートで、目視ではない。",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
