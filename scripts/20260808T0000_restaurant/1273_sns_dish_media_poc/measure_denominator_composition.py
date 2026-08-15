#!/usr/bin/env python3
"""#1273 KPI の分母を MECE に分解する（消費者向け飲食店は何店なのか）

## なぜ

オーナー指摘: 「オープンデータ全件が N 件、うち非消費者向けが M 件なので省き、
残り N-M 件のうち何件に dish_media が付いているか」という形で報告すべき。
**いきなり『分母は N-M 件でした』と報告するな**、とのこと。そのとおりである。

前節（`measure_nolink_composition.py`）は**リンク無し層しか測っておらず**、
しかも**行ベース**（437,816行）で数えていた。恒等式で使う 343,247 は
**重複除去後の seed 数**なので、あの比率をそのまま分母に掛けることはできない。

本スクリプトは、
  1. **重複除去後の店舗単位**で数え直す（行ではなく店）
  2. **リンク有り層とリンク無し層の両方**で非消費者向けを測る
  3. 全数の語彙カウント（下限）と、決定的標本の目視（実態）の両方を出す

## 非消費者向けとは

IFAS は食品衛生法の**営業許可の台帳**であって、消費者向け飲食店の一覧ではない。
コンビニ・スーパーの惣菜売場・病院内保育園・学校/寮の食堂・社員食堂・食品製造業
などが同じ台帳に載る。これらは「料理写真を撮って店として見せる」対象ではない。

**これは要求 70% を下げる話ではない。分母が何なのかを確定させる話である。**
省くかどうかはオーナーが決める。ここでは**何件あるか**だけを出す。

**ネットワークアクセスは一切しない。**

実行:
    python3 measure_denominator_composition.py --sample 60
"""

from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import json
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_channel_traversal import has_cjk, normalize_ja, normalize_latin  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
FIXTURES = HERE / "fixtures"
SOURCES = ("overture_jp_food.csv", "ifas_jp_food.csv", "osm_jp_food.csv")

