#!/usr/bin/env python3
"""#1273 YouTube 経路（①のチャンネル巡回）は飽和しているのか

## なぜ

①のクロールは distinct 13,261 店に届いた（NameMatcher のバグ4件修正後）。
だがこれが**もっとチャンネルを回せば伸びる数字なのか、頭打ちなのか**を測っていない。
「まだ伸びる」なら回し続ければよいし、「頭打ち」ならこの経路の天井が確定する。
**推測せずに、既にあるキャッシュから限界収穫の曲線を出す。**

## 測り方

`out/crawl_scaleup_state.json` に 758チャンネル / 194,315本のタイトルがある。
チャンネルを**決定的な順序**（SHA-256 順）で1本ずつ足していき、
そのたびに「そこまでで判明した distinct 店舗数」を記録する。

順序を SHA-256 にするのは、クロールした順（人気順・関連順に偏る）で足すと
**最初に大きく伸びて後で寝る曲線**が必ず出てしまい、飽和と見分けられないため。
無作為順なら、飽和していない経路は最後まで直線に近い。

比較のため**クロール順**でも同じ曲線を出し、2本を並べる。

## 何が言えるか

- 曲線が寝ていれば**チャンネルを増やしても伸びない**＝この経路の天井
- 直線のままなら**まだ伸びる**＝回す価値がある

最後の 10% のチャンネルが何店を新しく足したか（限界収穫）を数字で出す。

## この数字が言えないこと

ここで測るのは**チャンネルを増やしたときの伸び**だけである。
「動画をもっと深く辿る」「検索語を変える」で伸びるかは測っていない。

**ネットワークアクセスは一切しない。**

実行:
    python3 measure_youtube_saturation.py
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_channel_traversal import NameMatcher  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
STATE = OUT_DIR / "crawl_scaleup_state.json"


def curve(order: list[str], ch: dict, matcher: NameMatcher) -> list[int]:
    seen: set[str] = set()
    out = []
    for key in order:
        for v in ch[key].get("videos") or []:
            t = v.get("title") or ""
            if t:
                seen |= matcher.match_corroborated(t)
        out.append(len(seen))
    return out


def main() -> None:
    state = json.loads(STATE.read_text(encoding="utf-8"))
    ch = state["channels"]
    matcher = NameMatcher()
    n = len(ch)
    print(f"チャンネル {n:,} / 動画 "
          f"{sum(len(c.get('videos') or []) for c in ch.values()):,}\n", file=sys.stderr)

    crawl_order = list(ch)
    rand_order = sorted(ch, key=lambda k: hashlib.sha256(k.encode()).hexdigest())

    print("SHA-256 順で積み上げ中...", file=sys.stderr)
    c_rand = curve(rand_order, ch, matcher)
    print("クロール順で積み上げ中...", file=sys.stderr)
    c_crawl = curve(crawl_order, ch, matcher)

    total = c_rand[-1]
    print(f"\n=== 累積 distinct 店舗（チャンネルを1本ずつ足す）===", file=sys.stderr)
    print(f"{'進捗':>8}{'SHA-256順':>14}{'クロール順':>14}", file=sys.stderr)
    marks = [int(n * f) - 1 for f in (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0)]
    rows = {}
    for i in marks:
        pct = (i + 1) / n * 100
        rows[f"{pct:.0f}%"] = {"rand": c_rand[i], "crawl": c_crawl[i]}
        print(f"{pct:>7.0f}%{c_rand[i]:>14,}{c_crawl[i]:>14,}", file=sys.stderr)

    # 限界収穫: 最後の10%のチャンネルが足した店舗数
    i90 = int(n * 0.9) - 1
    marg_rand = c_rand[-1] - c_rand[i90]
    marg_crawl = c_crawl[-1] - c_crawl[i90]
    n_last = n - (i90 + 1)
    print(f"\n=== 限界収穫（最後の {n_last} チャンネル = 10%）===", file=sys.stderr)
    print(f"  SHA-256順 : +{marg_rand:,} 店（全体の {marg_rand / total * 100:.2f}%）"
          f"  1チャンネルあたり {marg_rand / max(n_last,1):.2f} 店", file=sys.stderr)
    print(f"  クロール順 : +{marg_crawl:,} 店（全体の {marg_crawl / total * 100:.2f}%）"
          f"  1チャンネルあたり {marg_crawl / max(n_last,1):.2f} 店", file=sys.stderr)

    # 最初の10%と比べる
    i10 = int(n * 0.1) - 1
    first_rand = c_rand[i10]
    print(f"\n  最初の10%は 1チャンネルあたり {first_rand / (i10 + 1):.2f} 店だったので、"
          f"\n  **{first_rand / (i10 + 1) / max(marg_rand / max(n_last,1), 1e-9):.1f}倍に落ちている**",
          file=sys.stderr)

    # 外挿: いまの限界収穫が続くと仮定して 70%(792,737店) に必要なチャンネル数
    per_ch = marg_rand / max(n_last, 1)
    need = 792_737 - total
    print(f"\n=== 外挿（いまの限界収穫がこのまま続くと仮定した場合）===", file=sys.stderr)
    if per_ch > 0:
        print(f"  70% = 792,737 店まであと {need:,} 店。"
              f"1チャンネル {per_ch:.2f} 店なら **{need / per_ch:,.0f} チャンネル**要る",
              file=sys.stderr)
        print(f"  （いま 758 チャンネル。**{need / per_ch / n:,.0f} 倍**）", file=sys.stderr)
    print(f"  ※ 限界収穫は逓減するので、これは**下限**である。実際はもっと要る。",
          file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "youtube_saturation.json"
    p.write_text(json.dumps(
        {"n_channels": n, "total_distinct": total, "milestones": rows,
         "marginal_last10pct": {"n_channels": n_last, "rand": marg_rand,
                                "crawl": marg_crawl,
                                "per_channel_rand": per_ch},
         "first10pct_per_channel": first_rand / (i10 + 1),
         "curve_rand": c_rand, "curve_crawl": c_crawl,
         "caveat": "チャンネルを増やしたときの伸びだけを測った。動画をより深く辿る／"
                   "検索語を変えることで伸びるかは測っていない。外挿は限界収穫が"
                   "一定という仮定なので下限。"},
        ensure_ascii=False), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
