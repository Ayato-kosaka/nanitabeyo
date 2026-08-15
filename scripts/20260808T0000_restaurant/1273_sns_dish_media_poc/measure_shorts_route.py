#!/usr/bin/env python3
"""#1345 YouTube Shorts を「カテゴリ検索」から辿り直す

## なぜ（オーナー指摘への回答）

これまで「Shorts は使えない」と報告してきたが、**測っていたものが違った**。

  - #1307 の「Shorts率 0/250」… **店名検索で見つけたチャンネル**の動画を数えたもの。
    店名で検索すると長尺のレビュー動画が上位に来るので、そこから辿ったチャンネルは
    長尺主体になる。**Shorts 主体のクリエイターに到達していない。**
  - #1312 の「Shorts の店舗特定率 2.56%」… 上記チャンネルの `/shorts` タブを見たもの。
    **母数が同じ**なので、同じ偏りを引きずっている。

オーナーの指摘「ラーメンで検索すればショート動画もラーメンチャンネルもいっぱいある」は
**この穴を突いている**。母数を「店名検索由来のチャンネル」から
**「カテゴリ検索で出てくる Shorts」**に変えて測り直す。

## 測るもの

1. **カテゴリ×エリアの検索で Shorts がどれだけ出るか**
   `ytsearch` の既定は通常動画で Shorts をほぼ返さない（実測 0/20）。
   YouTube の検索フィルタ `sp=EgIYAQ%3D%3D`（4分未満）を付けた検索URLを使う。
2. **出てきた Shorts から店舗を特定できるか**（`NameMatcher.match_corroborated`）
3. **Shorts 主体のチャンネル**を見つけ、その `/shorts` タブを辿ったときの
   **1チャンネルあたり distinct 店舗数**（①の長尺実測 15.85店/ch と比べる）

## この測定が答えないこと

Shorts が「縦長で魅力的か」は測らない。ここで測るのは**店舗を特定できるか**だけ。
表示の良し悪しは②の論点で別。

実行:
    python3 measure_shorts_route.py --stage search
    python3 measure_shorts_route.py --stage channels
"""

from __future__ import annotations

import argparse
import collections
import json
import re
import subprocess
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dish_category_matcher import CategoryMatcher  # noqa: E402
from measure_channel_traversal import NameMatcher  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
YT = "/tmp/yt-dlp-latest"

# 4分未満フィルタ。Shorts は 60秒以下なのでこの中に入る。
SP_UNDER_4MIN = "EgIYAQ%3D%3D"

CATEGORIES = ["ラーメン", "焼肉", "寿司", "カレー", "そば", "定食"]
AREAS = ["新宿", "大阪", "福岡", "札幌", "仙台", "高松"]
# 【規律】規則を作った標本での成績は過大評価になる。裏取りキーの改修（B/C/D 案）を
# **未目視の別標本**で検証するために、カテゴリもエリアも重ならない第2セットを置く。
CATEGORIES2 = ["うどん", "天ぷら", "居酒屋", "パスタ", "ステーキ", "餃子"]
AREAS2 = ["名古屋", "横浜", "京都", "神戸", "広島", "金沢"]


def search(query: str, limit: int, shorts_filter: bool) -> list[dict]:
    q = urllib.parse.quote_plus(query)
    if shorts_filter:
        url = f"https://www.youtube.com/results?search_query={q}&sp={SP_UNDER_4MIN}"
    else:
        url = f"ytsearch{limit}:{query}"
    cmd = [YT, "--flat-playlist", "--dump-json", "--playlist-end", str(limit), url]
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=180)
    except subprocess.TimeoutExpired:
        return []
    out = []
    for line in p.stdout.decode("utf-8", "replace").splitlines():
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def is_short(d: dict) -> bool:
    dur = d.get("duration")
    return dur is not None and dur <= 60


