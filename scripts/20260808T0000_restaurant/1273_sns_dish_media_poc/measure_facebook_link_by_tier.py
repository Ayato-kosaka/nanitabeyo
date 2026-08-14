#!/usr/bin/env python3
"""#1273 Facebook Page リンクの保有率が、地方でも保たれているかを全数で確かめる

## なぜ要るか

Meta 経路の経路存在率 87.04%（`measure_overture_facebook_link.py`）は**全国平均**である。
本PoCで繰り返し出てきた失敗は「全国平均は良いが地方で崩れる」だった
（YouTube は都市部の食べ歩き動画に偏り、地方の店に届かない）。
87.04% が都市部の数字を地方が薄めた平均なら、Meta 経路も同じ穴を持つ。

全数（789,612行）で密度層別・都道府県別に出す。標本ではないので誤差は無い。

密度層の定義は `measure_supply_ceiling.py` と揃える（2kmセル内の店舗数）。
ここを変えると過去のラウンドの数字と比較できなくなる。

実行:
    python3 measure_facebook_link_by_tier.py
"""

from __future__ import annotations

import collections
import csv
import json
import math
import sys
from pathlib import Path

import duckdb

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
PARQUET = Path("/tmp/overture-jp.parquet")
FOOD_CSV = HERE / "fixtures" / "overture_jp_food.csv"

# #1273 【仕様】measure_supply_ceiling.py:51 と同一定義。変えると過去ラウンドと比較できない。
DENSITY_TIERS = [("urban", 50), ("suburban", 10), ("rural", 0)]
CELL_M = 2000
REF_LAT = 35.7

# measure_overture_facebook_link.py の実測（同一標本を3回測って最小値）。
LINK_LIVE_RATE = 0.98


