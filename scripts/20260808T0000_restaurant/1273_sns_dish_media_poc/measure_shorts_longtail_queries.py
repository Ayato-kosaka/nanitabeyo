#!/usr/bin/env python3
"""#1345 【オーナーの反論を測る】料理カテゴリ駆動なら裾は伸びるのか

## なぜ

前の測定は **カテゴリ8種 × 三大都市圏など8エリア = 64検索**で、
裾は **1.75 店/検索**だった。そこから「62,000検索が要る」と見積もった。

オーナーの指摘:

    「料理カテゴリ駆動もあり得るんじゃないですか。やきとり / ラーメン /
      ピザ 山梨 で検索とか」

**この指摘は当たっている可能性が高い。** 私が測った飽和は
**8エリアの中での飽和**であって、山梨や鳥取の話を何も言っていない。
検索語の空間は実際には

    料理カテゴリ 134種（`fixtures/public_dish_categories_134_gate.csv`）
      × 都道府県 47   = 6,298 通り

あり、私はその **1.0%（64通り）しか、しかも都市部に偏って**見ていなかった。

## 測るもの

同じ収集・同じ抽出器（地名優先 v1）で、**問い合わせの作り方だけ**を変えて比べる。

    A 既測: 広いカテゴリ8 × 大都市8      → 裾 1.75 店/検索（実測済み）
    B 今回: **長尾の料理名 × 非大都市県**  → 裾 ? 店/検索

B が A より明らかに大きければ、**「62,000検索」の見積もりは下がる**。
同じくらいなら、見積もりは維持される。

## この測定が言えないこと

  - 検索結果は実行ごとに変わる
  - **経路存在率**である。目視 precision 70.0%（別途実測）を掛けて読むこと
  - 裾の推定は**この標本のこの順序**での話である

実行:
    python3 measure_shorts_longtail_queries.py --n-queries 60
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
YT = "/tmp/yt-dlp-latest"
SP_UNDER_4MIN = "EgIYAQ%3D%3D"

# 大都市を**外した**県。オーナーの例（山梨）を含む。
PREFS = ["山梨", "鳥取", "島根", "佐賀", "徳島", "高知", "福井", "秋田",
         "青森", "宮崎", "山形", "岩手", "和歌山", "富山", "香川", "大分"]


def search(query: str, limit: int) -> list[dict]:
    q = urllib.parse.quote_plus(query)
    url = f"https://www.youtube.com/results?search_query={q}&sp={SP_UNDER_4MIN}"
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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n-queries", type=int, default=60)
    ap.add_argument("--per-query", type=int, default=40)
    args = ap.parse_args()

    dishes = []
    with (HERE / "fixtures" / "public_dish_categories_134_gate.csv").open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            ja = (r.get("label_ja") or "").strip()
            if ja:
                dishes.append((ja, float(r.get("market_salience_jp") or 0)))
    # 有名すぎる料理は既測と重なるので、salience の低い側＝長尾から取る
    dishes.sort(key=lambda t: t[1])
    longtail = [d for d, _ in dishes[: len(dishes) * 2 // 3]]
    rnd = random.Random(20260819)
    pairs = []
    while len(pairs) < args.n_queries:
        p = (rnd.choice(longtail), rnd.choice(PREFS))
        if p not in pairs:
            pairs.append(p)

    seen: dict[str, dict] = {}
    for i, (dish, pref) in enumerate(pairs, 1):
        q = f"{dish} {pref}"
        vids = search(q, args.per_query)
        n_sh = 0
        for v in vids:
            d = v.get("duration")
            if d is None or d > 60:
                continue
            n_sh += 1
            vid = v.get("id")
            if vid and vid not in seen:
                seen[vid] = {"id": vid, "title": (v.get("title") or "").strip(),
                             "duration": d, "channel": v.get("channel"),
                             "channel_id": v.get("channel_id"), "query": q}
        print(f"  [{i:>3}/{len(pairs)}] {q:22} 取得 {len(vids):>3} / "
              f"60秒以下 {n_sh:>3} / 累計 {len(seen)}", file=sys.stderr, flush=True)
        time.sleep(0.4)

    p = OUT_DIR / "shorts_longtail_pool.json"
    p.write_text(json.dumps({"n_queries": len(pairs), "per_query": args.per_query,
                             "prefs": PREFS, "queries": [f"{a} {b}" for a, b in pairs],
                             "n_shorts": len(seen), "rows": list(seen.values()),
                             "caveat": "検索結果は実行ごとに変わる。経路存在率であって"
                                       "実効ではない（目視 precision 70.0% を掛ける）。"},
                            ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}  distinct Shorts **{len(seen)}**", file=sys.stderr)


if __name__ == "__main__":
    main()
