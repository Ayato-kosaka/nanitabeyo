#!/usr/bin/env python3
"""#1273 Meta が届かない 88,328 店を、YouTube 経路がどれだけ拾えるかを測る

## なぜ要るか

Meta 経路の経路存在率は 87.04% だが、その内訳を追ったところ FB リンク保有の 98.6% が
Overture の `meta` データセット由来で、**Meta 提供でない 88,328 店には原理的に届かない**
ことが分かった（`measure_facebook_link_by_tier.py`）。

ここで重要なのは、**天井は経路の最大値ではなく union** だということ。
88,328 店を YouTube 経路（①の発見結果）が拾えるなら、合算は 87.04% を超える。
逆に「Meta が届かない店には YouTube も届かない」なら、87.04% がそのまま天井になる。
この2つは意思決定上まったく違う。

## 測りかた

1. Meta 非到達の 88,328 店の密度層分布を出す。そもそも他経路が届きうる層なのか。
2. ①のクロール（110,656本）に NameMatcher をかけて発見できた店を出し、
   **そのうち何店が Meta 非到達側にいるか**を数える。これが union の増分。

照合は #1310 で直した corroborated 版（locality/region の裏取り必須）をそのまま使う。
名寄せの基準を変えると過去ラウンドの数字と比較できなくなる。

実行:
    python3 measure_route_union.py
"""

from __future__ import annotations

import collections
import csv
import json
import math
import sys
from pathlib import Path

import duckdb

from measure_channel_traversal import NameMatcher, normalize_ja

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
PARQUET = Path("/tmp/overture-jp.parquet")
FOOD_CSV = HERE / "fixtures" / "overture_jp_food.csv"

# measure_supply_ceiling.py:51 / measure_facebook_link_by_tier.py と同一定義。
DENSITY_TIERS = [("urban", 50), ("suburban", 10), ("rural", 0)]
CELL_M = 2000
REF_LAT = 35.7


def facebook_ids() -> set[str]:
    con = duckdb.connect()
    con.sql(f"CREATE VIEW food AS SELECT id FROM read_csv('{FOOD_CSV}', header=true)")
    rows = con.sql(
        """
        SELECT DISTINCT p.id
        FROM read_parquet($parquet) p
        SEMI JOIN food f ON f.id = p.id
        WHERE p.socials IS NOT NULL
          AND list_any_value(list_filter(p.socials, x -> lower(x) LIKE '%facebook.com%')) IS NOT NULL
        """,
        params={"parquet": str(PARQUET)},
    ).fetchall()
    return {r[0] for r in rows}


