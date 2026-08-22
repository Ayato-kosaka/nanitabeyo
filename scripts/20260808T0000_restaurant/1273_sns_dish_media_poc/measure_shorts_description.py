#!/usr/bin/env python3
"""#1345 Shorts の店名は「概要欄」に書かれているのではないか

## なぜ

オーナー指摘「ラーメンで検索したらショートのラーメンチャンネルはいっぱいある。
できそうな気がするけどな」は正しかった。カテゴリ検索での Shorts 店舗特定率は
**9.19%**（同じ検索の長尺 4.58% の 2.0倍）。**Shorts の方が良い。**

ところがチャンネル巡回にすると **2.10店/ch**（長尺 15.85店/ch）まで落ちる。
この落差の原因候補は3つある。

  1. 屋号が母集団に無い（改名・新店）
  2. 同名2箇所以上で `NameMatcher` の辞書から落ちている（→ `measure_multiplace_cost.py`）
  3. **店名がタイトルではなく概要欄にしか無い**（← 本スクリプト）

チャンネル巡回は `--flat-playlist` でタイトルしか取っていない。
Shorts はタイトルが短く煽り文句だけのことが多い。一方、概要欄には
住所・食べログURL・営業時間が書かれる慣習がある。
**もしそうなら、概要欄を取るだけで巡回の収量が変わる。**

## 測るもの（**巡回そのもので測る**）

検索結果ではなく、**チャンネル巡回**で測る。落差が出ているのは巡回だからである。
Shorts 主体チャンネルの `/shorts` タブから動画IDを取り、1本ずつ概要欄を引いて

  - タイトルのみでの **1chあたり distinct 店舗数**（現行 2.10店/ch）
  - タイトル＋概要欄での **1chあたり distinct 店舗数**
  - 概要欄に URL（食べログ/Google Maps）・住所がある割合
  - **増分は目視標本を出す**

## この測定が言えないこと

経路存在率であって実効カバレッジではない。
概要欄取得は1本ずつメタデータを引くので**巡回コストが跳ね上がる**（実測を出す）。

実行:
    python3 measure_shorts_description.py --channels 6 --per-channel 40
"""

from __future__ import annotations

import argparse
import collections
import json
import re
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_channel_traversal import NameMatcher  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
YT = "/tmp/yt-dlp-latest"

