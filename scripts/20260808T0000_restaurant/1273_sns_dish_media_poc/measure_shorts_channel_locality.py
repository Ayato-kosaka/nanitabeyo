#!/usr/bin/env python3
"""#1345 Shorts の店舗特定を「チャンネルの地域」で救えるか

## なぜ（前ラウンドで分かったこと）

Shorts チャンネル巡回は 2.10店/ch（長尺 15.85店/ch の 1/7.5）だった。
原因を実物で追ったところ、**当初の見立て2つがどちらも外れていた**。

  1. ×「タイトルに店名が無い」… **入っている**（「うましか食堂」「TEA SPOT サフラン」）
  2. ×「地名が無いから裏取りに落ちる」… `match()`（裏取り無し）でも **0件**

本当の原因は**辞書に載っていない**ことだった。母集団を引くと:

  - 「うましか食堂」… **0行**（タイトルに「ロクスイから店名変更」とあり母集団が古い）
  - 「サフラン」85行 / 「ゲルン」3行 / 「そらとたべる」2行
    … 存在するが **`NameMatcher` は同名が2箇所以上ある屋号を辞書から落とす**（#1273 §23）。
      支店を確定できないためで、逆引きとしては正しい判断。

つまり Shorts で落ちているのは**多拠点同名の店**である。
**チャンネルの地域が分かれば、同名の中から1つに絞れる可能性がある。**

## 測るもの

Shorts チャンネルごとに、そのチャンネルが**どの都道府県のチャンネルか**を推定し、
「同名2箇所以上で辞書から落ちている屋号」を**その都道府県に限れば一意に決まるか**を数える。

  - 地域の推定は**検索クエリのエリア**（そのチャンネルが出てきた検索語）から取る。
    チャンネル名から取る方法もあるが、クエリの方が実測に基づく。
  - 一意に決まる割合が高ければ、**チャンネル地域を鍵にした辞書**で Shorts が救える。

## この測定が言えないこと

「一意に決まる」は経路存在率であって実効ではない。
その店の Shorts が本当にその店を写しているかは目視が要る。

実行:
    python3 measure_shorts_channel_locality.py --max-channels 12 --per-channel 120
"""

from __future__ import annotations

import argparse
import collections
import csv
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_channel_traversal import (  # noqa: E402
    NameMatcher, has_cjk, normalize_ja, normalize_latin,
)

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
FIXTURES = HERE / "fixtures"
YT = "/tmp/yt-dlp-latest"
SOURCES = ("overture_jp_food.csv", "ifas_jp_food.csv", "osm_jp_food.csv")

