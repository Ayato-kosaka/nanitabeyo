#!/usr/bin/env python3
"""#1273 locality を座標から補完したら、厳格版 judge はどこまで動くか

## なぜ

`measure_locality_backfill.py` で、**IFAS の locality は店舗の市区町村ではない**
（保健所の所在地とみられる。Overture 近傍との一致率 33.56%）ことが分かった。
IFAS は 264,135行すべてがリンク無しで、リンク無し層の 60.3% を占める。
さらに OSM は 91.16% が locality 空。

つまり厳格版 judge のリンク無し層 5.00% は、
**「地名を書かない動画」ではなく「seed の地名が間違っている・無い」**で説明できる可能性が高い。

## 測るもの

`measure_seed_youtube_ceiling.py` と**同じ 300 seed 標本**に対して、

  現行: seed の canonical_address（region+locality をそのまま連結したもの）
  提案: **座標の最近傍 Overture 行の locality**（無料・外部サービス不使用）

の2通りで

  1. **検索クエリ**（`{店名} {地名}` を投げている。地名が間違っていれば検索も外れる）
  2. **厳格版 judge の裏取り**

を両方入れ替えて実測する。ytsearch は1 seed 1回なので 300 回。

## 注意

- 現行値（リンク層 16.22% / リンク無し層 5.00%）は別実行なので、**同じ実行の中で
  現行クエリ・現行判定も測り直して**比較する。過去の数字と直接引き算しない。
- ytsearch の結果は日々変わる。差分は同一実行内の対比でしか意味を持たない。

実行:
    python3 measure_strict_after_backfill.py
    python3 measure_strict_after_backfill.py --limit 40   # 動作確認
"""

from __future__ import annotations

import argparse
import collections
import csv
import json
import math
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_locality_backfill import (  # noqa: E402
    CELL, MAX_KM, cell_of, haversine_km, load_rows, locality_needle,
)
from measure_supply_ceiling import yt_search  # noqa: E402
from measure_seed_youtube_ceiling import normalize  # noqa: E402
from measure_channel_traversal import normalize_ja  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    den = 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (c - h, c + h)


def build_index():
    """locality を持つ **Overture 行だけ**で格子索引を作る。

    #1273 【設計】IFAS の locality は信用できないと実測したので索引に入れない。
    OSM は 91.16% が空なので入っても僅か。
    """
    index: dict[tuple[int, int], list] = collections.defaultdict(list)
    n = 0
    for r in load_rows():
        if r["source"] != "overture":
            continue
        needle = locality_needle(r["locality"])
        if not needle:
            continue
        index[cell_of(r["lat"], r["lon"])].append((r["lat"], r["lon"], needle))
        n += 1
    print(f"[index] overture {n:,} 行", file=sys.stderr)
    return index


def nearest_needle(index, lat: float, lon: float) -> str:
    cy, cx = cell_of(lat, lon)
    best, best_km = "", MAX_KM
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            for plat, plon, needle in index.get((cy + dy, cx + dx), ()):
                km = haversine_km(lat, lon, plat, plon)
                if km < best_km:
                    best_km, best = km, needle
    return best


