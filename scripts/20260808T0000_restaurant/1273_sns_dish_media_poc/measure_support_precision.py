#!/usr/bin/env python3
"""#1273 support（裏付け本数）は本当に judge 通過の代理になっているか

## なぜ

前ラウンドで「裏付けあり(ch2以上)の限界収穫は 17.7倍で寝る」と出し、
**チャンネルを増やす戦略の費用対効果は見かけより2桁悪い**と結論した。

この結論は **「support が薄い店ほど judge を通りにくい」という仮定**に乗っている。
仮定を検証せずに結論を残すのは、これまで3度やらかした「測定の不備を実態と取り違える」
のと同じ形である。**代理指標そのものを検証する。**

## 測るもの

`match_corroborated` が張った (店, 動画) 対を support 別に2群に分け、
**決定的に同数ずつ抜いて目視**し、群ごとの precision を比べる。

  - 群A: support 1（その店を裏付ける動画が1本しかない）
  - 群B: support 2以上

出力は「動画タイトル / 当たった屋号 / その店の市区町村・都道府県」で、
**タイトルだけを見て、その屋号の店の話だと納得できるか**を人が判定する。

## 何が言えるか

- A の precision が B より**明確に低い**なら、代理は妥当。前ラウンドの結論は保つ。
- **差が無い**なら、代理は不当。17.7倍という数字は裏付けの厚さの話に過ぎず、
  実効の低下を意味しない。**前ラウンドの結論を訂正する必要がある。**

## この測定の限界

judge 本体は店名×地名の裏取りに加えて埋め込みの生存も見るが、ここでは
**タイトルからの同定が正しいか**だけを見る。埋め込み生存は別の軸である。

**ネットワークアクセスは一切しない。**

実行:
    python3 measure_support_precision.py --per-group 40
"""

from __future__ import annotations

import argparse
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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-group", type=int, default=40)
    args = ap.parse_args()

    state = json.loads(STATE.read_text(encoding="utf-8"))
    ch = state["channels"]
    matcher = NameMatcher()

    # (店, 動画) 対を集めつつ support を数える
    pairs: list[tuple[str, str, str]] = []      # (store_key, title, channel_key)
    n_videos: collections.Counter = collections.Counter()
    for key in ch:
        for v in ch[key].get("videos") or []:
            t = (v.get("title") or "").strip()
            if not t:
                continue
            for r in matcher.match_corroborated(t):
                pairs.append((r, t, key))
                n_videos[r] += 1
    print(f"(店, 動画) 対 {len(pairs):,} / distinct 店 {len(n_videos):,}", file=sys.stderr)

    g1 = [p for p in pairs if n_videos[p[0]] == 1]
    g2 = [p for p in pairs if n_videos[p[0]] >= 2]
    print(f"  群A support1  : {len(g1):,} 対", file=sys.stderr)
    print(f"  群B support2+ : {len(g2):,} 対", file=sys.stderr)

    def pick(g: list, tag: str) -> list[dict]:
        g = sorted(g, key=lambda p: hashlib.sha256(
            f"{tag}/{p[0]}/{p[1]}".encode("utf-8")).hexdigest())
        out = []
        for store_key, title, _ in g[: args.per_group]:
            loc, region = matcher.area.get(store_key, ("", ""))
            out.append({"store_key": store_key, "locality": loc, "region": region,
                        "title": title, "support": n_videos[store_key]})
        return out

    a = pick(g1, "A")
    b = pick(g2, "B")

    for tag, rows in (("A: support 1", a), ("B: support 2以上", b)):
        print(f"\n=== 群{tag}（{len(rows)}件・SHA-256順）===", file=sys.stderr)
        for i, r in enumerate(rows, 1):
            print(f"{i:>3}. 屋号「{r['store_key']}」 {r['region']}{r['locality']}",
                  file=sys.stderr)
            print(f"     {r['title'][:88]}", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "support_precision_sample.json"
    p.write_text(json.dumps({"n_pairs": len(pairs), "n_g1": len(g1), "n_g2": len(g2),
                             "group_a_support1": a, "group_b_support2plus": b,
                             "caveat": "タイトルからの同定が正しいかだけを見る。"
                                       "埋め込み生存は別軸。"},
                            ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
