#!/usr/bin/env python3
"""#1273 分母の中身: リンク無し層に**消費者向けでない施設**が何%混ざっているか

## なぜ

KPI① の分母は 1,132,482 店で、その 30.31% は IFAS/OSM にしか無い層である。
IFAS は**食品衛生法の営業許可台帳**であって、消費者向け飲食店の一覧ではない。
給食施設・製造工場・病院・学校がそのまま入っている。

`dish_media` は「ユーザーが行って食べる店の料理写真」なので、
**給食室の分母を 70% の分母に入れ続けるのは測定として正しくない可能性がある。**
これはオーナーが決めることだが、**決めるのに要るのは「何%か」という数字**である。

既に目視 n=60 で **16.7%（95%CI 5–28%）** と出しているが、幅が広すぎて
天井の計算に使えない。**n を増やして幅を詰める。**

## 測るもの

  1. **機械判定（下限）**: 非消費者向けの語を含む店名を全数で数える。
     regex は明らかなものしか拾えないので**下限**である
  2. **目視用の決定的標本 150 件**を出す（機械判定の見落としを拾うため）
  3. 層ごとの差（リンク無し層 vs Overture を含む層）

## この測定が言えないこと

  - 店名だけで判断している。**「〇〇食堂」が社員食堂か町の定食屋かは名前では割れない**
  - regex は下限。目視標本で埋める前提の数字である
  - 「消費者向けでない」＝「分母から外すべき」ではない。**それはオーナーの判断**

実行:
    python3 measure_nonconsumer_share.py --sample 150
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import random
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_channel_traversal import has_cjk, normalize_ja, normalize_latin  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
FIXTURES = HERE / "fixtures"

# `measure_longtail_posts_exist.py` と**同じ**regex（標本を揃えるため）
NON_RETAIL = re.compile(
    r"(セブン.?イレブン|ファミリーマート|ローソン|ミニストップ|デイリーヤマザキ|"
    r"セイコーマート|給食|小学校|中学校|高等学校|保育園|保育所|幼稚園|こども園|"
    r"大学|専門学校|養護学校|病院|医院|クリニック|診療所|老人|特別養護|介護|福祉|"
    r"製造|加工|工場|製パン|製麺|社員食堂|職員食堂|寮|事業所|"
    r"スーパー|マーケット|イオン(?!モール)|西友|イトーヨーカ|"
    r"高齢者住宅|サービス付き|図書館|ホール|ぷらざ|プラザ|会館|体育館|公民館|"
    r"美術館|博物館|資料館|市役所|区役所|町役場|センター$|株式会社)")


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
    ap.add_argument("--sample", type=int, default=150)
    args = ap.parse_args()
    csv.field_size_limit(10 ** 7)

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
                pk = (k, round(lat, 3), round(lon, 3))
                e = places.setdefault(pk, {"name": nm, "srcs": set(),
                                           "loc": (r.get("locality") or "").strip()})
                e["srcs"].add(src)

    rows = list(places.values())
    tail = [r for r in rows if "overture" not in r["srcs"]]
    head = [r for r in rows if "overture" in r["srcs"]]

    print(f"=== 統合後 {len(rows):,} 件 ===", file=sys.stderr)
    print(f"  リンク無し層（Overture に無い） {len(tail):,}", file=sys.stderr)
    print(f"  Overture を含む層               {len(head):,}", file=sys.stderr)

    print(f"\n=== 機械判定（**下限**）===", file=sys.stderr)
    stats = {}
    for label, pool in (("リンク無し層", tail), ("Overture 層", head), ("全体", rows)):
        n_hit = sum(1 for r in pool if NON_RETAIL.search(r["name"]))
        lo, hi = wilson(n_hit, len(pool))
        stats[label] = {"n": len(pool), "hit": n_hit, "rate": n_hit / max(len(pool), 1),
                        "ci": [lo, hi]}
        print(f"  {label:14} {n_hit:>7,} / {len(pool):>9,} = "
              f"**{n_hit/max(len(pool),1)*100:5.2f}%**", file=sys.stderr)

    # --- 目視用の標本 -------------------------------------------------------
    # #1273 【バグ】最初は「SHA-256 で並べて先頭 N」という決定的抽出にしていたが、
    #   先頭 150 の regex 率が **16.00%** と、母集団の 8.20% から 3.5σ ずれた。
    #   先頭 500 で 11.20%、2,000 で 6.45%、50,000 で 8.04% と**前方ほど偏る**。
    #   ハッシュ順の**前方だけ**を切るのは無作為抽出になっていない。
    #   固定 seed の `random.sample` に変え、標本自体を JSON に残して再現性を担保する。
    rnd = random.Random(20260816)
    smp = rnd.sample(tail, min(args.sample, len(tail)))
    n_regex_in_sample = sum(1 for r in smp if NON_RETAIL.search(r["name"]))
    print(f"\n=== 目視標本 {len(smp)} 件（リンク無し層から決定的抽出）===",
          file=sys.stderr)
    print(f"  うち regex が拾ったもの {n_regex_in_sample} = "
          f"{n_regex_in_sample/max(len(smp),1)*100:.2f}%", file=sys.stderr)
    print(f"  **残りを目視で判定して、regex の見落としを埋める**", file=sys.stderr)
    for i, r in enumerate(smp, 1):
        mark = "R" if NON_RETAIL.search(r["name"]) else " "
        print(f"  {i:>3}{mark} {r['name'][:40]:42} {r['loc'][:14]}", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "nonconsumer_share.json"
    p.write_text(json.dumps({
        "n_total": len(rows), "n_tail": len(tail), "n_head": len(head),
        "regex_stats": stats,
        "sample": [{"name": r["name"], "loc": r["loc"],
                    "regex_hit": bool(NON_RETAIL.search(r["name"]))} for r in smp],
        "n_regex_in_sample": n_regex_in_sample,
        "caveat": "regex は**下限**（明らかな語しか拾えない）。店名だけでは"
                  "『〇〇食堂』が社員食堂か町の定食屋か割れない。"
                  "『消費者向けでない』＝『分母から外すべき』ではなく、それはオーナー判断。",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
