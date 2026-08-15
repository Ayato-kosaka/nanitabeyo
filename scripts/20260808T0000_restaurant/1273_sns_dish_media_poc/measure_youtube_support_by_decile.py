#!/usr/bin/env python3
"""#1273 YouTube 経路は経路存在率が線形だが、**実効も線形か**

## なぜ

`measure_youtube_saturation.py` で「チャンネルを増やせば distinct 店舗はほぼ直線に伸びる」
（限界収穫 19.92 → 17.67 店/ch）と実測した。**しかしこれは経路存在率である。**

実効にするには、その店の動画が (a) 埋め込みとして生きていて (b) judge を通る必要がある。
**後から見つかる店ほど質が落ちる**なら、経路存在率が直線でも実効は寝る。
「線形だから回せばよい」と言う前に、そこを分ける。

## 測るもの（オフラインでできる代理指標）

judge を全店に回すのは取得が要るのでここではやらない。代わりに、
**その店を何本の独立した動画・チャンネルが裏付けているか（support）**を数える。

support は verifiability の代理である:
  - support 1 の店は、その1本が死んだ／誤判定だった時点で消える
  - support 2 以上の店は、裏取りが効き、埋め込みが1本死んでも残る

①の judge は「店名 × 地名の裏取り」を課しているので、support が薄い店ほど
judge を通りにくいことは構造的に期待できる。**それが実際に何割なのかを数字で出す。**

## やり方

チャンネルを SHA-256 順（無作為順）に10等分し、各店が**最初に現れた十分位**で層別する。
十分位ごとに support の分布を出す。

- 後半の十分位ほど support 1 の比率が高ければ、**実効は経路存在率より早く寝る**
- 変わらなければ、**実効も線形**とみなせる

## この数字が言えないこと

support は verifiability の代理であって、**judge 通過率そのものではない**。
埋め込みの生存率も測っていない。ここで出すのは「後から見つかる店の裏付けが
薄くなるか」までである。

**ネットワークアクセスは一切しない。**

実行:
    python3 measure_youtube_support_by_decile.py
"""

from __future__ import annotations

import collections
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_channel_traversal import NameMatcher  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
STATE = OUT_DIR / "crawl_scaleup_state.json"
N_BINS = 10


def main() -> None:
    state = json.loads(STATE.read_text(encoding="utf-8"))
    ch = state["channels"]
    matcher = NameMatcher()
    order = sorted(ch, key=lambda k: hashlib.sha256(k.encode()).hexdigest())
    n = len(order)
    print(f"チャンネル {n:,}（SHA-256 順で10等分）", file=sys.stderr)

    # 店 -> 裏付けた動画数 / チャンネル数 / 最初に現れた十分位
    n_videos: collections.Counter = collections.Counter()
    chans: dict[str, set[str]] = collections.defaultdict(set)
    first_bin: dict[str, int] = {}

    for i, key in enumerate(order):
        b = min(i * N_BINS // n, N_BINS - 1)
        for v in ch[key].get("videos") or []:
            t = v.get("title") or ""
            if not t:
                continue
            for r in matcher.match_corroborated(t):
                n_videos[r] += 1
                chans[r].add(key)
                if r not in first_bin:
                    first_bin[r] = b

    total = len(first_bin)
    print(f"distinct 店舗 {total:,}\n", file=sys.stderr)

    print("=== 最初に現れた十分位ごとの裏付けの厚さ ===", file=sys.stderr)
    print(f"{'十分位':>6}{'新規店':>9}{'support1':>10}{'その比':>9}"
          f"{'平均動画数':>11}{'平均ch数':>10}{'ch2以上':>9}", file=sys.stderr)
    rows = {}
    for b in range(N_BINS):
        stores = [r for r, fb in first_bin.items() if fb == b]
        if not stores:
            continue
        s1 = sum(1 for r in stores if n_videos[r] == 1)
        c2 = sum(1 for r in stores if len(chans[r]) >= 2)
        mv = sum(n_videos[r] for r in stores) / len(stores)
        mc = sum(len(chans[r]) for r in stores) / len(stores)
        rows[b + 1] = {"n_new": len(stores), "support1": s1,
                       "support1_pct": s1 / len(stores) * 100,
                       "mean_videos": mv, "mean_channels": mc,
                       "ch_ge2": c2, "ch_ge2_pct": c2 / len(stores) * 100}
        print(f"{b+1:>6}{len(stores):>9,}{s1:>10,}{s1/len(stores)*100:>8.1f}%"
              f"{mv:>11.2f}{mc:>10.2f}{c2/len(stores)*100:>8.1f}%", file=sys.stderr)

    first, last = rows[1], rows[max(rows)]
    print(f"\n  第1十分位 support1 {first['support1_pct']:.1f}% → "
          f"第10十分位 {last['support1_pct']:.1f}%"
          f"（{last['support1_pct'] - first['support1_pct']:+.1f}pt）", file=sys.stderr)
    print(f"  第1十分位 平均動画数 {first['mean_videos']:.2f} → "
          f"第10十分位 {last['mean_videos']:.2f}", file=sys.stderr)
    print(f"  第1十分位 ch2以上 {first['ch_ge2_pct']:.1f}% → "
          f"第10十分位 {last['ch_ge2_pct']:.1f}%", file=sys.stderr)

    # 全体の support 分布
    dist = collections.Counter(min(n_videos[r], 5) for r in first_bin)
    print(f"\n=== 全体の support 分布（動画本数）===", file=sys.stderr)
    for k in sorted(dist):
        lbl = f"{k}本" if k < 5 else "5本以上"
        print(f"  {lbl:>8} {dist[k]:>7,} = {dist[k]/total*100:>5.1f}%", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "youtube_support_by_decile.json"
    p.write_text(json.dumps(
        {"n_channels": n, "n_stores": total, "by_decile": rows,
         "support_dist": {str(k): v for k, v in dist.items()},
         "caveat": "support は verifiability の代理であって judge 通過率そのものではない。"
                   "埋め込みの生存率も測っていない。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