def main() -> None:
    if not PARQUET.exists():
        raise SystemExit(f"Overture parquet が無い: {PARQUET}")

    with_fb = facebook_ids()
    print(f"Meta 到達可能（FBリンク保有）: {len(with_fb):,} 店", file=sys.stderr)

    csv.field_size_limit(10**7)
    dlat = CELL_M / 111_320
    dlon = CELL_M / (111_320 * math.cos(math.radians(REF_LAT)))

    rows = []
    with FOOD_CSV.open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            try:
                lat, lon = float(r["latitude"]), float(r["longitude"])
            except (TypeError, ValueError):
                continue
            if not (24 <= lat <= 46 and 122 <= lon <= 154):
                continue
            name = (r.get("name") or "").strip()
            if not name:
                continue
            rows.append((r["id"], name, int(lat / dlat), int(lon / dlon)))

    cell_count: collections.Counter = collections.Counter()
    for _, _, cy, cx in rows:
        cell_count[(cy, cx)] += 1

    def tier_of(cy: int, cx: int) -> str:
        n = cell_count[(cy, cx)]
        for label, lo in DENSITY_TIERS:
            if n >= lo:
                return label
        return "rural"

    # 正規化名 -> その名前を持つ Overture 行が Meta 到達側にいるか
    # （同名が複数あるので、1つでも非到達なら「非到達側にも居る」とする）
    name_has_fb: dict[str, bool] = {}
    name_lacks_fb: dict[str, bool] = {}
    tier_by_reach: dict[str, collections.Counter] = {
        "meta_reachable": collections.Counter(),
        "meta_unreachable": collections.Counter(),
    }
    for pid, name, cy, cx in rows:
        key = normalize_ja(name)
        if not key:
            continue
        reachable = pid in with_fb
        bucket = "meta_reachable" if reachable else "meta_unreachable"
        tier_by_reach[bucket][tier_of(cy, cx)] += 1
        if reachable:
            name_has_fb[key] = True
        else:
            name_lacks_fb[key] = True

    print("\n=== Meta 非到達 88,328 店はどの層にいるか ===", file=sys.stderr)
    print("tier        Meta到達      Meta非到達   非到達の構成比", file=sys.stderr)
    unreach_total = sum(tier_by_reach["meta_unreachable"].values())
    tier_rows = []
    for label, _ in DENSITY_TIERS:
        reach = tier_by_reach["meta_reachable"][label]
        unreach = tier_by_reach["meta_unreachable"][label]
        share = unreach / unreach_total * 100 if unreach_total else 0.0
        tier_rows.append({"tier": label, "meta_reachable": reach,
                          "meta_unreachable": unreach, "unreachable_share_pct": share})
        print(f"{label:10} {reach:>10,}  {unreach:>10,}   {share:>6.2f}%", file=sys.stderr)

    # ①のクロール結果を NameMatcher にかける
    state_path = OUT_DIR / "snowball_crawl_state.json"
    if not state_path.exists():
        raise SystemExit(f"①のクロール結果が無い: {state_path}")
    state = json.loads(state_path.read_text(encoding="utf-8"))
    matcher = NameMatcher()

    discovered: set[str] = set()
    n_titles = 0
    for channel in state["channels"].values():
        for video in channel.get("videos", []):
            title = video.get("title") or ""
            if not title:
                continue
            n_titles += 1
            discovered |= matcher.match_corroborated(title)

    print(f"\n=== ①（YouTube）の発見結果 ===", file=sys.stderr)
    print(f"走査した動画タイトル: {n_titles:,}", file=sys.stderr)
    print(f"裏取り付きで特定できた distinct 店名: {len(discovered):,}", file=sys.stderr)

    # 発見した店名のうち、Meta 非到達側にしか居ないものが union の増分になる。
    only_unreachable = {k for k in discovered if name_lacks_fb.get(k) and not name_has_fb.get(k)}
    both = {k for k in discovered if name_lacks_fb.get(k) and name_has_fb.get(k)}
    only_reachable = {k for k in discovered if name_has_fb.get(k) and not name_lacks_fb.get(k)}
    not_in_overture = discovered - only_unreachable - both - only_reachable

    print("\n=== 発見した店名 × Meta 到達可否 ===", file=sys.stderr)
    print(f"  Meta 到達側のみ      : {len(only_reachable):,}", file=sys.stderr)
    print(f"  両側に同名あり       : {len(both):,}", file=sys.stderr)
    print(f"  **Meta 非到達側のみ**: {len(only_unreachable):,}  <- union の増分候補",
          file=sys.stderr)
    print(f"  Overture に無い(IFAS/OSM由来): {len(not_in_overture):,}", file=sys.stderr)

    total_food = len(rows)
    gain_pct = len(only_unreachable) / total_food * 100
    print(
        f"\nYouTube が Meta の穴を埋める分: {len(only_unreachable):,} / {total_food:,} "
        f"= **+{gain_pct:.3f}pt**",
        file=sys.stderr,
    )
    print(
        "※ これは①が 400ch を走査した時点の実測値であり、クロールを広げれば増える。"
        "ただし #1319 でスケール則は保たないことが分かっているので、"
        "この数字を外挿して union を語らない。",
        file=sys.stderr,
    )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "route_union.json"
    out_path.write_text(
        json.dumps(
            {
                "total_food_places": total_food,
                "meta_reachable": len(with_fb),
                "meta_unreachable": total_food - len([1 for pid, *_ in rows if pid in with_fb]),
                "tier_by_reach": tier_rows,
                "titles_scanned": n_titles,
                "discovered_names": len(discovered),
                "discovered_only_meta_reachable": len(only_reachable),
                "discovered_both": len(both),
                "discovered_only_meta_unreachable": len(only_unreachable),
                "discovered_not_in_overture": len(not_in_overture),
                "union_gain_pt": gain_pct,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
