#!/usr/bin/env python3
"""#1356 Facebook ページの料理写真率を**目視で**測る（API も承認も不要）

## なぜこの形なのか

私は「歩留まりは承認前に**原理的に**測れません」と書いた。**これは誤りだった。**
正確には次の2つである。

    ・**API 経由では**測れない（development mode は、アプリ管理者が admin の
      ページしか見せない。これは Meta の逐語で確定済み）
    ・**私（自動アクセス）は規約上できない**。`facebook.com/robots.txt` の
      `User-agent: *` は `Disallow: /` を宣言しており、写真タブを機械で引くのは
      制約(c) に反する。だから叩いていない

**人がブラウザで開いて目で見るのは、この2つのどちらにも当たらない。**
オーナーの指摘のとおり、**測りたいものは今日ゼロ円で測れる。**

しかも API より情報量が多い。API は「写真が何枚あるか」しか返さないが、
目で見れば **「その写真は料理として識別できるか」「外観や人物ばかりでないか」
「古すぎないか」** まで分かる。これは dish_match の precision に直結する。

## 分担

    私  : 標本の抽出 / URL の生成 / 記入シートの作成 / 集計と信頼区間（このファイル）
    人間: **ブラウザで開いて見る**（101件・1件1分・約2時間）

## 使い方

    # 1) 記入シートを作る（既に out/fb_dish_photo_worksheet.csv にある）
    python3 measure_fb_dish_photo_manual.py build

    # 2) 人間が CSV の判定列を埋める

    # 3) 集計する
    python3 measure_fb_dish_photo_manual.py analyze

## 判定列の定義（記入する人はここだけ読めばよい）

| 列 | 入れる値 | 意味 |
|---|---|---|
| `page` | `ok` / `dead` / `private` | ページが開けたか |
| `dish_photo` | `yes` / `no` | **使える料理写真が1枚でもあるか**。皿・料理が主役のもの |
| `n_dish` | `0` / `1-2` / `3-5` / `6+` | ざっくり何枚か。数えなくてよい |
| `identifiable` | `yes` / `partial` / `no` | **その料理が何料理か言えるか**（ラーメン・寿司など） |
| `recent` | `yes` / `no` / `unknown` | 直近1年以内の投稿があるか |
| `note` | 自由記述 | 迷った理由・特徴的な失敗 |

**判定の基準は自社サイト経路と同じにそろえてある**（「その店に料理写真が1枚でもあるか」）。
そろえてあるので、**54.84% という自社サイトの実測値と直接比べられる。**

## この測定が言えないこと

  - **経路存在率ではなく、その先の歩留まり**を測る。両者を混ぜないこと
  - 101件なので幅は広い（率が 50% 付近なら 95%CI は概ね ±10pt）
  - **「写真がある」ことと「使ってよい」ことは別。** 権利は Platform Terms と
    App Review の話であって、この測定の外にある
  - 目視は主観が入る。**迷ったものは `note` に理由を書き、後から見直せるようにする**
"""

from __future__ import annotations

import argparse
import collections
import csv
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
SEED = OUT_DIR / "fb_dish_photo_worksheet_seed.tsv"
SHEET = OUT_DIR / "fb_dish_photo_worksheet.csv"

