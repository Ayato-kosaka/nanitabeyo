#!/usr/bin/env python3
"""#1279 Route B前提の dish_media カバレッジ再モデル化（#1273 Round3）

`coverage_youtube_only.py` は k を「その店舗が既に `dishes` に持っているカテゴリ数」として
`coverage = 1-(1-p)^k` で試算していたが、これはRoute A的な前提であり誤りだった。
Route B（カテゴリ×エリア掃引を既存dish登録に関係なく行い、見つかった投稿を逆引きして
その場で `dishes` 行を新規作成する）では、試行の単位は「店舗」ではなく「クエリ」であり、
モデルの形そのものを差し替える必要がある。本スクリプトはその再モデル化。

DB接続は不要。fixtures/ 配下のCSV（本番 public.restaurants 全件・134 gateカテゴリ）だけを
読み取り、書き込みは out/ 配下のJSONのみ。

実行:
    python3 coverage_route_b.py
"""

from __future__ import annotations

import argparse
import collections
import csv
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent.parent
FIXTURES = HERE / "fixtures"
OUT_DIR = HERE / "out"

# ---------------------------------------------------------------------------
# 定数。実測由来のものは出典issueを明記する（#1273方針: 既に確定した数値は再測定しない）
# ---------------------------------------------------------------------------

N_RESTAURANTS_TARGET = 700_000  # #1273 【仕様】Overture Places由来で目指す国内seed規模
COVERAGE_TARGET = 0.60  # #1279 【仕様】オーナー提示の目標カバレッジ
CELL_MIN_DISTINCT_RESTAURANTS = 5  # #1273 §32 【仕様】area×categoryセルの成功条件

# #1279 【実測】public.dishes での店舗あたり distinct category 数（平均）。
# Route Bでも「1店舗が名乗れるカテゴリ数」の下限側の目安として使う。
M_MENU_BREADTH_OBSERVED = 1.204

# #1283 【実測】yt-dlp持続負荷テスト由来のスループット。約1,000クエリ/15分を超えると
# ソフトなレート制限(403)が8〜16%でプラトーするため、セッション分割前提の日次上限で表す。
QUERIES_PER_DAY_OPTIMISTIC = 19_200  # 800クエリ/セッション × 24セッション（クールダウン1h想定）
QUERIES_PER_DAY_CONSERVATIVE = 6_400  # 800クエリ/セッション × 3時間おき

SEARCH_DEPTH_DEFAULT = 20  # ytsearch20 相当。1クエリが返す動画スロット数

# #1273 【仕様】検索クエリに使える「地名の語彙」の粒度。Route Bのクエリ本数はここで決まる。
AREA_TIERS = [
    ("都道府県", 47),
    ("市区町村", 1_741),
    ("駅・繁華街名", 10_000),
]

JP_BBOX = (24.0, 46.0, 122.0, 154.0)  # lat_min, lat_max, lon_min, lon_max
CELL_RADII_M = [500, 1000, 2000]  # #1273 §32 が例示する「渋谷500m」等の探索半径
MENU_BREADTH_SCENARIOS = [M_MENU_BREADTH_OBSERVED, 2.0, 3.0, 5.0, 10.0]


# ---------------------------------------------------------------------------
# fixtures 読み込み
# ---------------------------------------------------------------------------


