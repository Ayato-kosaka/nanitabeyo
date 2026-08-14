#!/usr/bin/env python3
"""#1273 locality が空の店を、座標が近い店から無料で埋められるか（保留検証つき）

## なぜ

`measure_locality_coverage.py` の全数実測で、**地名の手がかりが全く無い店**は
リンク有り 1.67% に対し**リンク無し 37.62%**（差 +35.94pt）だった。原因は OSM で、
190,282行の **91.16%** が locality 空である。

厳格版 judge は locality か region で裏取りするので、この 37.62% は
**構造的に必ず不ヒット**になる。リンク無し層の厳格版 5.00% はこれで押し下げられている。

## 埋められるか

seed は座標を持っている。locality を持つ行（overture + ifas ≒ 105万行）で
**格子索引**を作り、locality が空の行に**最近傍の locality** を与える。
外部サービスを使わないので**無料**、規約の論点も無い。

## 保留検証（ここが本体）

「埋まった」だけでは意味が無いので、**locality を持つ行から決定的に 20,000 行を抜き、
その行自身を索引から除いて予測し、正解と突き合わせる**。
市区町村トークン単位で一致率を出す。

**ネットワークアクセスは一切しない。**

実行:
    python3 measure_locality_backfill.py
    python3 measure_locality_backfill.py --holdout 5000   # 動作確認
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

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
FIXTURES = HERE / "fixtures"

SOURCES = ("overture_jp_food.csv", "osm_jp_food.csv", "ifas_jp_food.csv")

# 格子の大きさ。0.01度 ≒ 緯度1.1km。近傍探索は自セルと周囲8セルを見る。
CELL = 0.01
# これより遠い最近傍は採用しない。市区町村の粒度で 2km を超えると別の自治体になりやすい。
MAX_KM = 2.0

_PREF = re.compile(r"^.{2,4}?[都道府県]")
_GUN = re.compile(r"^.{1,4}?郡")
_ADMIN_TOKEN = re.compile(r"\S{1,6}?[市区町村]")


def locality_needle(raw: str) -> str:
    if not raw:
        return ""
    s = _PREF.sub("", raw, count=1)
    s = _GUN.sub("", s, count=1)
    tokens = _ADMIN_TOKEN.findall(s)
    return tokens[-1] if tokens else ""


def haversine_km(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = p2 - p1
    dl = math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def load_rows():
    csv.field_size_limit(10**7)
    for filename in SOURCES:
        path = FIXTURES / filename
        if not path.exists():
            raise SystemExit(f"fixture が無い: {path}")
        source = filename.split("_")[0]
        with path.open(encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                if not (row.get("name") or "").strip():
                    continue
                try:
                    lat = float(row["latitude"])
                    lon = float(row["longitude"])
                except (TypeError, ValueError, KeyError):
                    continue
                if not (24 <= lat <= 46 and 122 <= lon <= 154):
                    continue
                yield {
                    "id": row.get("id") or "", "source": source,
                    "name": (row.get("name") or "").strip(),
                    "lat": lat, "lon": lon,
                    "locality": (row.get("locality") or "").strip(),
                    "region": (row.get("region") or "").strip(),
                    "has_link": (int(row.get("n_socials") or 0) > 0
                                 or int(row.get("n_websites") or 0) > 0),
                }


def cell_of(lat: float, lon: float) -> tuple[int, int]:
    return (int(lat / CELL), int(lon / CELL))


def nearest(index, lat: float, lon: float, exclude_id: str | None = None):
    """自セル + 周囲8セルの中で最も近い点を返す。無ければ None。"""
    cy, cx = cell_of(lat, lon)
    best = None
    best_km = MAX_KM
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            for pid, plat, plon, needle, full in index.get((cy + dy, cx + dx), ()):
                if exclude_id is not None and pid == exclude_id:
                    continue
                km = haversine_km(lat, lon, plat, plon)
                if km < best_km:
                    best_km, best = km, (needle, full, km)
    return best


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 locality の座標補完と保留検証")
    ap.add_argument("--holdout", type=int, default=20000)
    args = ap.parse_args()

    rows = list(load_rows())
    print(f"読み込み {len(rows):,} 行", file=sys.stderr)

    index: dict[tuple[int, int], list] = collections.defaultdict(list)
    n_indexed = 0
    for r in rows:
        needle = locality_needle(r["locality"])
        if not needle:
            continue
        index[cell_of(r["lat"], r["lon"])].append(
            (r["id"], r["lat"], r["lon"], needle, r["locality"]))
        n_indexed += 1
    print(f"索引に入れた（市区町村トークンが取れた）行: {n_indexed:,}", file=sys.stderr)

    # ---- 保留検証 ----
    labeled = [r for r in rows if locality_needle(r["locality"])]
    labeled.sort(key=lambda r: hashlib.sha256(
        f"{r['source']}/{r['id']}".encode("utf-8")).hexdigest())
    holdout = labeled[: args.holdout]

    n_pred = n_correct = n_no_neighbor = n_compatible = 0
    by_dist = collections.Counter()
    wrong_examples = []
    for r in holdout:
        truth = locality_needle(r["locality"])
        got = nearest(index, r["lat"], r["lon"], exclude_id=r["id"])
        if got is None:
            n_no_neighbor += 1
            continue
        n_pred += 1
        pred, pred_full, km = got
        by_dist[round(km, 1) // 0.5 * 0.5] += 1
        if pred == truth:
            n_correct += 1
            continue
        # #1273 【設計】「名古屋市中区」の店に「名古屋市」を返した型は
        # ラベルとしては誤りでないが、裏取りには使えない（タイトルの「中区」に
        # 当たらない）。誤りとは別に数えて、残差の内訳が分かるようにする。
        compatible = (pred and pred in r["locality"]) or (truth and truth in pred_full)
        if compatible:
            n_compatible += 1
        if len(wrong_examples) < 40:
            wrong_examples.append({"name": r["name"], "source": r["source"],
                                   "truth_full": r["locality"], "truth": truth,
                                   "pred_full": pred_full, "pred": pred,
                                   "km": round(km, 3), "compatible": bool(compatible)})

    acc = n_correct / max(n_pred, 1)
    print(f"\n=== 保留検証（locality を持つ行から決定的に {len(holdout):,} 行）===",
          file=sys.stderr)
    print(f"  近傍が見つからなかった : {n_no_neighbor:,} "
          f"({n_no_neighbor / max(len(holdout), 1) * 100:.2f}%)", file=sys.stderr)
    print(f"  予測できた             : {n_pred:,}", file=sys.stderr)
    print(f"  **市区町村が一致        : {n_correct:,} = {acc * 100:.2f}%**", file=sys.stderr)
    print(f"  うち粒度違い(市 vs 区)  : {n_compatible:,} = "
          f"{n_compatible / max(n_pred, 1) * 100:.2f}%（ラベルは誤りでないが裏取りには"
          f"使えない）", file=sys.stderr)
    print(f"  本当に別の自治体        : {n_pred - n_correct - n_compatible:,} = "
          f"{(n_pred - n_correct - n_compatible) / max(n_pred, 1) * 100:.2f}%",
          file=sys.stderr)

    # ---- 実際に埋まる量 ----
    targets = [r for r in rows if not locality_needle(r["locality"])]
    fill_ok = fill_ng = 0
    fill_by_link = {True: [0, 0], False: [0, 0]}
    for r in targets:
        got = nearest(index, r["lat"], r["lon"])
        slot = fill_by_link[r["has_link"]]
        slot[0] += 1
        if got is None:
            fill_ng += 1
        else:
            fill_ok += 1
            slot[1] += 1

    print(f"\n=== locality が使えない {len(targets):,} 行を埋められるか ===",
          file=sys.stderr)
    print(f"  埋まった : {fill_ok:,} ({fill_ok / max(len(targets), 1) * 100:.2f}%)",
          file=sys.stderr)
    print(f"  埋まらない: {fill_ng:,}（半径 {MAX_KM}km に locality を持つ店が無い）",
          file=sys.stderr)
    for has_link, label in ((True, "リンク有り"), (False, "リンク無し")):
        n, ok = fill_by_link[has_link]
        print(f"    {label}: {n:>8,} 行中 {ok:>8,} 埋まった "
              f"({ok / max(n, 1) * 100:.2f}%)", file=sys.stderr)

    # 手がかり無しの割合が補完後どうなるか
    total_link = sum(1 for r in rows if r["has_link"])
    total_nolink = len(rows) - total_link
    before_nolink = sum(1 for r in rows
                        if not r["has_link"] and not locality_needle(r["locality"])
                        and not r["region"])
    after_nolink = before_nolink - fill_by_link[False][1]
    print(f"\n=== リンク無し層の「地名の手がかりが全く無い店」 ===", file=sys.stderr)
    print(f"  補完前: {before_nolink:,} / {total_nolink:,} = "
          f"{before_nolink / max(total_nolink, 1) * 100:.2f}%", file=sys.stderr)
    print(f"  補完後: {max(after_nolink, 0):,} / {total_nolink:,} = "
          f"{max(after_nolink, 0) / max(total_nolink, 1) * 100:.2f}%", file=sys.stderr)

    print(f"\n  誤りの例（正解 vs 予測）:", file=sys.stderr)
    for w in wrong_examples[:8]:
        print(f"    {w['name'][:18]:20} {w['truth_full'][:10]:12} -> "
              f"{w['pred_full'][:10]:12} ({w['km']}km)"
              f"{' [粒度違い]' if w['compatible'] else ''}", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "locality_backfill.json"
    out_path.write_text(
        json.dumps({
            "n_rows": len(rows), "n_indexed": n_indexed,
            "holdout": {"n": len(holdout), "n_predicted": n_pred,
                        "n_no_neighbor": n_no_neighbor,
                        "n_correct": n_correct, "accuracy": acc,
                        "n_compatible_granularity": n_compatible,
                        "n_真の不一致": n_pred - n_correct - n_compatible},
            "backfill": {"n_targets": len(targets), "n_filled": fill_ok,
                         "n_unfilled": fill_ng,
                         "by_link": {"link": fill_by_link[True],
                                     "nolink": fill_by_link[False]}},
            "nolink_no_clue_before": before_nolink,
            "nolink_no_clue_after": max(after_nolink, 0),
            "nolink_total": total_nolink,
            "max_km": MAX_KM, "cell_deg": CELL,
            "wrong_examples": wrong_examples,
            "caveat": "locality を埋めても「動画のタイトルにその地名が出るか」は別測定。"
                      "ここで分かるのは裏取りの土台が作れるかまで。",
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
