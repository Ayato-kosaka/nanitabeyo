#!/usr/bin/env python3
"""#1273 自社サイト経路を**店単位**で監査し直す（前回は単位を間違えた）

## なぜ

前回、自社サイトの「料理画像」309 枚から**画像を無作為に**取って目視し、
precision 50.0%（7/14）を得た。しかし補正したいのは

    「取得できたサイトの **67.32%（103/153）に料理画像があった**」

という**店単位**の率である。**単位が違うので掛けられない。**
1店に複数枚あるので、店単位の precision は画像単位より高くなる。

そこで**店を抽出して、その店の画像を全部見る**。判定は
「その店に**料理写真が1枚でもあるか**」で、67.32% と同じ定義にそろえる。

## 測るもの

料理画像ありと判定された 92 店から決定的に抽出し、各店の候補画像を
（多いときは上位5枚まで）落として並べる。目視で

    その店に料理写真が1枚でもある → 真
    1枚も無い（ロゴ・外観・ストック写真・イラストだけ） → 偽

を判定し、**店単位の precision** を出す。

## この測定が言えないこと

  - 前回と同じく標本は小さい。**幅を必ず併記する**
  - 1店あたり上位5枚しか見ない。6枚目に料理があれば取りこぼす（**下限**）
  - ポータルの共有素材（無関係な複数店に同じ画像）は、
    **料理写真だが帰属が誤り**なので別に数える

実行:
    python3 verify_own_site_by_store.py --stores 8 --per-store 4
"""

from __future__ import annotations

import argparse
import collections
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
    ap.add_argument("--stores", type=int, default=8)
    ap.add_argument("--per-store", type=int, default=4)
    args = ap.parse_args()

    d = json.loads((OUT_DIR / "own-website-images.json").read_text(encoding="utf-8"))
    stores = [r for r in d["results"] if r.get("n_verified_dish", 0) >= 1]
    print(f"料理画像ありと判定した店 {len(stores)}", file=sys.stderr)

    # 共有素材の検出: 同じ URL が何店に付いているか
    url_stores: dict[str, set] = collections.defaultdict(set)
    for r in stores:
        for v in r.get("verified") or []:
            if v.get("ok") and v.get("food_word"):
                url_stores[v["url"]].add(r["name"])
    shared = {u for u, s in url_stores.items() if len(s) > 1}
    print(f"**2店以上で共有されている画像 URL {len(shared)} 件**"
          f"（ポータルの素材。料理写真でも帰属できない）", file=sys.stderr)

    stores.sort(key=lambda r: hashlib.sha256(r["name"].encode()).hexdigest())
    smp = stores[: args.stores]

    IMG_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    for i, r in enumerate(smp, 1):
        cands = [v for v in (r.get("verified") or [])
                 if v.get("ok") and v.get("food_word")
                 and min(v.get("w", 0), v.get("h", 0)) >= 200][: args.per_store]
        files = []
        for v in cands:
            name = hashlib.sha256(v["url"].encode()).hexdigest()[:16] + ".jpg"
            p = IMG_DIR / name
            if not p.exists():
                try:
                    req = urllib.request.Request(v["url"], headers={"User-Agent": UA})
                    with urllib.request.urlopen(req, timeout=25) as resp:
                        b = resp.read(3_000_000)
                    if len(b) < 2000:
                        raise ValueError("too small")
                    p.write_bytes(b)
                except Exception as e:                           # noqa: BLE001
                    files.append({"url": v["url"], "file": None,
                                  "error": type(e).__name__})
                    continue
            files.append({"url": v["url"], "file": str(p),
                          "w": v["w"], "h": v["h"],
                          "alt": (v.get("alt") or "")[:60],
                          "shared_with_other_stores": v["url"] in shared})
        rows.append({"store": r["name"], "domain": r["domain"],
                     "n_verified_dish": r["n_verified_dish"],
                     "n_candidates": len(cands), "images": files})
        ok = sum(1 for f in files if f.get("file"))
        print(f"{i:>2}. {r['name'][:26]:28} 候補 {len(cands)} / 落とせた {ok}"
              + ("  **共有素材あり**" if any(f.get("shared_with_other_stores")
                                        for f in files) else ""), file=sys.stderr)
        for f in files:
            if f.get("file"):
                print(f"      {Path(f['file']).name}  {f.get('w')}x{f.get('h')}"
                      f"  alt={f.get('alt','')!r}", file=sys.stderr)

    p = OUT_DIR / "own_site_by_store_sample.json"
    p.write_text(json.dumps(
        {"n_stores_total": len(stores), "n_shared_urls": len(shared),
         "shared_urls": sorted(shared)[:40], "sample": rows,
         "caveat": "1店あたり上位数枚しか見ないので下限。判定は『その店に料理写真が"
                   "1枚でもあるか』で、67.32% と同じ定義にそろえる。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
