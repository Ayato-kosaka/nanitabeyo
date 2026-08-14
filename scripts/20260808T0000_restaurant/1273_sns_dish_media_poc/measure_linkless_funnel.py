#!/usr/bin/env python3
"""#1273 リンク無し層の「経路存在 → 実際に dish_media になる」歩留まりを実測する

## なぜ

天井 55.18% は**経路存在率**であって、実際に dish_media が作れる率ではない。
ここを混ぜたまま報告すると、届かないものを届くように見せてしまう。

dish_media になるには、店が特定できるだけでなく **134 dish_categories のどれかに
当たる料理が特定できる**必要がある。既存の Route B 実測では
`category_given_restaurant = 75.4%`（`out/dish_media_yield_after_fix.json`）だが、
これは YouTube のタイトルに対する値で、Fediverse の本文では違うはず。

## 測るもの

`measure_fediverse_union.py` でヒットした店について、実際に本文を取り直し、
`dish_category_matcher.CategoryMatcher`（①で採用したもの）を当てて
**カテゴリまで付けられる割合**を出す。判定器は①と同一のものを使う。

実行:
    python3 measure_linkless_funnel.py
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dish_category_matcher import CategoryMatcher  # noqa: E402
from measure_supply_ceiling import (  # noqa: E402
    MIN_NAME_LEN_FOR_SUBSTRING,
    core_name,
    normalize,
)

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
SEED_CACHE = OUT_DIR / "seed_strata_sample.json"
MISSKEY_RESULTS = OUT_DIR / "misskey_ceiling.json"
FEDI_RESULTS = OUT_DIR / "fediverse_union.json"

INSTANCES = ["misskey.io", "misskey.design", "nijimiss.moe"]

# Route B（YouTube タイトル）での実測値。比較のために置いておく。
YT_CATEGORY_GIVEN_RESTAURANT = 0.754

TOTAL_SEEDS = 1_132_482
SEEDS_WITHOUT_OVERTURE = 343_247
LINKLESS_PATH_RATE = 0.3833  # YouTube ∪ Fediverse の経路存在率

_THROTTLE_S = 1.2


def search(host: str, query: str, limit: int, timeout: float) -> list[dict]:
    url = f"https://{host}/api/notes/search"
    payload = json.dumps({"query": query, "limit": limit}).encode()
    req = urllib.request.Request(
        url, data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8", "replace"))
        return body if isinstance(body, list) else []
    except Exception:  # noqa: BLE001 - 取れなければ空で続ける
        return []


def matching_notes(name: str, locality: str, notes: list[dict]) -> list[dict]:
    """measure_misskey_ceiling.py と同一の規則で、その店を指していると判定できる note。"""
    nm = normalize(name)
    core = normalize(core_name(name))
    loc = normalize(locality)
    out = []
    for note in notes:
        files = note.get("files") or []
        if not any((f.get("type") or "").startswith("image") for f in files):
            continue
        text = normalize(note.get("text") or "")
        for needle in (nm, core):
            if not needle or needle not in text:
                continue
            if len(needle) < MIN_NAME_LEN_FOR_SUBSTRING and not (loc and loc in text):
                continue
            out.append(note)
            break
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 リンク無し層の funnel")
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--timeout", type=float, default=30.0)
    args = ap.parse_args()

    sample = json.loads(SEED_CACHE.read_text(encoding="utf-8"))["sample"]["without_overture"]
    by_id = {s["seed_id"]: s for s in sample}

    io_rows = json.loads(MISSKEY_RESULTS.read_text(encoding="utf-8"))["results"][
        "without_overture"
    ]
    hit_ids = {r["seed_id"] for r in io_rows if r.get("hit")}
    # fediverse_union.json は seed_id の集合を保存していないので、
    # ここでは全インスタンスを引き直して union を取り直す（件数は 150 なので安い）。
    print(f"リンク無し層 {len(sample)} 店を {len(INSTANCES)} インスタンスで引き直す",
          file=sys.stderr)

    matcher = CategoryMatcher()
    rows = []
    for i, item in enumerate(sample):
        notes_all: list[dict] = []
        for host in INSTANCES:
            notes_all.extend(search(host, item["name"], args.limit, args.timeout))
            time.sleep(_THROTTLE_S)
        matched = matching_notes(item["name"], item["locality"], notes_all)
        cats: set[str] = set()
        for note in matched:
            for cat in matcher.match(note.get("text") or ""):
                cats.add(cat["dish_category_id"])
        rows.append({
            "seed_id": item["seed_id"], "name": item["name"],
            "n_matched_notes": len(matched),
            "hit": bool(matched),
            "n_categories": len(cats),
            "categories": sorted(cats)[:5],
        })
        if i % 25 == 24:
            print(f"    {i + 1}/{len(sample)}", file=sys.stderr)

    hit = [r for r in rows if r["hit"]]
    with_cat = [r for r in hit if r["n_categories"] >= 1]
    rate = len(with_cat) / len(hit) if hit else 0.0

    print(f"\n=== リンク無し層 {len(sample)} 店 ===", file=sys.stderr)
    print(f"  経路あり（店名一致＋画像添付）: {len(hit)} 店", file=sys.stderr)
    print(f"  うち 134カテゴリのどれかに当たった: {len(with_cat)} 店 "
          f"({rate * 100:.1f}%)", file=sys.stderr)
    print(f"  （比較）YouTube タイトルでの category_given_restaurant: "
          f"{YT_CATEGORY_GIVEN_RESTAURANT * 100:.1f}%", file=sys.stderr)

    effective = LINKLESS_PATH_RATE * rate
    print(f"\n  リンク無し層: 経路存在 {LINKLESS_PATH_RATE * 100:.2f}% × "
          f"カテゴリ付与 {rate * 100:.1f}% = **実効 {effective * 100:.2f}%**", file=sys.stderr)
    print(f"  seed 分母での寄与: {effective * SEEDS_WITHOUT_OVERTURE / TOTAL_SEEDS * 100:.2f}pt "
          f"（経路存在だけなら "
          f"{LINKLESS_PATH_RATE * SEEDS_WITHOUT_OVERTURE / TOTAL_SEEDS * 100:.2f}pt）",
          file=sys.stderr)
    print("\n**天井 55.18% は経路存在率であって、dish_media になる率ではない。**"
          "この係数を掛けないまま報告してはいけない。", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "linkless_funnel.json"
    out_path.write_text(
        json.dumps(
            {
                "instances": INSTANCES,
                "sample_size": len(sample),
                "n_path_hit": len(hit),
                "n_with_category": len(with_cat),
                "category_given_hit": rate,
                "yt_category_given_restaurant": YT_CATEGORY_GIVEN_RESTAURANT,
                "linkless_path_rate": LINKLESS_PATH_RATE,
                "linkless_effective_rate": effective,
                "rows": rows,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
