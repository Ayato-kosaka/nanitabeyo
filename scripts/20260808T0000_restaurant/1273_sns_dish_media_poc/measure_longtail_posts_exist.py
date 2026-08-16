#!/usr/bin/env python3
"""#1273 長い尾の店について、そもそも**投稿が存在するのか**を直接測る

## なぜ（ここまでの推論を、推論のまま終わらせないため）

ここまでで分かったこと:

  - 「リンク無し層」は店の性質ではなく **Overture の取りこぼし**（99.92%）
  - IFAS の店名は**普通の屋号**であって申請者名ではない（照合は可能）
  - それでも SNS 経路はこれらの店を見つけない（リンク無し率 0.12〜0.68倍）

ここから「**誰もその店の投稿をしていないからだ**」と推論した。
**だが推論である。** 直接確かめる。

## 測るもの

Overture に無い店（＝IFAS/OSM のみ＝リンク無し層）から決定的標本を取り、
**1店ずつ「屋号 市区町村」で YouTube を検索**して、

  1. 検索結果が1本でも返るか
  2. そのタイトルに**その屋号が含まれるか**（＝本当にその店の動画か）

を数える。比較のため、**Overture に在る店（リンク有り層）**からも同数取り、
同じ検索をする。**同じ手続きで両者を比べる**のが要点である。

## この測定が言えないこと

  - YouTube だけである。Instagram/TikTok/ブログは別
  - 検索は yt-dlp 経由で、YouTube の検索順位に依存する
  - 「タイトルに屋号が含まれる」は下限。概要欄や映像の中にある場合は取りこぼす

実行:
    python3 measure_longtail_posts_exist.py --n 40
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
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_channel_traversal import (  # noqa: E402
    has_cjk, normalize_ja, normalize_latin,
)

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
FIXTURES = HERE / "fixtures"
YT = "/tmp/yt-dlp-latest"

# 消費者向け飲食店ではない可能性が高いもの（別に数える）
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


def search(q: str, limit: int = 8) -> list[dict]:
    try:
        p = subprocess.run([YT, "--flat-playlist", "--dump-json",
                            "--playlist-end", str(limit), f"ytsearch{limit}:{q}"],
                           capture_output=True, timeout=120)
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
    ap.add_argument("--n", type=int, default=40)
    args = ap.parse_args()
    csv.field_size_limit(10**7)

    # --- 重複除去して「Overture に在るか」で2群に分ける ---------------------
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

    # 【自戒】最初の版は非消費者向けを標本に入れたまま比べていた。
    # 長い尾の「一致」6件を目視したら、図書館・展示会場・別の県の同名店が混ざり、
    # **実質は 3件**だった（15.0% → 7.5%）。頭側も 8→7 件。
    # 標本の段階で非消費者向けを外し、**一致は目視で確かめる前提**にする。
    rows = [v for v in places.values()
            if v["loc"] and not NON_RETAIL.search(v["name"])]
    tail = [r for r in rows if "overture" not in r["srcs"]]
    head = [r for r in rows if "overture" in r["srcs"]]
    print(f"店 {len(rows):,} → Overture に無い（長い尾）{len(tail):,} / "
          f"在る {len(head):,}", file=sys.stderr)

    def pick(pool, tag):
        return sorted(pool, key=lambda r: hashlib.sha256(
            f"{tag}/{r['name']}/{r['loc']}".encode()).hexdigest())[: args.n]

    groups = {"長い尾(Overtureに無い)": pick(tail, "TAIL"),
              "既知(Overtureに在る)": pick(head, "HEAD")}

    result = {}
    for label, sample in groups.items():
        n_any = n_hit = n_non = 0
        detail = []
        for r in sample:
            if NON_RETAIL.search(r["name"]):
                n_non += 1
            q = f"{r['name']} {r['loc']}"
            vids = search(q)
            titles = [(v.get("title") or "") for v in vids]
            any_res = len(vids) > 0
            hit = any(r["key"] in normalize_ja(t) for t in titles)
            n_any += any_res
            n_hit += hit
            detail.append({"name": r["name"], "loc": r["loc"], "n_results": len(vids),
                           "title_hit": hit,
                           "top": titles[0][:60] if titles else ""})
            print(f"  [{label[:6]}] {r['name'][:24]:26} {r['loc'][:10]:12} "
                  f"結果{len(vids):>2} 屋号一致={'○' if hit else '×'}", file=sys.stderr)
        n = len(sample)
        lo, hi = wilson(n_hit, n)
        print(f"\n  **{label}** n={n}", file=sys.stderr)
        print(f"    検索結果が返った        {n_any}/{n} = {n_any/n*100:.1f}%",
              file=sys.stderr)
        print(f"    **タイトルに屋号が出た  {n_hit}/{n} = {n_hit/n*100:.1f}%** "
              f"[{lo*100:.1f}, {hi*100:.1f}]", file=sys.stderr)
        print(f"    （うち消費者向けでない疑い {n_non} 件）", file=sys.stderr)
        result[label] = {"n": n, "any": n_any, "hit": n_hit, "non_retail": n_non,
                         "ci": [lo, hi], "detail": detail}

    a = result.get("長い尾(Overtureに無い)")
    b = result.get("既知(Overtureに在る)")
    if a and b and b["hit"]:
        print(f"\n=== 比較 ===", file=sys.stderr)
        print(f"  長い尾 {a['hit']/a['n']*100:.1f}% 対 既知 {b['hit']/b['n']*100:.1f}%"
              f" = **{(a['hit']/a['n'])/(b['hit']/b['n']):.2f}倍**", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "longtail_posts_exist.json"
    p.write_text(json.dumps(
        {"groups": result,
         "caveat": "YouTube のみ。検索順位に依存する。"
                   "『タイトルに屋号』は下限（概要欄や映像内は取りこぼす）。"
                   "経路存在率であって実効ではない。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
