#!/usr/bin/env python3
"""#1273 「店名」経路と「サイト本文」経路を重ねると、dish 行のカバレッジと k はどこまで行くか

## なぜ 2 つを重ねるのか

- 店名経路（`measure_name_category.py`）: **全 1,244,029 行の 24.10%** にカテゴリが付く。
  取得コスト 0、リンクの有無に依存しない（リンク有り 25.46% / リンク無し 21.61%、差 3.85pt）。
  ただし **k = 1.03**。屋号は1ジャンルしか名乗らないので当然である。
- サイトのテキスト経路（`measure_menu_text_route.py`）: 600店標本の **20.17%**、**k = 2.80**。
  こちらは k が高いが、自社サイトを持つ店にしか効かない。

**カバレッジは店名が、k はサイト本文が稼ぐ。**性質が違うので重ねる意味がある。
§32 の律速は k（urban は cov100% でも k>=3.4 が要る）なので、両方要る。

## 測るもの

同一の 600 店標本の上で、3 通りの dish 行カバレッジと k:

  (1) 店名だけ
  (2) サイトのテキストだけ（`measure_menu_text_route.py` と同じ計算）
  (3) 和集合

**新しいネットワークアクセスはしない**（`out/own-website-images.json` のキャッシュのみ）。

## この数字が意味しないこと

これは **dish 行**（店×カテゴリ）のカバレッジであって、**dish_media**（写真/動画）
ではない。要求① の 70% は dish_media の話なので、この経路はそこには効かない。
効くのは #1273 §32 のセル充足（1セルに distinct 5店）であり、
かつ `dish-media.repository.ts:211` の INNER JOIN を外すプロダクト判断が要る。

実行:
    python3 measure_dish_row_union.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from dish_category_matcher import CategoryMatcher

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

MIN_DISH_IMAGE_PX = 200
# 1kmセル内の母集団店舗数（REPORT の密度センサス実測）。
TIERS = {"urban": 197.54, "suburban": 27.45, "rural": 5.66}
N_CATEGORIES = 134
CELL_TARGET = 5

# 全数実測（out/name_category.json）。600店標本の店名カバレッジがこれとずれないかを見る。
NAME_ROUTE_FULL_POPULATION = 0.2410


def summarize(label: str, sets: list[set[str]], n_sample: int) -> dict:
    hit = [s for s in sets if s]
    k = sum(len(s) for s in hit) / max(len(hit), 1)
    return {"label": label, "stores": len(hit),
            "coverage": len(hit) / max(n_sample, 1), "k": k}


def main() -> None:
    path = OUT_DIR / "own-website-images.json"
    if not path.exists():
        raise SystemExit(f"#1304 の測定結果が無い: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    matcher = CategoryMatcher()

    n_sample = data["sample_size"]

    # 【自戒】`own-website-images.json` の `results` は 600 店ではなく
    # **website を持つ 305 店だけ**である。ここを 600 と思い込んで店名経路を回したら
    # 14.50% という、全数実測 24.10% と 9.6pt もずれた値が出た。
    # 店名は 600 店全部にあるので、標本の出所（supply_ceiling）から全件引く。
    src = OUT_DIR / "supply_ceiling_2026-08-13.json"
    if not src.exists():
        raise SystemExit(f"600店標本の出所が無い: {src}")
    sample600 = [r["restaurant"] for r in json.loads(src.read_text(encoding="utf-8"))["results"]]
    if len(sample600) != n_sample:
        raise SystemExit(f"標本数が合わない: {len(sample600)} != {n_sample}")
    by_id = {r["id"]: r for r in data["results"]}

    from_name: list[set[str]] = []
    from_text: list[set[str]] = []
    from_image: list[set[str]] = []
    union: list[set[str]] = []

    for rest in sample600:
        name_cats = {c["dish_category_id"] for c in matcher.match(rest.get("name") or "")}

        text_cats: set[str] = set()
        img_cats: set[str] = set()
        row = by_id.get(rest["id"])
        if row and not row.get("fail_reason"):
            for cand in row.get("candidates", []):
                blob = (cand.get("alt") or "") + " " + (cand.get("context") or "")
                for c in matcher.match(blob):
                    text_cats.add(c["dish_category_id"])
            for v in row.get("verified", []):
                if not (v.get("ok") and v.get("food_word")):
                    continue
                if min(v.get("w") or 0, v.get("h") or 0) < MIN_DISH_IMAGE_PX:
                    continue
                blob = (v.get("alt") or "") + " " + (v.get("context") or "")
                for c in matcher.match(blob):
                    img_cats.add(c["dish_category_id"])

        from_name.append(name_cats)
        from_text.append(text_cats)
        from_image.append(img_cats)
        union.append(name_cats | text_cats)

    results = [
        summarize("(0) 写真ゲート経由（現行）", from_image, n_sample),
        summarize("(1) 店名だけ", from_name, n_sample),
        summarize("(2) サイトのテキストだけ", from_text, n_sample),
        summarize("(3) 和集合 = 店名 ∪ テキスト", union, n_sample),
    ]

    print(f"標本 {n_sample} 店（うち website 有り {len(data['results'])} 店 / "
          f"取得成功 {sum(1 for r in data['results'] if not r.get('fail_reason'))} 店）\n",
          file=sys.stderr)
    print(f"{'':32}{'店数':>6}{'カバレッジ':>12}{'k':>8}{'セル寄与(cov*k)':>16}",
          file=sys.stderr)
    base = results[0]["coverage"] * results[0]["k"]
    for r in results:
        contrib = r["coverage"] * r["k"]
        r["cell_contribution"] = contrib
        r["vs_image_route"] = contrib / max(base, 1e-9)
        print(f"{r['label']:32}{r['stores']:>6}{r['coverage'] * 100:>11.2f}%{r['k']:>8.2f}"
              f"{contrib / max(base, 1e-9):>15.2f}x", file=sys.stderr)

    name_cov = results[1]["coverage"]
    print(f"\n=== 検算: 店名経路は全数と整合するか ===", file=sys.stderr)
    print(f"  600店標本 {name_cov * 100:.2f}%  vs  全 1,244,029 行 "
          f"{NAME_ROUTE_FULL_POPULATION * 100:.2f}%  "
          f"（差 {abs(name_cov - NAME_ROUTE_FULL_POPULATION) * 100:.2f}pt）", file=sys.stderr)

    # ---- §32 セル充足 ----
    print(f"\n=== §32 セル充足（1セル×1カテゴリの期待店舗数、目標 N>={CELL_TARGET}）===",
          file=sys.stderr)
    print(f"{'tier':10}{'母集団店/セル':>13}"
          + "".join(f"{r['label'][:10]:>12}" for r in results), file=sys.stderr)
    cell_rows = []
    for tier, n_in_cell in TIERS.items():
        vals = [n_in_cell * r["coverage"] * (r["k"] / N_CATEGORIES) for r in results]
        cell_rows.append({"tier": tier, "stores_in_cell": n_in_cell,
                          "expected": {r["label"]: v for r, v in zip(results, vals)}})
        print(f"{tier:10}{n_in_cell:>13.2f}" + "".join(f"{v:>12.3f}" for v in vals),
              file=sys.stderr)

    u = results[3]
    need_k = CELL_TARGET * N_CATEGORIES / TIERS["urban"] / max(u["coverage"], 1e-9)
    print(f"\n  和集合の実測 k = {u['k']:.2f}。urban で N>={CELL_TARGET} を満たすには "
          f"カバレッジ {u['coverage'] * 100:.2f}% のもとで k >= {need_k:.1f} が要る。",
          file=sys.stderr)
    print(f"  → {'達成' if u['k'] >= need_k else '**未達**'}", file=sys.stderr)

    print(
        "\n※ これは dish 行（店×カテゴリ）のカバレッジであって dish_media ではない。\n"
        "  要求① の 70% は dish_media の話なので、この経路はそこには効かない。\n"
        "※ サイト経路の値は `own-website-images.json` のキャッシュ由来で、\n"
        "  キャッシュは 600 店中 153 店しか取得できていない（環境の 403 を含む）。\n"
        "  つまりサイト経路の寄与は**下限**である。",
        file=sys.stderr,
    )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "dish_row_union.json"
    out_path.write_text(
        json.dumps({"n_sample": n_sample, "routes": results, "cell_fill": cell_rows,
                    "urban_required_k": need_k,
                    "name_route_full_population": NAME_ROUTE_FULL_POPULATION,
                    "caveat": "dish 行のカバレッジであり dish_media ではない。"
                              "サイト経路はキャッシュ 153/600 由来の下限。"},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
