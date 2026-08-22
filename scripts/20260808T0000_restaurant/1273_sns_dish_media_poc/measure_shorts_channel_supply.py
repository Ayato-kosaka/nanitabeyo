#!/usr/bin/env python3
"""#1345 Shorts 経路の天井: **チャンネルは何本あって、店はどこで飽和するのか**

## なぜ

Shorts は実効 12.7店/ch と素材の質が最良だった。エリア検索も飽和しなかった。
残る未測定は**供給**である。

  - Shorts 主体の飲食チャンネルは**何本見つかるのか**
  - チャンネルを積むと **distinct 店はどこで飽和するのか**

長尺では測ってある: **ch 5→56 で店 558→1,972**（1chあたり 111→35 と落ちる）。
Shorts で同じ曲線を引かないと、この経路の天井が出せない。

## 測るもの

1. **チャンネルの発見**: カテゴリ×エリアの検索（Shorts フィルタ）から
   チャンネルを集め、**Shorts 比率が高いもの**を飲食 Shorts チャンネルとみなす
   （判定基準: その検索で拾えた動画のうち 60秒以下が半分以上、かつ2本以上）
2. **積み上げ曲線**: 見つけた順にチャンネルを巡回し、
   **累計 distinct 店**と**1chあたりの新規店**を記録する
3. 天井の見積り: 後半の限界収量から、チャンネルを増やしたときの上限を出す

## この測定が言えないこと

  - 発見はこの検索の範囲に限る。**日本の Shorts 飲食チャンネル全体の数ではない**
  - **経路存在率**である。実効は 12.7/16.29 = 78% を掛けて読むこと
  - 検索結果は実行ごとにばらつく（`measure_shorts_depth.py` で確認済み）

実行:
    python3 measure_shorts_channel_supply.py --max-channels 40 --per-channel 300
"""

from __future__ import annotations

import argparse
import collections
import json
import subprocess
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_channel_traversal import NameMatcher  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
YT = "/tmp/yt-dlp-latest"
SP_UNDER_4MIN = "EgIYAQ%3D%3D"

CATEGORIES = ["ラーメン", "焼肉", "寿司", "カレー", "そば", "うどん",
              "定食", "居酒屋", "カフェ", "パン"]
AREAS = ["新宿", "大阪", "名古屋", "福岡", "札幌", "仙台", "広島", "高松",
         "金沢", "熊本", "岡山", "横浜"]


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


def search_shorts(q: str, limit: int) -> list[dict]:
    url = (f"https://www.youtube.com/results?"
           f"search_query={urllib.parse.quote_plus(q)}&sp={SP_UNDER_4MIN}")
    return yt_json([YT, "--flat-playlist", "--dump-json",
                    "--playlist-end", str(limit), url], 180)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-channels", type=int, default=40)
    ap.add_argument("--per-channel", type=int, default=300)
    ap.add_argument("--per-query", type=int, default=30)
    args = ap.parse_args()

    # --- 1. チャンネルの発見 ------------------------------------------------
    tot: collections.Counter = collections.Counter()
    shorts: collections.Counter = collections.Counter()
    url_of: dict[str, str] = {}
    n_q = 0
    for cat in CATEGORIES:
        for area in AREAS:
            n_q += 1
            for v in search_shorts(f"{cat} {area}", args.per_query):
                ch = (v.get("channel") or "").strip()
                if not ch:
                    continue
                tot[ch] += 1
                if (v.get("duration") or 999) <= 60:
                    shorts[ch] += 1
                u = v.get("channel_url") or v.get("uploader_url") or ""
                if u and ch not in url_of:
                    url_of[ch] = u
        print(f"  {cat:6} まで: チャンネル {len(tot):,}（{n_q} クエリ）",
              file=sys.stderr)

    # 判定基準（本測定で決めた）: Shorts が2本以上 かつ 半分以上
    cands = [(c, shorts[c], tot[c]) for c in tot
             if shorts[c] >= 2 and shorts[c] / tot[c] >= 0.5 and url_of.get(c)]
    cands.sort(key=lambda x: -x[1])
    print(f"\n=== チャンネルの発見（{n_q} クエリ）===", file=sys.stderr)
    print(f"  出てきたチャンネル 全 {len(tot):,}", file=sys.stderr)
    print(f"  **Shorts 主体（2本以上・半分以上）{len(cands):,}**", file=sys.stderr)
    print(f"  1クエリあたり新規チャンネル {len(tot)/max(n_q,1):.2f}", file=sys.stderr)

    # --- 2. 積み上げ曲線 ----------------------------------------------------
    m = NameMatcher()
    seen: set[str] = set()
    curve = []
    rows = []
    for i, (ch, nsh, ntot) in enumerate(cands[: args.max_channels], 1):
        url = url_of[ch].rstrip("/") + "/shorts"
        vids = yt_json([YT, "--flat-playlist", "--dump-json",
                        "--playlist-end", str(args.per_channel), url], 300)
        st: set[str] = set()
        for v in vids:
            t = (v.get("title") or "").strip()
            if t:
                st |= m.match_corroborated(t)
        new = st - seen
        seen |= st
        curve.append((i, len(seen)))
        rows.append({"channel": ch, "n_videos": len(vids), "stores": len(st),
                     "new": len(new)})
        print(f"  {i:>2}. {ch[:26]:28} 動画 {len(vids):>4}  店 {len(st):>3}  "
              f"**新規 {len(new):>3}**  累計 {len(seen):>4}", file=sys.stderr)

    if not curve:
        print("**チャンネルを1本も辿れなかった。数字を出さない。**", file=sys.stderr)
        raise SystemExit(2)

    print(f"\n=== 積み上げ曲線 ===", file=sys.stderr)
    for i, s in curve:
        if i % 5 == 0 or i == 1:
            print(f"  {i:>2} ch → {s:>4} 店（1chあたり {s/i:5.1f}）", file=sys.stderr)

    half = max(1, len(curve) // 2)
    first = curve[half - 1][1]
    total = curve[-1][1]
    print(f"\n  前半{half}ch で {first} 店 / 後半{len(curve)-half}ch の純増 "
          f"{total-first} 店 = **{(total-first)/max(first,1)*100:.1f}%**",
          file=sys.stderr)
    print(f"  （長尺の同じ測り方: ch 5→56 で 558→1,972 店）", file=sys.stderr)

    tail_new = sum(r["new"] for r in rows[-5:]) / max(min(5, len(rows)), 1)
    print(f"\n  直近5chの1chあたり新規 **{tail_new:.1f}店**", file=sys.stderr)
    if tail_new > 0:
        print(f"  → この率が続くと仮定すると、1,000ch で "
              f"{total + tail_new*(1000-len(curve)):,.0f} 店"
              f"（**楽観の上限**。実際は落ち続ける）", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "shorts_channel_supply.json"
    p.write_text(json.dumps(
        {"n_queries": n_q, "n_channels_seen": len(tot),
         "n_shorts_channels": len(cands), "curve": curve, "rows": rows,
         "distinct_total": len(seen), "tail_new_per_ch": tail_new,
         "caveat": "発見はこの検索の範囲に限る（日本全体の本数ではない）。"
                   "経路存在率であって実効ではない（12.7/16.29 = 78% を掛ける）。"
                   "検索結果は実行ごとにばらつく。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