# 検索エリア語 -> 都道府県（このPoCで使ったエリアだけ）
AREA_PREF = {
    "新宿": "東京都", "大阪": "大阪府", "福岡": "福岡県",
    "札幌": "北海道", "仙台": "宮城県", "高松": "香川県",
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-channels", type=int, default=12)
    ap.add_argument("--per-channel", type=int, default=120)
    args = ap.parse_args()
    csv.field_size_limit(10**7)

    # --- 母集団を「屋号 -> [(都道府県, 市区町村)]」で持つ（辞書から落ちた分も含む）---
    by_name: dict[str, list] = collections.defaultdict(list)
    for fn in SOURCES:
        fp = FIXTURES / fn
        if not fp.exists():
            continue
        with fp.open(encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                nm = (r.get("name") or "").strip()
                if not nm:
                    continue
                k = normalize_ja(nm) if has_cjk(nm) else normalize_latin(nm).strip()
                if not k or len(k) < 4:
                    continue
                by_name[k].append((normalize_ja(r.get("region") or ""),
                                   normalize_ja(r.get("locality") or "")))
    print(f"屋号索引 {len(by_name):,}（辞書から落ちた多拠点同名も含む）", file=sys.stderr)

    # --- Shorts チャンネルとその出現エリア ---------------------------------
    d = json.loads((OUT_DIR / "shorts_route_search.json").read_text(encoding="utf-8"))
    ch_area: dict[str, set] = collections.defaultdict(set)
    for r in d["rows"]:
        if r.get("channel"):
            area = r["query"].split()[-1]
            if area in AREA_PREF:
                ch_area[r["channel"]].add(AREA_PREF[area])
    chans = [c for c in d["top_short_channels"] if c.get("url")][: args.max_channels]

    m = NameMatcher()
    # 屋号の最長一致で候補を拾うためのソート済みキー（長い順）
    names_sorted = sorted(by_name, key=len, reverse=True)
    name_set = set(by_name)

    rows = []
    tot = collections.Counter()
    for c in chans:
        prefs = ch_area.get(c["channel"], set())
        url = c["url"].rstrip("/") + "/shorts"
        try:
            p = subprocess.run([YT, "--flat-playlist", "--dump-json",
                                "--playlist-end", str(args.per_channel), url],
                               capture_output=True, timeout=300)
        except subprocess.TimeoutExpired:
            continue
        titles = []
        for line in p.stdout.decode("utf-8", "replace").splitlines():
            try:
                titles.append((json.loads(line).get("title") or "").strip())
            except json.JSONDecodeError:
                continue
        if not titles:
            continue

        cur = collections.Counter()
        examples = []
        for t in titles:
            tj = normalize_ja(t)
            # 現行の逆引き（裏取りあり）
            if m.match_corroborated(t):
                cur["現行で特定"] += 1
                tot["現行で特定"] += 1
                continue
            # 辞書から落ちている屋号を、タイトル中の最長一致で拾う
            hit = None
            for nm in names_sorted:
                if len(nm) >= 4 and nm in tj:
                    hit = nm
                    break
            if not hit:
                cur["屋号が母集団に無い"] += 1
                tot["屋号が母集団に無い"] += 1
                continue
            places = by_name[hit]
            if prefs:
                narrowed = [x for x in places if x[0] in prefs]
            else:
                narrowed = places
            if len(places) == 1:
                cur["元から一意"] += 1
                tot["元から一意"] += 1
            elif len(narrowed) == 1:
                cur["**県で一意になる**"] += 1
                tot["**県で一意になる**"] += 1
                if len(examples) < 5:
                    examples.append({"title": t[:70], "name": hit,
                                     "places": len(places), "pref": sorted(prefs)})
            elif len(narrowed) == 0:
                cur["県外（別地域の同名のみ）"] += 1
                tot["県外（別地域の同名のみ）"] += 1
            else:
                cur["県内でも複数"] += 1
                tot["県内でも複数"] += 1

        rows.append({"channel": c["channel"], "prefs": sorted(prefs),
                     "n_titles": len(titles), "breakdown": dict(cur),
                     "examples": examples})
        print(f"  {c['channel'][:26]:28} {','.join(sorted(prefs))[:10]:12} "
              f"n={len(titles):>4} " +
              " ".join(f"{k}={v}" for k, v in cur.most_common(3)), file=sys.stderr)

    n = sum(tot.values())
    print(f"\n=== Shorts タイトル {n:,} 本の内訳 ===", file=sys.stderr)
    for k, v in tot.most_common():
        print(f"  {k:22} {v:>6,} = {v/max(n,1)*100:>5.2f}%", file=sys.stderr)
    gain = tot["**県で一意になる**"]
    cur_ok = tot["現行で特定"] + tot["元から一意"]
    print(f"\n  現行で特定できている: {cur_ok:,} = {cur_ok/max(n,1)*100:.2f}%",
          file=sys.stderr)
    print(f"  **チャンネル県で救える: +{gain:,} = +{gain/max(n,1)*100:.2f}pt**",
          file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p2 = OUT_DIR / "shorts_channel_locality.json"
    p2.write_text(json.dumps({"n_titles": n, "totals": dict(tot),
                              "current_ok": cur_ok, "rescued_by_pref": gain,
                              "rows": rows,
                              "caveat": "経路存在率。県で一意になっても、その Shorts が"
                                        "本当にその店かは目視で確かめていない。"},
                             ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p2.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
