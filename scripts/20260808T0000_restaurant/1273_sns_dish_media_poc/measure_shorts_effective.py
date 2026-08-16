#!/usr/bin/env python3
"""#1345 Shorts の**実効**を測る（経路存在率 16.29店/ch のうち、実際に使えるのは何割か）

## なぜ

Shorts チャンネル巡回は **16.29店/ch**（長尺 15.85店/ch）まで回復した。
しかしこれは**経路存在率**である。`dish_media` にするには最低限、

  1. **料理が写っていること**（店の外観・人物だけでは使えない）
  2. **料理カテゴリが決まること**（`dish_media.dish_id` は必須。付かないと1件も入らない）

が要る。ここを目視で確かめないと「16.29店/ch」は使えない数字のままである。

## 測るもの

店が特定できた Shorts から決定的標本を取り、**サムネイルを実際に見て**

  - 料理が写っているか（皿・料理が主役か）
  - 何の料理か言えるか（人が見て料理カテゴリを言えるか）

を分類する。あわせて **`CategoryMatcher` がタイトルからカテゴリを付けられるか**
を機械側でも数え、**人と機械の差**を出す。

## この測定が言えないこと

  - サムネイルは**動画の1コマ**である。本編に料理が写っていてサムネが
    店構えということはありうる（＝**下限**）
  - 規約（YouTube の埋め込み・派生データ）はここでは判定しない

実行:
    python3 measure_shorts_effective.py --channels 8 --per-channel 120 --sample 24
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dish_category_matcher import CategoryMatcher  # noqa: E402
from measure_channel_traversal import NameMatcher  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
THUMB_DIR = OUT_DIR / "_shorts_thumbs"
YT = "/tmp/yt-dlp-latest"
UA = "Mozilla/5.0 (compatible; nanitabeyo-research/1.0)"


def yt_json(cmd: list[str], timeout: int) -> list[dict]:
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return []
    out = []
    for line in p.stdout.decode("utf-8", "replace").splitlines():
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--channels", type=int, default=8)
    ap.add_argument("--per-channel", type=int, default=120)
    ap.add_argument("--sample", type=int, default=24)
    args = ap.parse_args()

    d = json.loads((OUT_DIR / "shorts_route_search.json").read_text(encoding="utf-8"))
    chans = [c for c in d["top_short_channels"] if c.get("url")][: args.channels]
    m = NameMatcher()
    cm = CategoryMatcher()

    hits = []
    for c in chans:
        url = c["url"].rstrip("/") + "/shorts"
        vids = yt_json([YT, "--flat-playlist", "--dump-json",
                        "--playlist-end", str(args.per_channel), url], 300)
        for v in vids:
            t = (v.get("title") or "").strip()
            vid = v.get("id")
            if not t or not vid:
                continue
            st = m.match_corroborated(t)
            if not st:
                continue
            cats = sorted({x["dish_category_id"] for x in cm.match(t)})
            hits.append({"id": vid, "title": t, "channel": c["channel"],
                         "stores": sorted(st), "cats": cats})
        print(f"  {c['channel'][:28]:30} 累計 店が特定できた Shorts {len(hits)}",
              file=sys.stderr)

    if not hits:
        print("**店が特定できた Shorts が0件。数字を出さない。**", file=sys.stderr)
        raise SystemExit(2)

    n_cat = sum(1 for h in hits if h["cats"])
    print(f"\n=== 店が特定できた Shorts {len(hits)} 本 ===", file=sys.stderr)
    print(f"  **タイトルから料理カテゴリが付いた {n_cat}/{len(hits)} = "
          f"{n_cat/len(hits)*100:.2f}%**（付かないと dish_media に1件も入らない）",
          file=sys.stderr)

    # --- 目視用にサムネイルを落とす（決定的標本）---------------------------
    hits.sort(key=lambda h: hashlib.sha256(h["id"].encode()).hexdigest())
    smp = hits[: args.sample]
    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    saved = []
    for h in smp:
        for tmpl in ("https://i.ytimg.com/vi/{}/hq720.jpg",
                     "https://i.ytimg.com/vi/{}/hqdefault.jpg"):
            u = tmpl.format(h["id"])
            try:
                req = urllib.request.Request(u, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=20) as r:
                    b = r.read()
                if len(b) > 4000:
                    p = THUMB_DIR / f"{h['id']}.jpg"
                    p.write_bytes(b)
                    saved.append({**h, "thumb": str(p)})
                    break
            except Exception:                                # noqa: BLE001
                continue
    print(f"\n=== 目視用サムネイル {len(saved)}/{len(smp)} 枚を保存 ===",
          file=sys.stderr)
    for s in saved:
        print(f"  {s['id']}  cats={s['cats']}  {s['title'][:56]}", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "shorts_effective.json"
    p.write_text(json.dumps(
        {"n_hits": len(hits), "n_with_category": n_cat,
         "category_rate": n_cat / len(hits),
         "sample": saved, "hits": hits[:400],
         "caveat": "サムネイルは動画の1コマなので、本編に料理があってもサムネが"
                   "店構えということがある（下限）。規約の判定はここではしない。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}（画像は {THUMB_DIR.name}/）", file=sys.stderr)


if __name__ == "__main__":
    main()