def judge(name: str, needle: str, entries: list[dict]) -> tuple[bool | None, dict | None]:
    """全店名に地名の裏取りを要求する。地名が無ければ判定不能(None)。"""
    if not needle:
        return None, None
    nname = normalize(name)
    nneedle = normalize(needle)
    for e in entries:
        title = e.get("title") or ""
        nt = normalize(title)
        if nname and nname in nt and nneedle in nt:
            return True, {"video_id": e.get("id"), "title": title}
    return False, None


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 locality 補完後の厳格版")
    ap.add_argument("--limit", type=int, default=0, help="層ごとの上限（動作確認用）")
    ap.add_argument("--depth", type=int, default=8)
    ap.add_argument("--sleep", type=float, default=0.6)
    args = ap.parse_args()

    coords = json.loads((OUT_DIR / "seed_coords.json").read_text(encoding="utf-8"))
    sample = json.loads((OUT_DIR / "seed_strata_sample.json").read_text(
        encoding="utf-8"))["sample"]
    index = build_index()

    results: dict[str, list] = {}
    for layer, items in sample.items():
        rows = items[: args.limit] if args.limit else items
        print(f"\n=== {layer}: {len(rows)} 店 ===", file=sys.stderr)
        out = []
        started = time.time()
        for i, s in enumerate(rows, 1):
            meta = coords.get(s["seed_id"])
            if not meta:
                out.append({"seed_id": s["seed_id"], "name": s["name"], "error": "no_coord"})
                continue
            # 現行: canonical_address（region+locality）から市区町村トークンを取る
            cur_needle = locality_needle(s["locality"])
            new_needle = nearest_needle(index, meta["lat"], meta["lon"])

            q_cur = f"{s['name']} {s['locality']}".strip()
            e_cur, err_cur = yt_search(q_cur, args.depth)
            time.sleep(args.sleep)
            if new_needle and new_needle != cur_needle:
                q_new = f"{s['name']} {new_needle}".strip()
                e_new, err_new = yt_search(q_new, args.depth)
                time.sleep(args.sleep)
            else:
                q_new, e_new, err_new = q_cur, e_cur, err_cur

            hit_cur, bm_cur = judge(s["name"], cur_needle, e_cur)
            # 提案は「補完した地名」で検索し「補完した地名」で裏取りする
            hit_new, bm_new = judge(s["name"], new_needle or cur_needle, e_new)
            out.append({
                "seed_id": s["seed_id"], "name": s["name"], "sources": s["sources"],
                "canonical": s["locality"], "cur_needle": cur_needle,
                "new_needle": new_needle, "changed": bool(new_needle and new_needle != cur_needle),
                "query_cur": q_cur, "query_new": q_new,
                "error_cur": err_cur, "error_new": err_new,
                "hit_cur": hit_cur, "hit_new": hit_new,
                "best_cur": bm_cur, "best_new": bm_new,
            })
            if i % 25 == 0:
                print(f"  ... {i}/{len(rows)} ({time.time() - started:.0f}s)", file=sys.stderr)
        results[layer] = out

    print(f"\n=== 厳格版（同一実行内の対比）===", file=sys.stderr)
    summary = {}
    for layer, rows in results.items():
        ok_cur = [r for r in rows if r.get("hit_cur") is not None and not r.get("error_cur")]
        ok_new = [r for r in rows if r.get("hit_new") is not None and not r.get("error_new")]
        h_cur = sum(1 for r in ok_cur if r["hit_cur"])
        h_new = sum(1 for r in ok_new if r["hit_new"])
        n_changed = sum(1 for r in rows if r.get("changed"))
        lo_c, hi_c = wilson(h_cur, len(ok_cur))
        lo_n, hi_n = wilson(h_new, len(ok_new))
        summary[layer] = {
            "n": len(rows), "n_locality_changed": n_changed,
            "current": {"n_decidable": len(ok_cur), "n_hit": h_cur,
                        "rate": h_cur / max(len(ok_cur), 1),
                        "wilson": [lo_c, hi_c]},
            "backfilled": {"n_decidable": len(ok_new), "n_hit": h_new,
                           "rate": h_new / max(len(ok_new), 1),
                           "wilson": [lo_n, hi_n]},
        }
        print(f"\n  [{layer}] 地名が変わった seed: {n_changed}/{len(rows)}", file=sys.stderr)
        print(f"    現行  : 判定できた {len(ok_cur):>3} / ヒット {h_cur:>3} = "
              f"{h_cur / max(len(ok_cur),1)*100:>6.2f}% "
              f"(95%CI {lo_c*100:.1f}-{hi_c*100:.1f}%)", file=sys.stderr)
        print(f"    補完後: 判定できた {len(ok_new):>3} / ヒット {h_new:>3} = "
              f"**{h_new / max(len(ok_new),1)*100:>6.2f}%** "
              f"(95%CI {lo_n*100:.1f}-{hi_n*100:.1f}%)", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "strict_after_backfill.json"
    out_path.write_text(
        json.dumps({"summary": summary, "results": results,
                    "caveat": "ytsearch の結果は日々変わる。過去実行の 16.22%/5.00% と"
                              "直接引き算せず、同一実行内の現行 vs 補完後で見ること。"},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