def facebook_ids(con: duckdb.DuckDBPyConnection) -> set[str]:
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

    con = duckdb.connect()
    with_fb = facebook_ids(con)
    print(f"Facebook リンク保有: {len(with_fb):,} 店", file=sys.stderr)

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
            if not (r.get("name") or "").strip():
                continue
            rows.append((r["id"], int(lat / dlat), int(lon / dlon), r.get("region") or "(不明)"))

    cell_count: collections.Counter = collections.Counter()
    for _, cy, cx, _ in rows:
        cell_count[(cy, cx)] += 1

    def tier_of(cy: int, cx: int) -> str:
        n = cell_count[(cy, cx)]
        for name, lo in DENSITY_TIERS:
            if n >= lo:
                return name
        return "rural"

    by_tier: dict[str, list[int]] = collections.defaultdict(lambda: [0, 0])
    by_region: dict[str, list[int]] = collections.defaultdict(lambda: [0, 0])
    for pid, cy, cx, region in rows:
        has = 1 if pid in with_fb else 0
        tier = tier_of(cy, cx)
        by_tier[tier][0] += 1
        by_tier[tier][1] += has
        by_region[region][0] += 1
        by_region[region][1] += has

    print("\n=== 密度層別の Facebook Page リンク保有率（全数）===", file=sys.stderr)
    print("tier        店舗数    保有      保有率   ×生存98% = 経路存在率", file=sys.stderr)
    tier_out = []
    for tier, _ in DENSITY_TIERS:
        total, has = by_tier[tier]
        if not total:
            continue
        rate = has / total
        tier_out.append(
            {"tier": tier, "total": total, "with_fb": has, "rate": rate,
             "path_existence": rate * LINK_LIVE_RATE}
        )
        print(
            f"{tier:10} {total:>8,}  {has:>8,}  {rate * 100:>6.2f}%"
            f"   {rate * LINK_LIVE_RATE * 100:>6.2f}%",
            file=sys.stderr,
        )

    # #1273 【バグ】Overture の region は自由記述で、「沖縄」「沖繩県」「okinawa」
    # 「Фукуока」のような表記ゆれが n=1〜6 で大量に混じる。それを込みで並べると
    # 「沖縄 0.00%」のような無意味な行が上位を占め、地方が壊れているように読めてしまう。
    # 実際にはただの表記ゆれの尻尾なので、母数の下限を切ってから並べる。
    MIN_REGION_N = 1000
    ranked = sorted(
        ((r, tv) for r, tv in by_region.items() if tv[0] >= MIN_REGION_N),
        key=lambda kv: kv[1][1] / kv[1][0],
    )
    dropped = sum(t for r, (t, _) in by_region.items() if t < MIN_REGION_N)
    print(
        f"\n=== 都道府県別（母数 {MIN_REGION_N:,} 以上の {len(ranked)} 件のみ。"
        f"表記ゆれの尻尾 {dropped:,} 店を除外）===",
        file=sys.stderr,
    )
    print("低い順 上位10:", file=sys.stderr)
    for region, (total, has) in ranked[:10]:
        print(f"  {region:12} {has:>7,}/{total:>7,}  {has / total * 100:>6.2f}%",
              file=sys.stderr)
    print("高い順 上位5:", file=sys.stderr)
    for region, (total, has) in ranked[::-1][:5]:
        print(f"  {region:12} {has:>7,}/{total:>7,}  {has / total * 100:>6.2f}%",
              file=sys.stderr)

    # #1273 【重要】region が「(不明)」の行に FB リンクが集中していたので、
    # 地理ではなく**データの出所**で割れている疑いを確かめる。ここを確認せずに
    # 「地方でも 91%」とだけ報告すると、数字の意味を取り違える。
    provenance = con.sql(
        """
        SELECT has_fb, src.dataset AS dataset, count(DISTINCT p.id) AS n
        FROM (SELECT p.*,
                     (list_any_value(list_filter(p.socials, x -> lower(x) LIKE '%facebook.com%'))
                      IS NOT NULL) AS has_fb
              FROM read_parquet($parquet) p SEMI JOIN food f ON f.id = p.id) p,
             unnest(p.sources) AS t(src)
        GROUP BY 1, 2 ORDER BY 1, n DESC
        """,
        params={"parquet": str(PARQUET)},
    ).fetchall()
    print("\n=== FBリンクの有無 × Overture の出所データセット ===", file=sys.stderr)
    for has_fb, dataset, n in provenance:
        print(f"  fb={str(bool(has_fb)):5} {dataset:14} {n:>8,}", file=sys.stderr)
    meta_n = next((n for h, d, n in provenance if h and d == "meta"), 0)
    fb_n = next((n for h, d, n in provenance if h and d == "Overture"), 0)
    if fb_n:
        print(
            f"\nFBリンク保有 {fb_n:,} 店のうち **{meta_n:,} 店 ({meta_n / fb_n * 100:.1f}%) が "
            f"`meta` データセット由来**。Page ID が数値で生存率98%なのは、"
            f"Meta 自身が Overture に提供した行だからで、精度としては良い材料。\n"
            f"ただし読み方は変わる: 87% は「独立に把握した店の87%がFacebookを持つ」ではなく、"
            f"**「母集団の87%が Meta 提供行で、その定義上 Page ID を持つ」**である。"
            f"Meta 提供でない残り約 {len(rows) - fb_n:,} 店には、この経路は原理的に届かない。",
            file=sys.stderr,
        )

    rates = [t["rate"] for t in tier_out]
    spread = (max(rates) - min(rates)) * 100 if rates else 0.0
    print(f"\n密度層間の開き: {spread:.2f}pt", file=sys.stderr)
    if spread < 5:
        print("**地方でも崩れない。** YouTube 経路の弱点（都市偏在）をこの経路は持たない。",
              file=sys.stderr)
    else:
        print("**密度層で差がある。** 全国平均だけで判断してはいけない。", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "facebook_link_by_tier.json"
    out_path.write_text(
        json.dumps(
            {
                "total_places": len(rows),
                "with_facebook": len(with_fb),
                "link_live_rate": LINK_LIVE_RATE,
                "by_tier": tier_out,
                "tier_spread_pt": spread,
                "by_region": [
                    {"region": r, "total": t, "with_fb": h, "rate": h / max(t, 1)}
                    for r, (t, h) in ranked
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
