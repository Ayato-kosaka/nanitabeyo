#!/usr/bin/env python3
"""#1279 KPI② の律速は coverage ではなく k（1店あたりの料理カテゴリ数）である

## なぜ

`out/cell_fill_now.json` の実測をエリア別に並べると、こうなる。

| coverage | 都市1km で 5店埋まる確率 |
|---|---:|
| 13.17%（現在） | 0.004% |
| 25.63%（実効天井） | 0.09% |
| **70%（要求どおり）** | **4.83%** |

**要求どおり 70% を達成しても、都市1kmセルは 4.83% しか埋まらない。**
KPI② を満たすのに必要な k は **3.39**（現行 1.89）である。

つまり KPI② は「もっと多くの店に写真を付ける」では解けず、
**「1店あたりもっと多くの料理カテゴリを付ける」**でしか解けない。
そして k を上げるのは coverage を上げるのとは**別の問題**である。
新しい店を見つける必要が無く、**すでに取れている店の別の料理を拾えばよい**。

## 測るもの（**ネットワークアクセスなし**。保存済みのタイトルを使う）

チャンネル逆走査のキャッシュから、

  1. 1本の動画から取れる料理カテゴリ数の分布（いま1本1カテゴリで扱っているのか）
  2. **同じ店について複数の動画がある割合**（同じ店の別料理を拾える余地）
  3. **店ごとの distinct カテゴリ数 k の分布**（この経路だけで k はどこまで行くか）
  4. k を 3.39 に上げるには、1店あたり何本の動画が要るか

## この測定が言えないこと

タイトルの語からカテゴリを引いているだけで、**その動画に実際にその料理が
写っているか**は見ていない。`dish_media` にするには画像の実体が要る。
したがってここで出る k は**上限側**である。

実行:
    python3 measure_k_ceiling.py
"""

from __future__ import annotations

import collections
import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dish_category_matcher import CategoryMatcher  # noqa: E402
from measure_channel_traversal import NameMatcher  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
REQUIRED_K_URBAN_1KM = 3.39      # out/cell_fill_now.json の required_k
CURRENT_K = 1.89