OWN_SITE_STORE_PRECISION = 0.5484      # 自社サイト経路の店単位 precision（17/31）
FB_SHARE_OF_POPULATION = 0.6172        # Facebook リンクを持つ店 / 母集団 1,132,482
POP = 1_132_482


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def build(_args) -> None:
    rows = []
    with SEED.open(encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 5:
                continue
            pid, name, locality, cat, layer = parts[:5]
            rows.append({
                "no": i, "page_id": pid, "name": name, "locality": locality,
                "category": cat, "layer": layer,
                # ページ本体を開く URL。ここを人がクリックする。
                # **`/{pid}/photos` にしてはいけない。** 数字IDに `/photos` を直付けすると
                # Facebook は必ず 404（「このページはご利用いただけません」）を返す。
                # `/photos` は vanity URL へ解決された後でないと付けられないサフィックスで、
                # 2026-08-26 に 52 件を「ページが存在しない」と誤判定する事故を起こした
                # （実際は5件の対照実験で全件が `/{pid}` から開けた）。
                # 写真タブへ直行したい場合は `profile.php?id={pid}&sk=photos` を使う。
                "url": f"https://www.facebook.com/{pid}",
                "page": "", "dish_photo": "", "n_dish": "",
                "identifiable": "", "recent": "", "note": "",
            })
    with SHEET.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    n_ws = sum(1 for r in rows if r["layer"] == "has_website")
    print(f"-> {SHEET.name}  {len(rows)} 件"
          f"（website あり {n_ws} / socials のみ {len(rows)-n_ws}）", file=sys.stderr)
    print("   `url` 列を上から順に開いて、判定列を埋めてください。", file=sys.stderr)


def analyze(_args) -> None:
    if not SHEET.exists():
        print(f"{SHEET} がありません。先に build してください。", file=sys.stderr)
        return
    rows = list(csv.DictReader(SHEET.open(encoding="utf-8")))
    done = [r for r in rows if r["page"].strip()]
    if not done:
        print(f"まだ1件も記入されていません（全 {len(rows)} 件）。", file=sys.stderr)
        return

    page = collections.Counter(r["page"].strip() for r in done)
    ok = [r for r in done if r["page"].strip() == "ok"]
    n = len(ok)
    print(f"=== 記入済み {len(done)}/{len(rows)} 件 ===", file=sys.stderr)
    print(f"  ページの状態: {dict(page)}"
          f"   （private = 非公式プレースページ・写真0枚など、店の写真に到達できないもの）",
          file=sys.stderr)
    if not n:
        return

    # 分母は「Facebook リンクを持つ店」**全部**である。到達できなかった店は
    # 「測れなかった」のではなく「料理写真が得られなかった」という**測定結果**であり、
    # 自社サイト経路の 17/31 も「サイトを持つ店」全部を分母にした値なので、
    # ここを揃えないと 2 つの経路を比較できない。
    #
    # そのうえで分子を 2 つに分ける。実測して分かったのは、
    # 「料理写真がある」ページの多くが **Facebook が自動生成した非公式プレースページ**で、
    # 写っているのは**来店客が投稿した写真**だということ。これは
    #   ・店が運営する Page ではないので **Pages API では取得できない**
    #   ・権利が投稿者個人にあるので **App Review を通しても使えない**
    # よって ¥60,000 の判断に使えるのは「店の実在ページにある写真」だけである。
    N = len(done)
    own = [r for r in ok if r["dish_photo"].strip() == "yes"]          # 店の実在ページ
    any_ = [r for r in done if r["dish_photo"].strip() == "yes"]       # 来店客投稿を含む
    lo, hi = wilson(len(own), N)
    lo_a, hi_a = wilson(len(any_), N)
    print(f"\n  **[A] 店の実在ページに料理写真がある {len(own)}/{N} = {len(own)/N*100:.2f}%**"
          f"  95%CI {lo*100:.1f}〜{hi*100:.1f}%", file=sys.stderr)
    print(f"      ← API で取得でき、権利の交渉相手が店になるのはこれだけ。"
          f"**¥60,000 の判断はこの数字で行う**", file=sys.stderr)
    print(f"  [B] 来店客の投稿も数えると   {len(any_)}/{N} = {len(any_)/N*100:.2f}%"
          f"  95%CI {lo_a*100:.1f}〜{hi_a*100:.1f}%", file=sys.stderr)
    print(f"      ← 取得手段も権利の裏付けも無い。**この数字を歩留まりと呼んではいけない**",
          file=sys.stderr)
    k = sum(1 for r in ok if r["dish_photo"].strip() == "yes")
    l1, h1 = wilson(k, n)
    print(f"  [C] （参考）実在ページに到達できた店だけなら {k}/{n} = {k/n*100:.2f}%"
          f"  95%CI {l1*100:.1f}〜{h1*100:.1f}%", file=sys.stderr)
    print(f"      ← 分母が「到達できた店」に選択されている。他経路と比較してはいけない",
          file=sys.stderr)

    ident = collections.Counter(r["identifiable"].strip() for r in ok if r["identifiable"].strip())
    if ident:
        y = ident.get("yes", 0)
        tot = sum(ident.values())
        l2, h2 = wilson(y, tot)
        print(f"  料理が特定できる {y}/{tot} = **{y/tot*100:.2f}%**"
              f"  95%CI {l2*100:.1f}〜{h2*100:.1f}%  内訳 {dict(ident)}", file=sys.stderr)

    for col, label in (("n_dish", "枚数"), ("recent", "直近1年以内")):
        c = collections.Counter(r[col].strip() for r in ok if r[col].strip())
        if c:
            print(f"  {label}: {dict(c)}", file=sys.stderr)

    print("\n=== 層別（website あり / socials のみ）===", file=sys.stderr)
    for layer in ("has_website", "socials_only"):
        sub = [r for r in done if r["layer"] == layer]   # 分母は上と同じく「全部」
        if not sub:
            continue
        kk = sum(1 for r in sub
                 if r["page"].strip() == "ok" and r["dish_photo"].strip() == "yes")   # [A] 基準
        aa = sum(1 for r in sub if r["dish_photo"].strip() == "yes")                  # [B] 基準
        l3, h3 = wilson(kk, len(sub))
        print(f"  {layer:14} [A] {kk}/{len(sub)} = **{kk/len(sub)*100:5.2f}%**"
              f"  95%CI {l3*100:.1f}〜{h3*100:.1f}%"
              f"   ／ [B] {aa}/{len(sub)} = {aa/len(sub)*100:.2f}%", file=sys.stderr)

    print("\n=== 自社サイト経路との比較（判定基準は同じ）===", file=sys.stderr)
    print(f"  自社サイトの店単位 precision **{OWN_SITE_STORE_PRECISION*100:.2f}%**（17/31）",
          file=sys.stderr)
    print(f"  Facebook [A]           **{len(own)/N*100:.2f}%**（{len(own)}/{N}）",
          file=sys.stderr)

    print("\n=== ¥60,000 の判断材料（この率が本当なら）===", file=sys.stderr)
    for label, rate in (("下限 (CI 下端)", lo), ("点推定", len(own) / N), ("上限 (CI 上端)", hi)):
        gross = FB_SHARE_OF_POPULATION * rate
        print(f"  {label:14} 母集団の **{gross*100:5.2f}%**"
              f"（{POP*gross:,.0f} 店）に料理写真がある計算", file=sys.stderr)
    print("\n  ※ これは**総量**であって純増ではない。既存の自社サイト経路と"
          "重なる分を引く必要がある。\n"
          "  ※ **写真があることと使ってよいことは別。**"
          "権利は App Review と Platform Terms の話である。", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("build")
    sub.add_parser("analyze")
    args = ap.parse_args()
    {"build": build, "analyze": analyze}[args.cmd](args)


if __name__ == "__main__":
    main()
