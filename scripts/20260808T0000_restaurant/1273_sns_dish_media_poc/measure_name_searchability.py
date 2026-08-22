#!/usr/bin/env python3
"""#1273 リンク無し層が届かないのは面が足りないからか、**名前で探せないから**か

## なぜ

r_N（リンク無し層の到達率）を3面すべて監査して 34.79% → 10.32〜18.16% に直した。
Bluesky という面を1本足しても r_N は上がらなかった。
**「面を増やせば届く」という筋が実測で否定された**ので、次の問いはこれである。

    リンク無し層が届かないのは、**そもそも名前で探せないから**ではないのか。

監査で見た偽陽性の顔ぶれがそれを示唆している。
『Syo』『Hira』『NAO』『farm』『uouo』『あかつき』『ムーラン』——
**短い / 一般語 / 同名多数**。これらは面をいくら増やしても当たらない。

## 測るもの（新しい取得はしない。fixture の全数）

`NameMatcher` の辞書構築は、名前が次のときに**その店を辞書から落とす**。

    短すぎる（日本語4字未満 / ラテン5字未満）/ 同名が2箇所以上 /
    地名・住所 / 容器（横丁・フードコート等）/ 料理カテゴリ語そのもの

**辞書から落ちた店は、店名を手がかりにするどの経路でも届かない。**
YouTube でも Misskey でも Bluesky でもブログでも同じである。

そこで層ごとに **「名前で探せる店の割合」** を全数で数える。

  1. Overture を含む層（リンク層）
  2. Overture に無い層（リンク無し層 = IFAS/OSM のみ）

## この測定が言えないこと

  - 「辞書に残った」＝「探せば見つかる」ではない。**上限**である
  - 落ちた理由の分類は `NameMatcher` の規則そのもの。規則が変われば数字も変わる
  - 同名判定は座標（小数2桁≒1km）で行っている。同一店の重複計上は排除済み

実行:
    python3 measure_name_searchability.py
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


def main() -> None:
    csv.field_size_limit(10 ** 7)
    m = NameMatcher()
    # #1273 【バグ】最初 `set(m.auto_ja.keys())` だけを辞書扱いにしていた。
    #   ラテン文字の店名は `auto_la` に入るので、**全部「探せない」に数えられ**、
    #   落ちた理由が付かず「（辞書に無い・理由不明）」が 8〜11% 出ていた。
    #   その 11% は実際には探せる店である。両方の automaton を合わせる。
    in_dict = None
    if hasattr(m.auto_ja, "keys") and hasattr(m.auto_la, "keys"):
        in_dict = set(m.auto_ja.keys()) | set(m.auto_la.keys())

    # オートマトンから鍵一覧が取れない実装のときは drop_reason の補集合で判定する
    def searchable(key: str) -> bool:
        if in_dict is not None:
            return key in in_dict
        return key not in m.drop_reason

    places: dict[tuple, dict] = {}
    for fn, src in (("overture_jp_food.csv", "overture"),
                    ("ifas_jp_food.csv", "ifas"), ("osm_jp_food.csv", "osm")):
        fp = FIXTURES / fn
        if not fp.exists():
            print(f"**{fn} が無い。数字を出さない。**", file=sys.stderr)
            raise SystemExit(2)
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
                e = places.setdefault((k, round(lat, 3), round(lon, 3)),
                                      {"key": k, "srcs": set()})
                e["srcs"].add(src)

    layers = {"リンク層（Overture を含む）": [], "リンク無し層（IFAS/OSM のみ）": []}
    for v in places.values():
        key = ("リンク層（Overture を含む）" if "overture" in v["srcs"]
               else "リンク無し層（IFAS/OSM のみ）")
        layers[key].append(v)

    out = {}
    print(f"\n=== 名前で探せる店の割合（全数）===", file=sys.stderr)
    for label, rows in layers.items():
        n = len(rows)
        ok = sum(1 for v in rows if searchable(v["key"]))
        reasons = collections.Counter(
            m.drop_reason.get(v["key"], "（辞書に無い・理由不明）")
            for v in rows if not searchable(v["key"]))
        out[label] = {"n": n, "searchable": ok, "rate": ok / max(n, 1),
                      "reasons": dict(reasons)}
        print(f"\n  **{label}** {n:,} 店", file=sys.stderr)
        print(f"    名前で探せる **{ok:,} = {ok/max(n,1)*100:.2f}%**", file=sys.stderr)
        for k, c in reasons.most_common(6):
            print(f"      落ちた理由 {k:22} {c:>7,} = {c/max(n,1)*100:5.2f}%",
                  file=sys.stderr)

    a = out["リンク層（Overture を含む）"]["rate"]
    b = out["リンク無し層（IFAS/OSM のみ）"]["rate"]
    print(f"\n=== 差 ===", file=sys.stderr)
    print(f"  リンク層 {a*100:.2f}% / リンク無し層 {b*100:.2f}% "
          f"= **{b/max(a,1e-9):.2f}倍**", file=sys.stderr)
    print(f"\n  **リンク無し層は、店名を手がかりにする経路が原理的に届かない店を "
          f"{(1-b)*100:.2f}% 抱えている。**", file=sys.stderr)
    print(f"  面（YouTube / Misskey / Bluesky / ブログ）をいくら増やしても、"
          f"ここは動かない。", file=sys.stderr)

    # 監査後の r_N と突き合わせる
    r_n_gate = 0.1537
    print(f"\n=== 監査後の r_N との整合 ===", file=sys.stderr)
    print(f"  名前で探せる割合（リンク無し層）      **{b*100:.2f}%**", file=sys.stderr)
    print(f"  料理語ゲート後の r_N                  **{r_n_gate*100:.2f}%**",
          file=sys.stderr)
    print(f"  → r_N の上限は「名前で探せる割合」で頭打ちになる。"
          f"{'整合する' if r_n_gate <= b else '**矛盾する（要調査）**'}", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "name_searchability.json"
    p.write_text(json.dumps({
        "layers": out, "ratio_nolink_over_link": b / max(a, 1e-9),
        "r_n_after_gate": r_n_gate, "consistent": r_n_gate <= b,
        "caveat": "『辞書に残った』＝『探せば見つかる』ではない（上限）。"
                  "落ちた理由の分類は NameMatcher の規則そのもので、規則が変われば数字も変わる。"
                  "同名判定は座標（小数2桁≒1km）で行い、同一店の重複計上は排除済み。",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