def load_restaurants() -> list[tuple[float, float, str]]:
    """本番 public.restaurants のCSV（name, latitude, longitude）を読み、国内分のみ返す。

    副作用: なし（読み取りのみ）。
    失敗時: CSVが無ければ SystemExit。
    """
    path = FIXTURES / "public_restaurants.csv"
    if not path.exists():
        raise SystemExit(f"fixture not found: {path}（引き継ぎtar.xzを fixtures/ に展開すること）")
    lat_min, lat_max, lon_min, lon_max = JP_BBOX
    pts: list[tuple[float, float, str]] = []
    skipped = 0
    with path.open(encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            try:
                lat, lon = float(row["latitude"]), float(row["longitude"])
            except (TypeError, ValueError):
                skipped += 1
                continue
            # #1279 【仕様】seedには海外店舗が少数混ざるため、国内bboxで絞ってから密度を測る
            if lat_min <= lat <= lat_max and lon_min <= lon <= lon_max:
                pts.append((lat, lon, row["name"]))
            else:
                skipped += 1
    if not pts:
        raise SystemExit("no domestic restaurants parsed from fixture")
    print(f"[load] restaurants in JP bbox: {len(pts):,} (skipped {skipped:,})", file=sys.stderr)
    return pts


def load_categories() -> list[dict]:
    path = FIXTURES / "public_dish_categories_134_gate.csv"
    if not path.exists():
        raise SystemExit(f"fixture not found: {path}")
    with path.open(encoding="utf-8") as fh:
        cats = list(csv.DictReader(fh))
    print(f"[load] gate categories: {len(cats)}", file=sys.stderr)
    return cats


# ---------------------------------------------------------------------------
# (A) area×category セル密度センサス
# ---------------------------------------------------------------------------


def cell_counts(pts: list[tuple[float, float, str]], radius_m: int) -> list[int]:
    """半径 radius_m の探索セルを一辺 2*radius の正方グリッドで近似し、セルごとの店舗数を返す。

    緯度による経度長の縮みは日本の重心付近(lat 35.7)で固定近似する。全国スケールの
    密度分布を見るのが目的であり、セル境界の厳密性は結論に影響しない。
    """
    dlat = (2 * radius_m) / 111_320
    dlon = (2 * radius_m) / (111_320 * math.cos(math.radians(35.7)))
    counter: collections.Counter = collections.Counter()
    for lat, lon, _ in pts:
        counter[(int(lat / dlat), int(lon / dlon))] += 1
    return list(counter.values())


def percentile(sorted_vals: list[int], p: float) -> float:
    n = len(sorted_vals)
    if n == 1:
        return float(sorted_vals[0])
    idx = p * (n - 1)
    lo, hi = math.floor(idx), math.ceil(idx)
    if lo == hi:
        return float(sorted_vals[lo])
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (idx - lo)


def density_census(pts: list[tuple[float, float, str]]) -> list[dict]:
    out = []
    for radius in CELL_RADII_M:
        counts = sorted(cell_counts(pts, radius))
        n, total = len(counts), sum(counts)
        ge = sum(1 for v in counts if v >= CELL_MIN_DISTINCT_RESTAURANTS)
        ge_weighted = sum(v for v in counts if v >= CELL_MIN_DISTINCT_RESTAURANTS)
        out.append(
            {
                "radius_m": radius,
                "populated_cells": n,
                "median": percentile(counts, 0.5),
                "p75": percentile(counts, 0.75),
                "p90": percentile(counts, 0.90),
                "p99": percentile(counts, 0.99),
                "max": counts[-1],
                # セルの何%が「そもそも5店舗以上ある」か。カテゴリを問わない上限。
                "cells_ge_min_pct": 100 * ge / n,
                "restaurant_weighted_ge_min_pct": 100 * ge_weighted / total,
                "top1pct_cells_share_pct": 100 * sum(counts[int(0.99 * n) :]) / total,
            }
        )
    return out


# ---------------------------------------------------------------------------
# (B) §32 KPI の pigeonhole 上限（SNS供給とは無関係な構造的上限）
# ---------------------------------------------------------------------------


def cell_kpi_ceiling(pts: list[tuple[float, float, str]], n_categories: int) -> list[dict]:
    """「area×categoryセルごとに異なる5店舗」というKPIの達成率上限を鳩の巣原理で出す。

    セル内の店舗数を R、1店舗が attribution されうるカテゴリ数を m とすると、
    そのセルで5店舗条件を満たせるカテゴリ数は高々 R*m/5。SNS側の発見率が仮に100%でも
    これを超えられないため、Discovery手段の性能とは独立な上限になる。
    """
    out = []
    for radius in CELL_RADII_M:
        counts = cell_counts(pts, radius)
        n, total = len(counts), sum(counts)
        for m in MENU_BREADTH_SCENARIOS:
            satisfiable = [min(n_categories, r * m / CELL_MIN_DISTINCT_RESTAURANTS) for r in counts]
            uniform = sum(satisfiable) / (n * n_categories)
            # 店舗加重: ランダムな1店舗の周辺セルで見た達成率。ユーザーの体感に近い方の指標。
            weighted = sum(s * r for s, r in zip(satisfiable, counts)) / (total * n_categories)
            out.append(
                {
                    "radius_m": radius,
                    "menu_breadth_m": m,
                    "cell_uniform_ceiling_pct": 100 * uniform,
                    "restaurant_weighted_ceiling_pct": 100 * weighted,
                }
            )
    return out


# ---------------------------------------------------------------------------
# (C) Route B のカバレッジ分解と、クエリ予算フロンティア
# ---------------------------------------------------------------------------


def query_budget_frontier(n_restaurants_now: int, depth: int) -> list[dict]:
    """area粒度ごとに、60%カバレッジ達成に必要な『1クエリあたり初出マッチ店舗数 u』を逆算する。

    Route Bでは試行単位が店舗ではなくクエリなので、必要 u = (N × target) / queries。
    u はスイープ深さ depth を超えられない（1クエリはdepth件しか返さない）ため、
    u/depth > 1 となる粒度はその時点で構造的に不可能と判定できる。
    """
    rows = []
    for name, n_areas in AREA_TIERS:
        queries = n_areas * 134
        slots = queries * depth
        for label, n_target in (("現状(103k)", n_restaurants_now), ("目標(700k)", N_RESTAURANTS_TARGET)):
            needed = n_target * COVERAGE_TARGET
            u = needed / queries
            rows.append(
                {
                    "area_tier": name,
                    "n_areas": n_areas,
                    "queries_per_sweep": queries,
                    "video_slots": slots,
                    "population": label,
                    "restaurants_needed": needed,
                    "u_required": u,
                    "slot_efficiency_required_pct": 100 * u / depth,
                    "structurally_impossible": u > depth,
                    "days_optimistic": queries / QUERIES_PER_DAY_OPTIMISTIC,
                    "days_conservative": queries / QUERIES_PER_DAY_CONSERVATIVE,
                }
            )
    return rows


def supply_ceiling_breakeven() -> dict:
    """coverage = S × R_eff の分解と、60%目標が要求する S の下限。

    S   : YouTube上に「その店舗を識別可能な形で名指しした動画」が1本以上存在する店舗の割合
          （YouTube側のコンテンツ供給の性質であり、こちらのパイプライン性能とは独立）
    R_eff: 供給が存在する店舗のうち、掃引のtop-Dに実際に浮上して逆引きできる割合
    R_eff <= 1 なので coverage <= S。したがって60%目標は S >= 0.60 を必要条件として要求する。
    """
    return {
        "model": "coverage = S(supply ceiling) x R_eff(retrieval efficiency)",
        "r_eff_upper_bound": 1.0,
        "implied_min_supply_ceiling_for_target": COVERAGE_TARGET,
        "note": (
            "R_eff<=1 のため coverage<=S。60%目標は『日本の飲食店の60%以上が、"
            "店名を識別できる形のYouTube動画を1本以上持つ』ことを必要条件として要求する。"
        ),
        # S を仮定した場合の到達可能カバレッジ（R_eff は掃引設計で決まる係数）
        "scenarios": [
            {
                "supply_ceiling_s": s,
                "coverage_at_r_eff_100pct": s,
                "coverage_at_r_eff_70pct": s * 0.70,
                "coverage_at_r_eff_40pct": s * 0.40,
                "meets_target_even_at_perfect_retrieval": s >= COVERAGE_TARGET,
            }
            for s in (0.05, 0.10, 0.20, 0.35, 0.50, 0.60, 0.80)
        ],
    }


# ---------------------------------------------------------------------------
# (D) 名称由来のカテゴリ手掛かり（m の下限側の実測）
# ---------------------------------------------------------------------------


def name_category_signal(pts: list[tuple[float, float, str]], cats: list[dict]) -> dict:
    """店舗名に134カテゴリの label_ja がそのまま含まれる割合を測る。

    Route Bの逆引きでは「店名 → カテゴリ」の手掛かりが強いほど誤マッチを弾ける。
    ここで得られるのは m（1店舗が名乗れるカテゴリ数）の下限側の実測値であり、
    店名にカテゴリ語を含まない店（例:「麺屋 武蔵」）は取りこぼすため過小評価になる。
    """
    labels = [c["label_ja"] for c in cats if c.get("label_ja")]
    matched = 0
    per_label: collections.Counter = collections.Counter()
    n_labels_hist: collections.Counter = collections.Counter()
    for _, _, name in pts:
        hits = [lb for lb in labels if lb in name]
        n_labels_hist[len(hits)] += 1
        if hits:
            matched += 1
            for h in hits:
                per_label[h] += 1
    return {
        "restaurants_with_category_token_in_name": matched,
        "restaurants_total": len(pts),
        "pct": 100 * matched / len(pts),
        "labels_per_name_histogram": {str(k): v for k, v in sorted(n_labels_hist.items())},
        "top_labels": per_label.most_common(20),
        "caveat": "店名にカテゴリ語を含まない店を取りこぼすため、mの下限側の推定にしかならない",
    }


# ---------------------------------------------------------------------------
# 出力
# ---------------------------------------------------------------------------


def render_markdown(result: dict) -> str:
    lines: list[str] = []
    add = lines.append
    add(f"# Route B カバレッジ再モデル化 ({result['generated_at']})\n")
    add(f"対象: 国内 {result['inputs']['n_restaurants_jp']:,} 店 / {result['inputs']['n_categories']} カテゴリ / "
        f"目標カバレッジ {COVERAGE_TARGET:.0%}\n")

    add("## (A) 探索セルの店舗密度センサス（本番 public.restaurants 実測）\n")
    add("| 半径 | 有店舗セル数 | 中央値 | p90 | p99 | 最大 | 5店舗以上のセル | 同(店舗加重) | 上位1%セルの店舗シェア |")
    add("|---|---:|---:|---:|---:|---:|---:|---:|---:|")
    for r in result["density_census"]:
        add(f"| {r['radius_m']}m | {r['populated_cells']:,} | {r['median']:.0f} | {r['p90']:.0f} | "
            f"{r['p99']:.0f} | {r['max']:,} | {r['cells_ge_min_pct']:.1f}% | "
            f"{r['restaurant_weighted_ge_min_pct']:.1f}% | {r['top1pct_cells_share_pct']:.1f}% |")

    add("\n## (B) #1273 §32 KPI（area×categoryごとに異なる5店舗）の構造的上限\n")
    add("SNS側の発見率を **仮に100%** としても超えられない鳩の巣原理の上限。"
        "m = 1店舗が attribution されうるカテゴリ数。\n")
    add("| 半径 | m | セル一様での上限 | 店舗加重での上限 |")
    add("|---|---:|---:|---:|")
    for r in result["cell_kpi_ceiling"]:
        add(f"| {r['radius_m']}m | {r['menu_breadth_m']:.2f} | {r['cell_uniform_ceiling_pct']:.1f}% | "
            f"{r['restaurant_weighted_ceiling_pct']:.1f}% |")

    add("\n## (C) Route B クエリ予算フロンティア\n")
    add(f"1スイープ = areas × 134カテゴリ、ytsearch{result['inputs']['search_depth']} 相当。\n")
    add("| area粒度 | areas | queries/sweep | 動画スロット | 母集団 | 必要u | 必要スロット効率 | 判定 | 所要日数(楽観〜保守) |")
    add("|---|---:|---:|---:|---|---:|---:|---|---:|")
    for r in result["query_budget_frontier"]:
        verdict = "**構造的に不可能**" if r["structurally_impossible"] else "予算上は可能"
        add(f"| {r['area_tier']} | {r['n_areas']:,} | {r['queries_per_sweep']:,} | {r['video_slots']:,} | "
            f"{r['population']} | {r['u_required']:.2f} | {r['slot_efficiency_required_pct']:.0f}% | {verdict} | "
            f"{r['days_optimistic']:.1f}〜{r['days_conservative']:.1f}日 |")
    add("\nu = 1クエリあたり『初出かつ店舗を特定できた』restaurant数。u > 探索深さ となる粒度は、"
        "返ってくる動画スロット数自体が目標店舗数を下回るため不可能。\n")

    add("## (D) 供給上限 S による分解\n")
    sc = result["supply_ceiling"]
    add(f"`{sc['model']}`\n")
    add(f"{sc['note']}\n")
    add("| 供給上限 S | R_eff=100% | R_eff=70% | R_eff=40% | 完全retrievalでも60%到達 |")
    add("|---:|---:|---:|---:|---|")
    for s in sc["scenarios"]:
        add(f"| {s['supply_ceiling_s']:.0%} | {s['coverage_at_r_eff_100pct']:.1%} | "
            f"{s['coverage_at_r_eff_70pct']:.1%} | {s['coverage_at_r_eff_40pct']:.1%} | "
            f"{'○' if s['meets_target_even_at_perfect_retrieval'] else '×'} |")

    add("\n## (E) 店名由来のカテゴリ手掛かり（m の下限実測）\n")
    ns = result["name_category_signal"]
    add(f"店名に134カテゴリの label_ja をそのまま含む店舗: "
        f"{ns['restaurants_with_category_token_in_name']:,} / {ns['restaurants_total']:,} = {ns['pct']:.1f}%\n")
    add(f"注記: {ns['caveat']}\n")
    add("| label_ja | 該当店舗数 |")
    add("|---|---:|")
    for label, cnt in ns["top_labels"][:10]:
        add(f"| {label} | {cnt:,} |")

    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="#1279 Route B coverage re-model")
    parser.add_argument("--depth", type=int, default=SEARCH_DEPTH_DEFAULT, help="1クエリあたりの探索深さ(ytsearchN)")
    args = parser.parse_args()

    pts = load_restaurants()
    cats = load_categories()

    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "inputs": {
            "n_restaurants_jp": len(pts),
            "n_categories": len(cats),
            "n_restaurants_target": N_RESTAURANTS_TARGET,
            "coverage_target": COVERAGE_TARGET,
            "cell_min_distinct_restaurants": CELL_MIN_DISTINCT_RESTAURANTS,
            "search_depth": args.depth,
            "throughput_queries_per_day": {
                "optimistic": QUERIES_PER_DAY_OPTIMISTIC,
                "conservative": QUERIES_PER_DAY_CONSERVATIVE,
            },
        },
        "density_census": density_census(pts),
        "cell_kpi_ceiling": cell_kpi_ceiling(pts, len(cats)),
        "query_budget_frontier": query_budget_frontier(len(pts), args.depth),
        "supply_ceiling": supply_ceiling_breakeven(),
        "name_category_signal": name_category_signal(pts, cats),
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    json_path = OUT_DIR / f"coverage_route_b_{date_str}.json"
    json_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

    md = render_markdown(result)
    md_path = OUT_DIR / f"coverage_route_b_{date_str}.md"
    md_path.write_text(md, encoding="utf-8")

    print(md)
    print(f"Saved: {json_path.relative_to(REPO_ROOT)}", file=sys.stderr)
    print(f"Saved: {md_path.relative_to(REPO_ROOT)}", file=sys.stderr)


if __name__ == "__main__":
    main()
