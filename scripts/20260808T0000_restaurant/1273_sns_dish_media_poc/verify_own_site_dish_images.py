#!/usr/bin/env python3
"""#1273 自社サイト経路の「料理画像」を**実際に見て**確かめる

## なぜ

r_N（リンク無し層）は3面すべて監査して 34.79% → **3.12%** まで落ちた。
機械判定を目視すると毎回2〜11倍の水増しがあった。
**それなのに r_L（リンク層）の側は、画像を1枚も見ていない。**

r_L の最大項は自社サイト経路で、その根拠は

    website を持つ店のうち、取得できたサイトの **67.32%（103/153）に料理画像があった**

という**機械判定**である。判定は「実取得できた画像で、短辺200px以上、
URL・alt・周辺テキストに料理語がある」だけで、**画像の中身は見ていない。**

保存済みデータを覗くと、既に怪しいものが混ざっている:

    https://d3vgbguy0yofad.cloudfront.net/images/og/store-search.jpg
    （スターバックスの**店舗検索用 OG 画像**。周辺テキストに店名があるので料理語が通った）

**r_N だけ厳しく見て r_L を甘いままにするのは、比較として不公平である。**

## 測るもの

「料理画像」と数えた 309 枚から決定的標本を取り、**実際に画像を見て**分類する。

    A. 料理が主役（皿・料理が写っている）
    B. 料理は写るが主役でない（店内写真の隅、コラージュ）
    C. 料理ではない（外観・ロゴ・地図・OG画像・人物・バナー）

出すのは **A の割合**（＝この経路の料理写真 precision）である。

## この測定が言えないこと

  - **1店あたり1枚ではなく画像単位**で見る。店単位の率（67.32%）に直すには
    「その店に A が1枚でもあるか」で数え直す必要がある。両方出す
  - サムネイル/縮小版ではなく実 URL を取得する。取得に失敗した分は欠測として数える

実行:
    python3 verify_own_site_dish_images.py --sample 18
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
IMG_DIR = OUT_DIR / "_own_site_imgs"
UA = "nanitabeyo-research/1.0 (dish-media feasibility PoC)"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=18)
    args = ap.parse_args()

    d = json.loads((OUT_DIR / "own-website-images.json").read_text(encoding="utf-8"))
    imgs = []
    for r in d["results"]:
        for v in r.get("verified") or []:
            if (v.get("ok") and v.get("food_word")
                    and min(v.get("w", 0), v.get("h", 0)) >= 200):
                imgs.append({"store": r["name"], "domain": r["domain"],
                             "url": v["url"], "alt": v.get("alt") or "",
                             "context": (v.get("context") or "")[:120],
                             "w": v["w"], "h": v["h"]})
    if not imgs:
        print("**『料理画像』が0枚。数字を出さない。**", file=sys.stderr)
        raise SystemExit(2)

    print(f"『料理画像』と数えた画像 {len(imgs)} 枚 / "
          f"店 {len({i['store'] for i in imgs})}", file=sys.stderr)

    imgs.sort(key=lambda i: hashlib.sha256(i["url"].encode()).hexdigest())
    smp = imgs[: args.sample]
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    saved = []
    for i, im in enumerate(smp, 1):
        name = hashlib.sha256(im["url"].encode()).hexdigest()[:16] + ".jpg"
        p = IMG_DIR / name
        try:
            req = urllib.request.Request(im["url"], headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=25) as r:
                b = r.read(3_000_000)
            if len(b) < 2000:
                raise ValueError("too small")
            p.write_bytes(b)
            saved.append({**im, "file": str(p)})
            print(f"{i:>2}. {im['store'][:22]:24} {im['w']}x{im['h']}  {name}",
                  file=sys.stderr)
            print(f"     alt={im['alt'][:40]!r}", file=sys.stderr)
            print(f"     ctx={im['context'][:70]!r}", file=sys.stderr)
        except Exception as e:                                   # noqa: BLE001
            print(f"{i:>2}. {im['store'][:22]:24} **取得失敗 {type(e).__name__}**",
                  file=sys.stderr)

    print(f"\n保存 {len(saved)}/{len(smp)} 枚 -> {IMG_DIR}", file=sys.stderr)
    p = OUT_DIR / "own_site_dish_image_sample.json"
    p.write_text(json.dumps(
        {"n_images_total": len(imgs),
         "n_stores_total": len({i["store"] for i in imgs}),
         "sample": saved,
         "caveat": "画像単位で見る。店単位の率（67.32%）に直すには『その店に料理写真が"
                   "1枚でもあるか』で数え直す必要がある。取得失敗は欠測。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
