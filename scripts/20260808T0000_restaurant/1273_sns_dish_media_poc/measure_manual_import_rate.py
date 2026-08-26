#!/usr/bin/env python3
"""#1273 人力取り込み（add-record 導線）の**1件あたり所要時間と純増**を測る

## なぜこれが要るのか

このセッションで出した天井 **12.81〜15.81%** は、**自動で取得できる範囲**の話だった。
`add-record` の人力取り込みは、**その上限に縛られない**。`media_path` は NULL で
実体を保存せず、`render_type='external_embed'` と `canonical_url` を持つだけなので、
**権利面はクリアしてある**（実装で確認済み）。

代わりに縛るのは**時間**である。だから測るべき量が変わる。

    これまで: 「無料で自動的に何%取れるか」
    これから: **「1件あたり何秒か」「1件が何店の純増になるか」**

## 換算表（先に置いておく。実測がどの行に落ちるかで判断が決まる）

| 1件あたり | 792,737店（70%）に必要 | 1pt 上げるのに必要 |
|---|---|---|
| 20秒 | 551人日 | **8人日** |
| 30秒 | 826人日 | **12人日** |
| 60秒 | 1,652人日 | **24人日** |

※ 1件が必ず新規の店になる前提。重複を入れると 1.6 倍（Shorts の distinct/hits = 0.61 を流用）。
**その 0.61 自体をこの測定で置き換える。**

## 測るもの

20件を実際に登録して、1件ずつ記録する。

  1. **所要秒数**（URL を開いてから保存が完了するまで）
  2. **店を特定できたか**、その手段（候補から選べた / 手入力した / できなかった）
  3. **料理カテゴリを特定できたか**
  4. **その店が既に DB にあったか**（＝純増か重複か）

## この測定が言えないこと

  - 20件なので幅は広い。**時間の中央値**を見る（平均は外れ値に引かれる）
  - 慣れると速くなる。**最初の数件は遅い**ので、それも記録に残す
  - 「焼き鳥」1カテゴリの話。カテゴリによって特定しやすさは変わる

実行:
    python3 measure_manual_import_rate.py build     # 記入シートを作る
    python3 measure_manual_import_rate.py analyze   # 集計する
"""

from __future__ import annotations

import argparse
import collections
import csv
import math
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
SHEET = OUT_DIR / "manual_import_rate_worksheet.csv"
POP = 1_132_482
TARGET = 0.70 * POP


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def build(_a) -> None:
    cols = ["no", "post_url", "seconds", "store_found", "store_method",
            "category_found", "is_new_store", "note"]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with SHEET.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for i in range(1, 21):
            w.writerow({"no": i, "post_url": "", "seconds": "", "store_found": "",
                        "store_method": "", "category_found": "",
                        "is_new_store": "", "note": ""})
    print(f"-> {SHEET.name}  20行", file=sys.stderr)
    print("""
記入のしかた（1行 = 1投稿）

  post_url        取り込んだ投稿の URL
  seconds         **URL を開いてから保存完了までの秒数**（ストップウォッチ）
  store_found     yes / no
  store_method    candidate（候補から選べた） / manual（店名検索で手入力） / none
  category_found  yes / no
  is_new_store    new（DB に無かった） / dup（既にあった） / unknown
  note            迷った点・詰まった点。**最初の数件は遅くなるので、それも書く**
""", file=sys.stderr)


def analyze(_a) -> None:
    if not SHEET.exists():
        print(f"{SHEET} がありません。先に build してください。", file=sys.stderr)
        return
    rows = [r for r in csv.DictReader(SHEET.open(encoding="utf-8"))
            if r["seconds"].strip()]
    if not rows:
        print("まだ1件も記入されていません。", file=sys.stderr)
        return
    secs = [float(r["seconds"]) for r in rows]
    n = len(rows)
    med = statistics.median(secs)
    print(f"=== 記入済み {n}/20 件 ===", file=sys.stderr)
    print(f"  所要秒数  中央値 **{med:.1f}秒**  / 平均 {statistics.mean(secs):.1f}秒"
          f"  / 最短 {min(secs):.0f} 最長 {max(secs):.0f}", file=sys.stderr)
    if n >= 10:
        first, last = secs[: n // 2], secs[n // 2:]
        print(f"  前半 {statistics.median(first):.1f}秒 → 後半 "
              f"{statistics.median(last):.1f}秒（慣れの効果）", file=sys.stderr)

    k = sum(1 for r in rows if r["store_found"].strip() == "yes")
    lo, hi = wilson(k, n)
    print(f"\n  **店を特定できた {k}/{n} = {k/n*100:.1f}%**"
          f"  95%CI {lo*100:.1f}〜{hi*100:.1f}%", file=sys.stderr)
    m = collections.Counter(r["store_method"].strip() for r in rows if r["store_method"].strip())
    if m:
        print(f"  特定の手段: {dict(m)}", file=sys.stderr)
    c = sum(1 for r in rows if r["category_found"].strip() == "yes")
    print(f"  料理カテゴリを特定できた {c}/{n} = {c/n*100:.1f}%", file=sys.stderr)

    new = sum(1 for r in rows if r["is_new_store"].strip() == "new")
    known = sum(1 for r in rows if r["is_new_store"].strip() in ("new", "dup"))
    if known:
        rate = new / known
        print(f"  **純増率 {new}/{known} = {rate*100:.1f}%**"
              f"（Shorts から流用していた 61% を置き換える値）", file=sys.stderr)
    else:
        rate = 0.61
        print(f"  純増率は未記入。Shorts の 61% を流用して計算する", file=sys.stderr)

    eff = med / max(rate, 1e-9)          # 純増1店あたりの実所要秒数
    print(f"\n=== 換算（中央値 {med:.1f}秒・純増率 {rate*100:.0f}% で引く）===",
          file=sys.stderr)
    print(f"  **純増1店あたり {eff:.1f}秒**", file=sys.stderr)
    for label, target in (("1pt 上げる", 0.01 * POP), ("70% に到達", TARGET)):
        h = target * eff / 3600
        print(f"  {label:12} {target:>9,.0f}店 → {h:>9,.0f}時間 = "
              f"**{h/8:>7,.0f}人日**", file=sys.stderr)
    print("\n  ※ 1人で回す前提の数字である。`add-record` は匿名ユーザーでも書けるので、"
          "\n    **利用者が増えれば分母も増える**。その場合は『1人あたり何件』で読み直すこと。",
          file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("build")
    sub.add_parser("analyze")
    a = ap.parse_args()
    {"build": build, "analyze": analyze}[a.cmd](a)


if __name__ == "__main__":
    main()
