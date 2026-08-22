#!/usr/bin/env python3
"""#1273 補完した locality を①の NameMatcher に入れると、店舗同定はどれだけ増えるか

## なぜ

`measure_strict_after_backfill.py` で、座標補完した locality を使うと
リンク無し層の厳格版が **3.00% → 7.33%（2.44倍）**になった（同一実行内）。
上がった4件は全て **県庁所在地（＝保健所の所在地）→ 実際の市**の型で、
「IFAS の locality は店舗の市区町村ではない」という仮説の裏付けだった。

①の `NameMatcher` は辞書を **overture → ifas → osm** の順に読み `setdefault` するので、
**Overture に無い店は IFAS/OSM の locality を裏取りに使っている**。
IFAS のそれは 2/3 の確率で別の自治体を指す（Overture 近傍との一致率 33.56%）。
つまり①も同じ壊れ方をしているはずである。

## 測るもの

`measure_locality_token_recall.py` と**同じキャッシュ 194,315本のタイトル**に対して:

  現行  : NameMatcher の locality（overture 優先、無ければ ifas/osm）
  補完後: **IFAS/OSM 由来の key だけ**、座標の最近傍 Overture 行の市区町村で置き換える
          （Overture 由来の key は一致率 92.24% なので触らない）

distinct 店舗と (動画,店舗) 対がどれだけ増えるかを数え、増分の決定的標本を書き出す。

**ネットワークアクセスは一切しない。**

実行:
    python3 measure_backfill_recall.py
"""

from __future__ import annotations

import collections
import csv
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_channel_traversal import (  # noqa: E402
    MIN_NAME_LEN_LATIN, MIN_NAME_LEN_NATIONAL, NameMatcher,
    has_cjk, normalize_ja, normalize_latin,
)
from measure_locality_backfill import (  # noqa: E402
    MAX_KM, cell_of, haversine_km, load_rows, locality_needle,
)

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
STATE = OUT_DIR / "crawl_scaleup_state.json"


def key_of(name: str) -> str:
    return normalize_ja(name) if has_cjk(name) else normalize_latin(name).strip()


def sha_rank(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def main() -> None:
    matcher = NameMatcher()

    # ---- Overture のみで格子索引を作る（IFAS の locality は信用しないと実測済み）----
    rows = list(load_rows())
    index: dict[tuple[int, int], list] = collections.defaultdict(list)
    n_idx = 0
    for r in rows:
        if r["source"] != "overture":
            continue
        nd = locality_needle(r["locality"])
        if nd:
            index[cell_of(r["lat"], r["lon"])].append((r["lat"], r["lon"], nd))
            n_idx += 1
    print(f"[index] overture {n_idx:,} 行", file=sys.stderr)

    def nearest_needle(lat: float, lon: float) -> str:
        cy, cx = cell_of(lat, lon)
        best, best_km = "", MAX_KM
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for plat, plon, nd in index.get((cy + dy, cx + dx), ()):
                    km = haversine_km(lat, lon, plat, plon)
                    if km < best_km:
                        best_km, best = km, nd
        return best

    # ---- 辞書 key ごとに補完 needle を作る。Overture 由来の key は触らない ----
    targets: dict[str, tuple[float, float]] = {}
    for r in rows:
        k = key_of(r["name"])
        if not k or k not in matcher.area:
            continue
        if matcher.source_of.get(k, "").startswith("overture"):
            continue
        targets.setdefault(k, (r["lat"], r["lon"]))
    print(f"[dict] 補完対象（ifas/osm 由来）の key: {len(targets):,} "
          f"/ locality を持つ key {len(matcher.area):,}", file=sys.stderr)

    backfilled: dict[str, str] = {}
    n_changed = 0
    for k, (lat, lon) in targets.items():
        nd = nearest_needle(lat, lon)
        if nd:
            backfilled[k] = nd
            if nd != matcher.needle.get(k, ""):
                n_changed += 1
    print(f"  補完できた: {len(backfilled):,} / うち現行と違う値: {n_changed:,}",
          file=sys.stderr)

    # ---- キャッシュのタイトルで対比 ----
    state = json.loads(STATE.read_text(encoding="utf-8"))
    cur_pairs: set[tuple[str, str]] = set()
    new_pairs: set[tuple[str, str]] = set()
    added: list[tuple[str, dict]] = []
    n_videos = 0

    for ch in state["channels"].values():
        for v in ch.get("videos") or []:
            title = v.get("title") or ""
            if not title:
                continue
            n_videos += 1
            raw = matcher.match(title)
            if not raw:
                continue
            tja = normalize_ja(title)
            vid = v.get("id") or ""
            for k in raw:
                loc, region = matcher.area.get(k, ("", ""))
                needle = matcher.needle.get(k, "")
                cur = ((loc and loc in tja) or (needle and needle in tja)
                       or (region and region in tja))
                bf = backfilled.get(k, "")
                new = cur or (bf and bf in tja)
                if cur:
                    cur_pairs.add((vid, k))
                if new:
                    new_pairs.add((vid, k))
                if new and not cur:
                    added.append((sha_rank(f"{vid}/{k}"), {
                        "video_id": vid, "title": title,
                        "restaurant": matcher.original.get(k, k),
                        "source": matcher.source_of.get(k, ""),
                        "locality_current": loc, "needle_current": needle,
                        "needle_backfilled": bf, "channel": ch.get("channel"),
                    }))

    cur_rest = {k for _, k in cur_pairs}
    new_rest = {k for _, k in new_pairs}
    d_rest = len(new_rest) - len(cur_rest)

    print(f"\n=== キャッシュ {n_videos:,} 本のタイトルに対する店舗同定 ===", file=sys.stderr)
    print(f"{'':34}{'distinct 店舗':>14}{'(動画,店舗)対':>14}", file=sys.stderr)
    print(f"{'現行（バグ2件修正済み）':34}{len(cur_rest):>14,}{len(cur_pairs):>14,}",
          file=sys.stderr)
    print(f"{'+ IFAS/OSM の locality を座標補完':34}{len(new_rest):>14,}"
          f"{len(new_pairs):>14,}", file=sys.stderr)
    print(f"\n  増分: 店舗 {d_rest:+,} ({d_rest / max(len(cur_rest), 1) * 100:+.2f}%) / "
          f"対 {len(new_pairs) - len(cur_pairs):+,}", file=sys.stderr)

    added.sort(key=lambda x: x[0])
    picked = [a[1] for a in added[:60]]
    print(f"\n=== 増分の決定的標本（SHA-256 順）===", file=sys.stderr)
    for s in picked[:14]:
        print(f"  {s['restaurant'][:16]:18} [{s['source'][:4]}] "
              f"{s['needle_current'] or '-':8} -> {s['needle_backfilled']:8} "
              f"| {s['title'][:38]}", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "backfill_recall.json"
    out_path.write_text(
        json.dumps({
            "n_videos": n_videos,
            "n_keys_with_locality": len(matcher.area),
            "n_keys_targeted": len(targets), "n_backfilled": len(backfilled),
            "n_changed": n_changed,
            "current": {"restaurants": len(cur_rest), "pairs": len(cur_pairs)},
            "backfilled": {"restaurants": len(new_rest), "pairs": len(new_pairs)},
            "delta_restaurants": d_rest,
            "added_sample": picked,
            "caveat": "経路存在率（店舗を同定できる動画があるか）の話であって実効ではない。",
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
