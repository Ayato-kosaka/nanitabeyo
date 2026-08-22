#!/usr/bin/env python3
"""#1345 #1273 長い尾の店は、**Shorts の面**なら見つかるのか

## なぜ

直前の実測（`measure_longtail_posts_exist.py`）で、

  - Overture に無い店（長い尾）… 屋号入り動画が **6.7%**（目視後）
  - Overture に在る店（既知）  … **12.5%**

と出た。これは `ytsearch`（＝通常の YouTube 検索）での値である。

ところが #1345 で分かったとおり、**`ytsearch` は Shorts をほとんど返さない**。
そして Shorts はチャンネル巡回で 16.29店/ch（長尺 15.85店/ch）を出しており、
**面としては長尺と同等以上**だった。

したがって次の問いが立つ:

    **長い尾の店は、Shorts の面でなら見つかるのではないか。**

地元の個人店を回るのは Shorts のクリエイターの方が多い、という見立てである。
（Shorts チャンネルは「福岡グルメ」「札幌グルメ」のような**地元密着型**が多かった。）

## 測るもの

**同じ決定的標本**（長い尾120店・既知120店。直前の測定と同一）に対して、

  1. `ytsearch`（通常検索・**直前の測定の再掲**）
  2. **4分未満フィルタ付きの検索URL**（`sp=EgIYAQ%3D%3D`）… Shorts が返る面

の2つを当て、**タイトルに屋号が出る率**を比べる。
同じ店・同じ手続きで面だけを変えるのが要点である。

## この測定が言えないこと

  - 「タイトルに屋号が出る」は下限（概要欄・映像内は取りこぼす）
  - **経路存在率**であって実効ではない。その Shorts に料理が写っているか、
    料理カテゴリが付くか、規約上使えるかは別
  - 機械判定には偽陽性が混じる（直前の測定では 36件中 13件が偽だった）。
    **増分は必ず目視する。**

実行:
    python3 measure_longtail_shorts_surface.py --n 120
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import subprocess
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_channel_traversal import (  # noqa: E402
    has_cjk, normalize_ja, normalize_latin,
)

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
FIXTURES = HERE / "fixtures"
YT = "/tmp/yt-dlp-latest"
SP_UNDER_4MIN = "EgIYAQ%3D%3D"

# 直前の測定と**同じ**除外（標本を揃えるため）
NON_RETAIL = re.compile(
    r"(セブン.?イレブン|ファミリーマート|ローソン|ミニストップ|デイリーヤマザキ|"
    r"セイコーマート|給食|小学校|中学校|高等学校|保育園|保育所|幼稚園|こども園|"
    r"大学|専門学校|養護学校|病院|医院|クリニック|診療所|老人|特別養護|介護|福祉|"
    r"製造|加工|工場|製パン|製麺|社員食堂|職員食堂|寮|事業所|"
    r"スーパー|マーケット|イオン(?!モール)|西友|イトーヨーカ|"
    r"高齢者住宅|サービス付き|図書館|ホール|ぷらざ|プラザ|会館|体育館|公民館|"
    r"美術館|博物館|資料館|市役所|区役所|町役場|センター$|株式会社)")


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def run(cmd: list[str], timeout: int = 120) -> list[dict]:
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


def search_plain(q: str, limit: int = 8) -> list[dict]:
    return run([YT, "--flat-playlist", "--dump-json",
                "--playlist-end", str(limit), f"ytsearch{limit}:{q}"])


def search_shorts(q: str, limit: int = 8) -> list[dict]:
    url = (f"https://www.youtube.com/results?"
           f"search_query={urllib.parse.quote_plus(q)}&sp={SP_UNDER_4MIN}")
    return run([YT, "--flat-playlist", "--dump-json",
                "--playlist-end", str(limit), url])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=120)
    args = ap.parse_args()
    csv.field_size_limit(10**7)

    places: dict[tuple, dict] = {}
    for fn, src in (("overture_jp_food.csv", "overture"),
                    ("ifas_jp_food.csv", "ifas"), ("osm_jp_food.csv", "osm")):
        fp = FIXTURES / fn
        if not fp.exists():
            continue
        with fp.open(encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                nm = (r.get("name") or "").strip()
                if not nm:
                    continue
                try:
                    lat, lon = float(r["latitude"]), float(r["longitude"])
                except (TypeError, ValueError, KeyError):
                    continue
                k = normalize_ja(nm) if has_cjk(nm) else normalize_latin(nm).strip()
                if not k or len(k) < 4:
                    continue
                pk = (k, round(lat, 3), round(lon, 3))
                e = places.setdefault(pk, {"name": nm, "key": k, "srcs": set(),
                                           "loc": ""})
                e["srcs"].add(src)
                e["loc"] = e["loc"] or (r.get("locality") or "").strip()

    rows = [v for v in places.values()
            if v["loc"] and not NON_RETAIL.search(v["name"])]
    tail = [r for r in rows if "overture" not in r["srcs"]]
    head = [r for r in rows if "overture" in r["srcs"]]

    # 直前の測定と**同じ鍵**で並べる（同一標本であることを保証する）
    def pick(pool, tag):
        return sorted(pool, key=lambda r: hashlib.sha256(
            f"{tag}/{r['name']}/{r['loc']}".encode()).hexdigest())[: args.n]

    groups = {"長い尾": pick(tail, "TAIL"), "既知": pick(head, "HEAD")}
    print(f"標本: 長い尾 {len(groups['長い尾'])} / 既知 {len(groups['既知'])}"
          f"（直前の測定と同一）", file=sys.stderr)

    result = {}
    for label, sample in groups.items():
        stat = {"plain_hit": 0, "shorts_hit": 0, "shorts_any": 0,
                "shorts_is_short": 0}
        gained = []
        detail = []
        for i, r in enumerate(sample, 1):
            q = f"{r['name']} {r['loc']}"
            pv = search_plain(q)
            sv = search_shorts(q)
            p_hit = any(r["key"] in normalize_ja(v.get("title") or "") for v in pv)
            s_titles = [(v.get("title") or "") for v in sv]
            s_hit = any(r["key"] in normalize_ja(t) for t in s_titles)
            n_short = sum(1 for v in sv
                          if (v.get("duration") or 999) <= 60)
            stat["plain_hit"] += p_hit
            stat["shorts_hit"] += s_hit
            stat["shorts_any"] += bool(sv)
            stat["shorts_is_short"] += n_short
            if s_hit and not p_hit:
                hit_title = next(t for t in s_titles if r["key"] in normalize_ja(t))
                gained.append({"name": r["name"], "loc": r["loc"],
                               "title": hit_title[:70]})
            detail.append({"name": r["name"], "loc": r["loc"],
                           "plain": p_hit, "shorts": s_hit, "n_short": n_short})
            if i % 20 == 0:
                print(f"  [{label}] {i}/{len(sample)} "
                      f"通常 {stat['plain_hit']} / Shorts面 {stat['shorts_hit']}",
                      file=sys.stderr)
        n = len(sample)
        lo1, hi1 = wilson(stat["plain_hit"], n)
        lo2, hi2 = wilson(stat["shorts_hit"], n)
        print(f"\n  **{label}** n={n}", file=sys.stderr)
        print(f"    通常検索      {stat['plain_hit']:>3}/{n} = "
              f"{stat['plain_hit']/n*100:5.2f}% [{lo1*100:.1f}, {hi1*100:.1f}]",
              file=sys.stderr)
        print(f"    **Shorts面   {stat['shorts_hit']:>3}/{n} = "
              f"{stat['shorts_hit']/n*100:5.2f}%** [{lo2*100:.1f}, {hi2*100:.1f}]",
              file=sys.stderr)
        print(f"    Shorts面で新たに見つかった {len(gained)} 件", file=sys.stderr)
        print(f"    （Shorts面が結果を返した {stat['shorts_any']}/{n}、"
              f"60秒以下の動画 計 {stat['shorts_is_short']} 本）", file=sys.stderr)
        result[label] = {"n": n, **stat, "gained": gained, "detail": detail,
                         "ci_plain": [lo1, hi1], "ci_shorts": [lo2, hi2]}

    print(f"\n=== Shorts 面で新たに見つかった店（**目視で確かめる**）===",
          file=sys.stderr)
    for label in groups:
        for g in result[label]["gained"][:12]:
            print(f"  [{label}] 『{g['name']}』({g['loc']}) → {g['title']}",
                  file=sys.stderr)

    t, h = result.get("長い尾"), result.get("既知")
    if t and h and h["shorts_hit"]:
        print(f"\n=== 比較（機械判定・目視前）===", file=sys.stderr)
        print(f"  通常検索   長い尾/既知 = "
              f"{(t['plain_hit']/t['n'])/(h['plain_hit']/h['n']):.2f}倍",
              file=sys.stderr)
        print(f"  Shorts面   長い尾/既知 = "
              f"{(t['shorts_hit']/t['n'])/(h['shorts_hit']/h['n']):.2f}倍",
              file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "longtail_shorts_surface.json"
    p.write_text(json.dumps(
        {"groups": result,
         "caveat": "『タイトルに屋号』は下限。機械判定には偽陽性が混じるので"
                   "増分は目視で確かめること。経路存在率であって実効ではない。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