URL_PATTERNS = {
    "食べログ": re.compile(r"tabelog\.com", re.I),
    "GoogleMaps": re.compile(r"(maps\.app\.goo\.gl|google\.[a-z.]+/maps|goo\.gl/maps)", re.I),
    "Instagram": re.compile(r"instagram\.com", re.I),
    "X/Twitter": re.compile(r"(twitter\.com|x\.com/)", re.I),
    "その他URL": re.compile(r"https?://", re.I),
}
ADDR = re.compile(r"(北海道|東京都|京都府|大阪府|.{2,3}県)[^\n]{0,30}?[市区町村]")


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
    ap.add_argument("--channels", type=int, default=6)
    ap.add_argument("--per-channel", type=int, default=40)
    args = ap.parse_args()

    d = json.loads((OUT_DIR / "shorts_route_search.json").read_text(encoding="utf-8"))
    chans = [c for c in d["top_short_channels"] if c.get("url")][: args.channels]
    print(f"対象チャンネル {len(chans)}", file=sys.stderr)

    m = NameMatcher()
    rows = []
    url_cnt: collections.Counter = collections.Counter()
    n_desc_ok = n_addr = 0
    desc_len: list[int] = []
    gained = []
    t_start = time.time()

    for c in chans:
        url = c["url"].rstrip("/") + "/shorts"
        vids = yt_json([YT, "--flat-playlist", "--dump-json",
                        "--playlist-end", str(args.per_channel), url], 300)
        ids = [v.get("id") for v in vids if v.get("id")]
        if not ids:
            print(f"  {c['channel'][:28]:30} 取得0（スキップ）", file=sys.stderr)
            continue
        st_title: set[str] = set()
        st_both: set[str] = set()
        n_ok = 0
        for vid in ids:
            meta = yt_json([YT, "--skip-download", "--dump-json", "--no-warnings",
                            "--extractor-args", "youtube:player_client=android",
                            f"https://www.youtube.com/watch?v={vid}"], 90)
            if not meta:
                continue
            meta = meta[0]
            n_ok += 1
            n_desc_ok += 1
            title = (meta.get("title") or "").strip()
            desc = (meta.get("description") or "").strip()
            desc_len.append(len(desc))
            a = m.match_corroborated(title) if title else set()
            b = m.match_corroborated(f"{title}\n{desc}") if (title or desc) else set()
            st_title |= a
            st_both |= b
            if b - a and len(gained) < 40:
                gained.append({"channel": c["channel"], "vid": vid,
                               "title": title[:60], "names": sorted(b - a),
                               "desc_head": desc[:220]})
            for k, rx in URL_PATTERNS.items():
                if rx.search(desc):
                    url_cnt[k] += 1
            if ADDR.search(desc):
                n_addr += 1
        rows.append({"channel": c["channel"], "n_videos": len(ids), "n_meta_ok": n_ok,
                     "stores_title": sorted(st_title), "stores_both": sorted(st_both)})
        print(f"  {c['channel'][:28]:30} 動画 {len(ids):>3} 概要取得 {n_ok:>3} "
              f"→ タイトルのみ {len(st_title):>3}店 / 概要込み {len(st_both):>3}店",
              file=sys.stderr)

    if n_desc_ok == 0:
        print("**概要欄の取得が0件。レート制限の可能性。数字を出さない。**", file=sys.stderr)
        raise SystemExit(2)

    nch = len(rows)
    sum_t = sum(len(r["stores_title"]) for r in rows)
    sum_b = sum(len(r["stores_both"]) for r in rows)
    elapsed = time.time() - t_start
    print(f"\n=== Shorts チャンネル巡回 {nch}ch / 概要欄取得 {n_desc_ok} 本 ===",
          file=sys.stderr)
    print(f"  タイトルのみ  **{sum_t/max(nch,1):.2f}店/ch**（既報 2.10店/ch）",
          file=sys.stderr)
    print(f"  概要欄込み    **{sum_b/max(nch,1):.2f}店/ch**"
          f"（倍率 {sum_b/max(sum_t,1):.2f}x）", file=sys.stderr)
    print(f"  長尺の実測は 15.85店/ch", file=sys.stderr)
    desc_len.sort()
    med = desc_len[len(desc_len) // 2] if desc_len else 0
    print(f"\n  概要欄 中央値 {med} 文字 / 空 "
          f"{sum(1 for x in desc_len if x == 0)} 本", file=sys.stderr)
    print(f"  住所らしき記述 {n_addr}/{n_desc_ok} = {n_addr/n_desc_ok*100:.2f}%",
          file=sys.stderr)
    for k, v in url_cnt.most_common():
        print(f"  {k:12} {v:>4}/{n_desc_ok} = {v/n_desc_ok*100:5.2f}%", file=sys.stderr)
    print(f"\n  **コスト: {elapsed:.0f}秒 / {n_desc_ok}本 = "
          f"{elapsed/max(n_desc_ok,1):.2f}秒/本**"
          f"（タイトルのみなら1チャンネル1回の呼び出しで済む）", file=sys.stderr)

    print(f"\n=== 増分の目視標本（precision を人が確かめる）===", file=sys.stderr)
    for g in gained[:15]:
        print(f"  {g['names']}  ← {g['title'][:44]}", file=sys.stderr)
        print(f"      {g['desc_head'][:110]!r}", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "shorts_description.json"
    p.write_text(json.dumps(
        {"n_channels": nch, "n_desc_ok": n_desc_ok,
         "stores_per_ch_title": sum_t / max(nch, 1),
         "stores_per_ch_both": sum_b / max(nch, 1),
         "baseline_longform_per_channel": 15.85,
         "median_desc_len": med, "n_addr": n_addr,
         "url_counts": dict(url_cnt), "seconds_per_video": elapsed / max(n_desc_ok, 1),
         "gained": gained, "rows": rows,
         "caveat": "経路存在率。増分の precision は目視で確かめること。"
                   "概要欄取得は1本ずつメタデータを引くので巡回コストが上がる。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
