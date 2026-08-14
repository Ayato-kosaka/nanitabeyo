#!/usr/bin/env python3
"""#1273 「写真」と「どのカテゴリを出す店か」を切り離すと、セル充足がどれだけ伸びるか

## 発想の転換

ここまでの全ての試みは **「その店の料理写真を見つける」** という一点に賭けていた。
だから天井が写真の有無で決まり、実効 18.55-20.79% で止まっている。

しかしスキーマを見ると、`dishes` は `@@unique([restaurant_id, category_id])` で
**「店 × カテゴリ」そのもの**であり、`dish_media` が無くても行として存在できる。
写真が無いと表示されないのは `dish-media.repository.ts:211` の
`JOIN dish_media dm ON dm.dish_id = d.id`（INNER JOIN）による**表示側の制約**であって、
データ構造の制約ではない。

そして #1273 §32 の KPI は「1セルに **distinct 5店**」であって「写真5枚」ではない。

**「この店はラーメンを出す」という事実は、「その店のラーメンの写真」より遥かに集めやすい。**
メニュー表はテキストで、どの飲食店のサイトにも載っている。

## 測るもの

既に取得済みのページ（`out/own-website-images.json`、600店中153店が取得成功）に対して、
2つの基準で「カテゴリが付いた店」を数える。**新しいページ取得は一切しない。**

- (a) 現行: 画像ゲート（min200 + 食語）を通った画像の alt/context からカテゴリ
- (b) 提案: 画像を一切問わず、ページのテキスト（alt/context）だけからカテゴリ

(b) は本来なら本文全体を使うべきだが、キャッシュには画像周辺テキストしか無い。
**つまり (b) の数字は本当の下限**であり、メニューページ本文を読めばもっと増える。

実行:
    python3 measure_menu_text_route.py
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


def main() -> None:
    path = OUT_DIR / "own-website-images.json"
    if not path.exists():
        raise SystemExit(f"#1304 の測定結果が無い: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    matcher = CategoryMatcher()

    n_sample = data["sample_size"]
    fetch_ok = [r for r in data["results"] if not r.get("fail_reason")]

    img_stores = txt_stores = 0
    img_cats = txt_cats = 0
    for row in fetch_ok:
        images = [
            v for v in row["verified"]
            if v.get("ok")
            and min(v.get("w") or 0, v.get("h") or 0) >= MIN_DISH_IMAGE_PX
            and v.get("food_word")
        ]
        from_image = set()
        for v in images:
            for cat in matcher.match((v.get("alt") or "") + " " + (v.get("context") or "")):
                from_image.add(cat["dish_category_id"])
        from_text = set()
        for cand in row.get("candidates", []):
            for cat in matcher.match((cand.get("alt") or "") + " " + (cand.get("context") or "")):
                from_text.add(cat["dish_category_id"])
        if from_image:
            img_stores += 1
            img_cats += len(from_image)
        if from_text:
            txt_stores += 1
            txt_cats += len(from_text)

    img_k = img_cats / max(img_stores, 1)
    txt_k = txt_cats / max(txt_stores, 1)
    img_cov = img_stores / n_sample
    txt_cov = txt_stores / n_sample

    print(f"取得成功した店: {len(fetch_ok)} / {n_sample}", file=sys.stderr)
    print(f"\n{'':38}{'店数':>6}{'600に対して':>12}{'店あたりカテゴリ':>16}", file=sys.stderr)
    print(f"(a) 画像ゲートを通ってカテゴリが付いた  {img_stores:>6}"
          f"{img_cov * 100:>11.2f}%{img_k:>15.2f}", file=sys.stderr)
    print(f"(b) テキストだけでカテゴリが付いた      {txt_stores:>6}"
          f"{txt_cov * 100:>11.2f}%{txt_k:>15.2f}", file=sys.stderr)
    print(f"\n倍率: 店数 {txt_cov / max(img_cov, 1e-9):.2f}x / "
          f"店あたりカテゴリ {txt_k / max(img_k, 1e-9):.2f}x "
          f"= セル充足への寄与 {(txt_cov * txt_k) / max(img_cov * img_k, 1e-9):.2f}x",
          file=sys.stderr)

    # #1273 §32 のセル充足に落とす。1セル×1カテゴリあたりの期待店舗数。
    print(f"\n=== §32 セル充足（1セル×1カテゴリの期待店舗数、目標 N>={CELL_TARGET}）===",
          file=sys.stderr)
    print(f"{'tier':10}{'母集団店/セル':>13}{'(a)画像':>10}{'(b)テキスト':>12}"
          f"{'必要k(cov100%)':>15}", file=sys.stderr)
    rows = []
    for tier, n_in_cell in TIERS.items():
        a = n_in_cell * img_cov * (img_k / N_CATEGORIES)
        b = n_in_cell * txt_cov * (txt_k / N_CATEGORIES)
        need_k = CELL_TARGET * N_CATEGORIES / n_in_cell
        rows.append({"tier": tier, "stores_in_cell": n_in_cell,
                     "expected_image": a, "expected_text": b, "need_k_at_full_cov": need_k})
        print(f"{tier:10}{n_in_cell:>13.2f}{a:>10.3f}{b:>12.3f}{need_k:>15.1f}",
              file=sys.stderr)

    print(
        f"\n※ (b) はキャッシュに画像周辺テキストしか無いので**本当の下限**。"
        f"メニューページ本文を読めばさらに増える。\n"
        f"※ ただし表示側は `dish-media.repository.ts:211` が dish_media を INNER JOIN して"
        f"いるため、\n"
        f"   写真の無い dish は現状のアプリでは出ない。**プロダクト判断が要る。**",
        file=sys.stderr,
    )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "menu_text_route.json"
    out_path.write_text(
        json.dumps(
            {
                "n_sample": n_sample,
                "n_fetch_ok": len(fetch_ok),
                "image_gated": {"stores": img_stores, "coverage": img_cov, "k": img_k},
                "text_only": {"stores": txt_stores, "coverage": txt_cov, "k": txt_k},
                "cell_fill": rows,
                "caveat": "text_only はキャッシュ済みの画像周辺テキストのみを使った下限。"
                          "表示には dish_media の INNER JOIN を外すプロダクト判断が要る。",
            },
            ensure_ascii=False, indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