def stage_search(args) -> None:
    m = NameMatcher()
    cm = CategoryMatcher()
    rows = []
    ch_counter: collections.Counter = collections.Counter()
    ch_short: collections.Counter = collections.Counter()
    ch_url: dict[str, str] = {}

    cats = CATEGORIES2 if getattr(args, "fresh", False) else CATEGORIES
    areas = AREAS2 if getattr(args, "fresh", False) else AREAS
    for cat in cats:
        for area in areas:
            q = f"{cat} {area}"
            vids = search(q, args.per_query, shorts_filter=True)
            n_sh = sum(1 for v in vids if is_short(v))
            hit = 0
            for v in vids:
                t = (v.get("title") or "").strip()
                ch = (v.get("channel") or "").strip()
                sh = is_short(v)
                cu = v.get("channel_url") or v.get("uploader_url") or ""
                if ch:
                    ch_counter[ch] += 1
                    ch_url[ch] = ch_url.get(ch) or cu
                    if sh:
                        ch_short[ch] += 1
                rests = m.match_corroborated(t) if t else set()
                if rests:
                    hit += 1
                rows.append({"query": q, "title": t, "channel": ch,
                             "channel_url": (v.get("channel_url")
                                             or v.get("uploader_url") or ""),
                             "duration": v.get("duration"), "is_short": sh,
                             "stores": sorted(rests),
                             "cats": sorted({c["dish_category_id"]
                                             for c in cm.match(t)}) if t else []})
            print(f"  {q:16} 取得 {len(vids):>3}  Shorts {n_sh:>3}  店特定 {hit:>3}",
                  file=sys.stderr)

    n = len(rows)
    n_sh = sum(1 for r in rows if r["is_short"])
    sh_rows = [r for r in rows if r["is_short"]]
    sh_hit = sum(1 for r in sh_rows if r["stores"])
    lg_rows = [r for r in rows if not r["is_short"]]
    lg_hit = sum(1 for r in lg_rows if r["stores"])

    print(f"\n=== カテゴリ×エリア検索（4分未満フィルタ）===", file=sys.stderr)
    print(f"  取得 {n:,} 本 / Shorts(60秒以下) {n_sh:,} = {n_sh/max(n,1)*100:.1f}%",
          file=sys.stderr)
    print(f"  **Shorts の店舗特定率 {sh_hit}/{len(sh_rows)} = "
          f"{sh_hit/max(len(sh_rows),1)*100:.2f}%**", file=sys.stderr)
    print(f"  同じ検索の長尺  {lg_hit}/{len(lg_rows)} = "
          f"{lg_hit/max(len(lg_rows),1)*100:.2f}%", file=sys.stderr)
    print(f"  distinct 店舗（全体）{len({s for r in rows for s in r['stores']}):,}",
          file=sys.stderr)

    print(f"\n=== Shorts を多く出しているチャンネル上位20 ===", file=sys.stderr)
    top = sorted(ch_short.items(), key=lambda kv: -kv[1])[:20]
    for c, k in top:
        print(f"  {c[:34]:36} Shorts {k:>3} / 全 {ch_counter[c]:>3}", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / ("shorts_route_search_fresh.json" if getattr(args, "fresh", False)
                   else "shorts_route_search.json")
    p.write_text(json.dumps(
        {"n": n, "n_short": n_sh, "short_hit": sh_hit, "n_short_rows": len(sh_rows),
         "long_hit": lg_hit, "n_long_rows": len(lg_rows),
         "top_short_channels": [{"channel": c, "shorts": k, "total": ch_counter[c],
                                 "url": ch_url.get(c, "")} for c, k in top],
         "rows": rows,
         "caveat": "4分未満フィルタ付き検索。Shorts判定は duration<=60秒。"
                   "店舗特定は NameMatcher.match_corroborated（店名×地名の裏取り）。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


def stage_channels(args) -> None:
    """Shorts 主体チャンネルの /shorts タブを辿り、1chあたり distinct 店舗数を測る。

    ①の長尺チャンネル巡回の実測は **15.85店/ch**（758ch → 12,013店）。
    これと比べて Shorts チャンネルが多いか少ないかで、この経路の価値が決まる。
    """
    src = OUT_DIR / "shorts_route_search.json"
    d = json.loads(src.read_text(encoding="utf-8"))
    chans = [c for c in d["top_short_channels"] if c.get("url")][: args.max_channels]
    m = NameMatcher()
    cm = CategoryMatcher()

    rows = []
    all_stores: set[str] = set()
    for c in chans:
        url = c["url"].rstrip("/") + "/shorts"
        cmd = [YT, "--flat-playlist", "--dump-json",
               "--playlist-end", str(args.per_channel), url]
        try:
            p = subprocess.run(cmd, capture_output=True, timeout=300)
        except subprocess.TimeoutExpired:
            rows.append({"channel": c["channel"], "ok": False})
            continue
        vids = []
        for line in p.stdout.decode("utf-8", "replace").splitlines():
            try:
                vids.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        stores: set[str] = set()
        cats: set[str] = set()
        for v in vids:
            t = (v.get("title") or "").strip()
            if not t:
                continue
            stores |= m.match_corroborated(t)
            cats |= {x["dish_category_id"] for x in cm.match(t)}
        all_stores |= stores
        rows.append({"channel": c["channel"], "ok": True, "n_videos": len(vids),
                     "n_stores": len(stores), "n_cats": len(cats),
                     "stores": sorted(stores)})
        print(f"  {c['channel'][:30]:32} Shorts {len(vids):>4} 本 → "
              f"distinct 店 {len(stores):>3} / カテゴリ {len(cats):>2}", file=sys.stderr)

    ok = [r for r in rows if r.get("ok")]
    tot_v = sum(r["n_videos"] for r in ok)
    tot_s = sum(r["n_stores"] for r in ok)
    print(f"\n=== Shorts チャンネル巡回 ===", file=sys.stderr)
    print(f"  チャンネル {len(ok)} / Shorts 動画 {tot_v:,} 本", file=sys.stderr)
    print(f"  **1チャンネルあたり distinct 店舗 {tot_s/max(len(ok),1):.2f}店**"
          f"（①の長尺は 15.85店/ch）", file=sys.stderr)
    print(f"  重複除去した全体の distinct 店舗 {len(all_stores):,}", file=sys.stderr)
    print(f"  1動画あたり店舗 {tot_s/max(tot_v,1):.3f}", file=sys.stderr)

    p2 = OUT_DIR / "shorts_route_channels.json"
    p2.write_text(json.dumps(
        {"n_channels": len(ok), "n_videos": tot_v, "sum_stores": tot_s,
         "stores_per_channel": tot_s / max(len(ok), 1),
         "distinct_stores_all": len(all_stores),
         "baseline_longform_per_channel": 15.85,
         "rows": rows,
         "caveat": "店舗特定は NameMatcher.match_corroborated（店名×地名の裏取り）。"
                   "経路存在率であって実効ではない。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p2.name}", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", choices=("search", "channels"), default="search")
    ap.add_argument("--max-channels", type=int, default=20)
    ap.add_argument("--per-channel", type=int, default=200)
    ap.add_argument("--per-query", type=int, default=30)
    ap.add_argument("--fresh", action="store_true",
                    help="未目視の第2標本（別カテゴリ×別エリア）で取る")
    args = ap.parse_args()
    {"search": stage_search, "channels": stage_channels}[args.stage](args)


if __name__ == "__main__":
    main()