# 消費者向けの飲食店では**ない**ことを示唆する語（手書き＝下限）
NON_RETAIL = {
    "コンビニ": re.compile(
        r"セブン.?イレブン|ファミリーマート|ローソン|ミニストップ|デイリーヤマザキ|"
        r"セイコーマート|ポプラ|ニューデイズ|newdays|7-eleven|familymart|lawson", re.I),
    "スーパー・小売": re.compile(
        r"スーパー|マーケット|イオン(?!モール)|イトーヨーカ|西友|ライフ|マルエツ|"
        r"サミット|ヨークベニマル|アピタ|ドン・?キホーテ|business|酒販|卸|問屋|直売"),
    "給食・学校・保育": re.compile(
        r"給食|小学校|中学校|高等学校|高校|保育園|保育所|幼稚園|こども園|学園|"
        r"大学|高専|専門学校"),
    "病院・福祉": re.compile(
        r"病院|医院|クリニック|診療所|老人|特別養護|介護|福祉|デイサービス|療育"),
    "製造・加工": re.compile(
        r"製造|加工|工場|製パン|製麺|製菓|食品工業|プラント|セントラルキッチン"),
    "社員食堂・寮・事業所": re.compile(
        r"社員食堂|職員食堂|社宅|寮|事業所|株式会社(?!.*(店|亭|軒|屋))"),
    "宿泊": re.compile(r"ホテル|旅館|民宿|ペンション|国民宿舎|山荘|コテージ"),
}


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=60)
    args = ap.parse_args()
    csv.field_size_limit(10**7)

    # --- 重複除去（行ではなく店で数える）-----------------------------------
    places: dict[tuple, dict] = {}
    n_rows = 0
    for fn in SOURCES:
        p = FIXTURES / fn
        if not p.exists():
            continue
        src = fn.split("_")[0]
        with p.open(encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                name = (r.get("name") or "").strip()
                if not name:
                    continue
                try:
                    lat, lon = float(r["latitude"]), float(r["longitude"])
                except (TypeError, ValueError, KeyError):
                    continue
                n_rows += 1
                key = normalize_ja(name) if has_cjk(name) else normalize_latin(name).strip()
                if not key:
                    continue
                pk = (key, round(lat, 3), round(lon, 3))
                has = (int(r.get("n_socials") or 0) > 0
                       or int(r.get("n_websites") or 0) > 0)
                cur = places.get(pk)
                if cur is None:
                    places[pk] = {"name": name, "has_link": has, "source": src,
                                  "cat": (r.get("basic_category") or "").strip(),
                                  "loc": (r.get("locality") or "").strip(),
                                  "id": r.get("id") or ""}
                else:
                    cur["has_link"] = cur["has_link"] or has

    rows = list(places.values())
    link = [r for r in rows if r["has_link"]]
    nolink = [r for r in rows if not r["has_link"]]
    print(f"行 {n_rows:,} -> **重複除去後の店 {len(rows):,}**", file=sys.stderr)
    print(f"  リンク有り {len(link):,} = {len(link)/len(rows)*100:.2f}%", file=sys.stderr)
    print(f"  リンク無し {len(nolink):,} = {len(nolink)/len(rows)*100:.2f}%",
          file=sys.stderr)

    # --- 語彙による全数カウント（下限）-------------------------------------
    def tag(r: dict) -> str | None:
        for k, rx in NON_RETAIL.items():
            if rx.search(r["name"]):
                return k
        return None

    print(f"\n=== 非消費者向け（屋号の語彙・全数・**下限**）===", file=sys.stderr)
    print(f"{'型':22}{'リンク有り':>10}{'リンク無し':>10}{'合計':>10}", file=sys.stderr)
    cnt_l = collections.Counter()
    cnt_n = collections.Counter()
    for r in link:
        t = tag(r)
        if t:
            cnt_l[t] += 1
    for r in nolink:
        t = tag(r)
        if t:
            cnt_n[t] += 1
    out_vocab = {}
    for k in NON_RETAIL:
        out_vocab[k] = {"link": cnt_l[k], "nolink": cnt_n[k]}
        print(f"{k:22}{cnt_l[k]:>10,}{cnt_n[k]:>10,}{cnt_l[k]+cnt_n[k]:>10,}",
              file=sys.stderr)
    tl, tn = sum(cnt_l.values()), sum(cnt_n.values())
    print(f"{'合計':22}{tl:>10,}{tn:>10,}{tl+tn:>10,}", file=sys.stderr)
    print(f"{'各層に占める比':22}{tl/max(len(link),1)*100:>9.2f}%"
          f"{tn/max(len(nolink),1)*100:>9.2f}%"
          f"{(tl+tn)/len(rows)*100:>9.2f}%", file=sys.stderr)

    # --- 目視用の決定的標本（両層）-----------------------------------------
    def pick(pool, tagname):
        return sorted(pool, key=lambda r: hashlib.sha256(
            f"{tagname}/{r['source']}/{r['id']}".encode()).hexdigest())[: args.sample]

    s_link = pick(link, "LINK")
    s_nolink = pick(nolink, "NOLINK")
    for label, s in (("リンク有り", s_link), ("リンク無し", s_nolink)):
        print(f"\n=== 決定的標本: {label} {len(s)}件（目視で分類する）===",
              file=sys.stderr)
        for i, r in enumerate(s, 1):
            print(f"{i:>3}. [{r['source']:8}] {r['name'][:38]:40} "
                  f"{r['cat'][:14]:16} {r['loc'][:10]}", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "denominator_composition.json"
    p.write_text(json.dumps(
        {"n_rows": n_rows, "n_places": len(rows),
         "n_link": len(link), "n_nolink": len(nolink),
         "vocab_non_retail": out_vocab,
         "vocab_total": {"link": tl, "nolink": tn,
                         "link_pct": tl / max(len(link), 1) * 100,
                         "nolink_pct": tn / max(len(nolink), 1) * 100,
                         "all_pct": (tl + tn) / len(rows) * 100},
         "sample_link": s_link, "sample_nolink": s_nolink,
         "caveat": "語彙は手書きなので**下限**。目視標本の方が実態に近い。"
                   "これは要求 70% を下げる話ではなく、分母の中身を確定させる測定。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