def main() -> None:
    cache = OUT_DIR / "channel_titles_cache.json"
    if not cache.exists():
        print("キャッシュが無い。数字を出さない。", file=sys.stderr)
        raise SystemExit(2)
    d = json.loads(cache.read_text(encoding="utf-8"))

    m = NameMatcher()
    cm = CategoryMatcher()

    per_video_cats: list[int] = []
    store_cats: dict[str, set] = collections.defaultdict(set)
    store_videos: dict[str, int] = collections.Counter()
    n_videos = n_hit = 0

    for c in d.get("channels", []):
        for v in (c.get("videos") or []):
            t = (v.get("title") or "") if isinstance(v, dict) else ""
            if not t:
                continue
            n_videos += 1
            stores = m.match_corroborated(t)
            if not stores:
                continue
            n_hit += 1
            cats = {x["dish_category_id"] for x in cm.match(t)}
            per_video_cats.append(len(cats))
            for s in stores:
                store_videos[s] += 1
                store_cats[s] |= cats

    if not store_cats:
        print("店が1つも取れていない。数字を出さない。", file=sys.stderr)
        raise SystemExit(3)

    print(f"動画 {n_videos:,} / 店が特定できた {n_hit:,} "
          f"= {n_hit/max(n_videos,1)*100:.2f}%", file=sys.stderr)
    print(f"distinct 店 {len(store_cats):,}", file=sys.stderr)

    # --- 1. 1動画から取れるカテゴリ数 ---------------------------------------
    dist = collections.Counter(per_video_cats)
    print(f"\n=== 1本の動画から取れる料理カテゴリ数 ===", file=sys.stderr)
    tot = sum(dist.values())
    for k in sorted(dist):
        print(f"  {k} カテゴリ  {dist[k]:>6,} = {dist[k]/tot*100:5.2f}%",
              file=sys.stderr)
    print(f"  平均 {statistics.mean(per_video_cats):.2f} カテゴリ/動画",
          file=sys.stderr)
    multi = sum(v for k, v in dist.items() if k >= 2)
    print(f"  **2カテゴリ以上を含む動画 {multi:,} = {multi/tot*100:.2f}%**",
          file=sys.stderr)

    # --- 2. 同じ店に何本の動画があるか --------------------------------------
    vs = sorted(store_videos.values(), reverse=True)
    n_multi_v = sum(1 for x in vs if x >= 2)
    print(f"\n=== 同じ店について何本の動画があるか ===", file=sys.stderr)
    print(f"  1本だけ {len(vs)-n_multi_v:,} = {(len(vs)-n_multi_v)/len(vs)*100:.2f}%",
          file=sys.stderr)
    print(f"  **2本以上 {n_multi_v:,} = {n_multi_v/len(vs)*100:.2f}%**",
          file=sys.stderr)
    print(f"  平均 {statistics.mean(vs):.2f} 本/店 / 中央値 "
          f"{statistics.median(vs):.0f}", file=sys.stderr)

    # --- 3. 店ごとの distinct カテゴリ数 k -----------------------------------
    ks = sorted((len(v) for v in store_cats.values()), reverse=True)
    kdist = collections.Counter(ks)
    print(f"\n=== 店ごとの distinct 料理カテゴリ数 k ===", file=sys.stderr)
    for k in sorted(kdist)[:8]:
        print(f"  k={k}  {kdist[k]:>6,} 店 = {kdist[k]/len(ks)*100:5.2f}%",
              file=sys.stderr)
    big = sum(v for k, v in kdist.items() if k >= 8)
    if big:
        print(f"  k>=8 {big:,} 店", file=sys.stderr)
    mean_k = statistics.mean(ks)
    print(f"  **平均 k = {mean_k:.2f}**（現行 dish の実測 {CURRENT_K} / "
          f"KPI② が都市1kmで要求する {REQUIRED_K_URBAN_1KM}）", file=sys.stderr)
    ge = sum(1 for x in ks if x >= REQUIRED_K_URBAN_1KM)
    print(f"  k >= {REQUIRED_K_URBAN_1KM} を満たす店 {ge:,} = "
          f"{ge/len(ks)*100:.2f}%", file=sys.stderr)

    # --- 4. 動画本数と k の関係（何本読めば k が足りるか）--------------------
    print(f"\n=== 動画本数ごとの平均 k ===", file=sys.stderr)
    band: dict[str, list] = collections.defaultdict(list)
    for s, k in ((s, len(v)) for s, v in store_cats.items()):
        n = store_videos[s]
        lab = "1本" if n == 1 else "2本" if n == 2 else "3-4本" if n <= 4 else \
              "5-9本" if n <= 9 else "10本以上"
        band[lab].append(k)
    for lab in ("1本", "2本", "3-4本", "5-9本", "10本以上"):
        if band[lab]:
            print(f"  {lab:8} 店 {len(band[lab]):>6,}  平均 k = "
                  f"{statistics.mean(band[lab]):.2f}", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "k_ceiling.json"
    p.write_text(json.dumps(
        {"n_videos": n_videos, "n_hit": n_hit, "n_stores": len(store_cats),
         "cats_per_video": dict(dist), "mean_cats_per_video":
             statistics.mean(per_video_cats),
         "videos_per_store_mean": statistics.mean(vs),
         "k_distribution": dict(kdist), "mean_k": mean_k,
         "share_k_ge_required": ge / len(ks),
         "k_by_video_band": {k: statistics.mean(v) for k, v in band.items() if v},
         "required_k_urban_1km": REQUIRED_K_URBAN_1KM, "current_k": CURRENT_K,
         "caveat": "タイトルの語からカテゴリを引いただけで、その動画に実際にその料理が"
                   "写っているかは見ていない。したがって k は上限側の値である。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
