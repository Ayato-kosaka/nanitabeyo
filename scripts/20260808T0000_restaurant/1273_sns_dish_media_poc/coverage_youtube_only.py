#!/usr/bin/env python3
"""idea検証: youtube-only-coverage-ceiling (#1273 Round2)

YouTube単独(yt-dlp Route B)の全国カバレッジ上限試算。

読み取り専用スクリプト。dev.dish_category_features / dev.dishes を SELECT するのみで、
書き込みは一切行わない。DATABASE_URL は scripts/.env から読み込む。

実行:
    python3 coverage_youtube_only.py
"""

from __future__ import annotations

import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import psycopg2
except ImportError:  # pragma: no cover
    print("psycopg2 が見つかりません。system python3 (/usr/bin/python3) で実行してください。", file=sys.stderr)
    raise

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent.parent
ENV_PATH = REPO_ROOT / "scripts" / ".env"
OUT_DIR = HERE / "out"

# ---------------------------------------------------------------------------
# REPORT.md (#1273 v3 実測) に明記された定数。今回のスクリプトでは一切再測定せず、
# 既に確定した実測値をそのまま埋め込む(issueの重複調査回避の方針に従う)。
# ---------------------------------------------------------------------------
P_ATTEMPT_V3 = 4 / 20  # restaurant_matched / candidates (v3, クレジット文脈除外後)
P_VIDEO_FOUND_V3 = 18 / 20  # video_found / candidates (v3)
THROUGHPUT_SEQ_QPH = 3900  # 逐次delay0, 実測
THROUGHPUT_PAR5_QPH_LOW = 4000  # 並列5, 実測レンジ下限
THROUGHPUT_PAR5_QPH_HIGH = 5000  # 並列5, 実測レンジ上限
THROUGHPUT_PAR10_QPH_REF = 11700  # 並列10, 参考値(未本番採用)

N_RESTAURANTS_JP = 700_000  # issue本文記載の国内目標店舗数

K_SCENARIOS = [1, "avg", 2, 3, 5, 8, 13]  # "avg" は実測平均(dev.dishes)に置換
BIAS_DISCOUNTS = [1.0, 0.75, 0.5]  # p_attemptに対する感度分析係数
COVERAGE_TARGET = 0.60


def load_database_url() -> str:
    if not ENV_PATH.exists():
        raise SystemExit(f"env file not found: {ENV_PATH}")
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("DATABASE_URL not found in scripts/.env")


def fetch_gate_categories_with_salience(conn) -> list[dict]:
    """(1) dev.dish_category_features: feature_type='gate' AND score=1 の134カテゴリと
    feature_type='market_salience' AND feature_key='region:country:JP' のスコアをJOIN。
    読み取り専用SELECTのみ。
    """
    sql = """
        select
            g.dish_category_id,
            m.score as market_salience_jp
        from dev.dish_category_features g
        left join dev.dish_category_features m
            on m.dish_category_id = g.dish_category_id
            and m.feature_type = 'market_salience'
            and m.feature_key = 'region:country:JP'
        where g.feature_type = 'gate' and g.score = 1
        order by g.dish_category_id
    """
    with conn.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()
    return [{"dish_category_id": r[0], "market_salience_jp": r[1]} for r in rows]


def fetch_dishes_per_restaurant_distribution(conn) -> dict:
    """(2) dev.dishes を restaurant_id でGROUP BYし、COUNT(DISTINCT category_id)の分布を算出。
    読み取り専用SELECTのみ。
    """
    sql = """
        select restaurant_id, count(distinct category_id) as n_categories
        from dev.dishes
        group by restaurant_id
    """
    with conn.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()
    counts = sorted(r[1] for r in rows)
    n = len(counts)
    if n == 0:
        raise SystemExit("dev.dishes returned 0 restaurants; cannot compute distribution")

    def percentile(p: float) -> float:
        if n == 1:
            return float(counts[0])
        idx = p * (n - 1)
        lo = math.floor(idx)
        hi = math.ceil(idx)
        if lo == hi:
            return float(counts[lo])
        frac = idx - lo
        return counts[lo] + (counts[hi] - counts[lo]) * frac

    mean_val = sum(counts) / n
    return {
        "n_restaurants": n,
        "mean": mean_val,
        "median": percentile(0.5),
        "p25": percentile(0.25),
        "p75": percentile(0.75),
        "p90": percentile(0.90),
        "min": counts[0],
        "max": counts[-1],
    }


def k_for_target_coverage(p: float, target: float = COVERAGE_TARGET) -> float | None:
    """coverage = 1 - (1-p)^k = target を k について解く: k = ln(1-target) / ln(1-p)"""
    if p <= 0 or p >= 1:
        return None
    return math.log(1 - target) / math.log(1 - p)


def coverage(p: float, k: float) -> float:
    return 1 - (1 - p) ** k


def main() -> None:
    database_url = load_database_url()
    conn = psycopg2.connect(database_url)
    conn.set_session(readonly=True, autocommit=True)  # DB接続を明示的に読み取り専用にする
    try:
        categories = fetch_gate_categories_with_salience(conn)
        dist = fetch_dishes_per_restaurant_distribution(conn)
    finally:
        conn.close()

    salience_scores = [c["market_salience_jp"] for c in categories if c["market_salience_jp"] is not None]

    print("## (1) dish_category_features: gate(score=1) x market_salience(region:country:JP)", file=sys.stderr)
    print(
        f"gate categories = {len(categories)}, "
        f"market_salience matched = {len(salience_scores)}, "
        f"score range = [{min(salience_scores):.2f}, {max(salience_scores):.2f}]"
        if salience_scores
        else "market_salience: no matches",
        file=sys.stderr,
    )
    print("## (2) dishes per restaurant (COUNT DISTINCT category_id)", file=sys.stderr)
    print(json.dumps(dist, indent=2, ensure_ascii=False), file=sys.stderr)

    k_avg = dist["mean"]

    # --- (4) coverage table: k in {1, avg, 2, 3, 5, 8, 13} at p_attempt = P_ATTEMPT_V3 ---
    resolved_k_scenarios = [k_avg if k == "avg" else k for k in K_SCENARIOS]

    table_rows = []
    for k_label, k in zip(K_SCENARIOS, resolved_k_scenarios):
        cov = coverage(P_ATTEMPT_V3, k)
        total_queries = N_RESTAURANTS_JP * k
        hours_par5_low = total_queries / THROUGHPUT_PAR5_QPH_HIGH  # more queries/h -> fewer hours; use high throughput for lower bound on time
        hours_par5_high = total_queries / THROUGHPUT_PAR5_QPH_LOW
        table_rows.append(
            {
                "k_label": str(k_label),
                "k": k,
                "coverage_pct": cov * 100,
                "total_queries": total_queries,
                "hours_par5_range": [hours_par5_low, hours_par5_high],
                "days_par5_range": [hours_par5_low / 24, hours_par5_high / 24],
            }
        )

    # --- (5) sensitivity: p_attempt discounted by {1.0, 0.75, 0.5}, back-solve k for 60% target ---
    sensitivity_rows = []
    for discount in BIAS_DISCOUNTS:
        p = P_ATTEMPT_V3 * discount
        k60 = k_for_target_coverage(p, COVERAGE_TARGET)
        cov_at_k_avg = coverage(p, k_avg)
        sensitivity_rows.append(
            {
                "discount": discount,
                "p_attempt": p,
                "k_for_60pct_coverage": k60,
                "coverage_at_k_avg_realistic": cov_at_k_avg * 100,
            }
        )

    # --- (7) realistic upper-bound point estimate using observed k (median=1, mean=1.17) ---
    cov_k_median = coverage(P_ATTEMPT_V3, dist["median"])
    cov_k_mean = coverage(P_ATTEMPT_V3, dist["mean"])

    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "constants": {
            "p_attempt_v3": P_ATTEMPT_V3,
            "p_video_found_v3": P_VIDEO_FOUND_V3,
            "throughput_seq_qph": THROUGHPUT_SEQ_QPH,
            "throughput_par5_qph_range": [THROUGHPUT_PAR5_QPH_LOW, THROUGHPUT_PAR5_QPH_HIGH],
            "throughput_par10_qph_ref": THROUGHPUT_PAR10_QPH_REF,
            "n_restaurants_jp": N_RESTAURANTS_JP,
            "coverage_target": COVERAGE_TARGET,
        },
        "gate_categories": {
            "count": len(categories),
            "market_salience_matched": len(salience_scores),
            "market_salience_score_range": [min(salience_scores), max(salience_scores)] if salience_scores else None,
        },
        "dishes_per_restaurant_distribution": dist,
        "coverage_table": table_rows,
        "sensitivity_k_for_60pct": sensitivity_rows,
        "realistic_upper_bound": {
            "k_median_observed": dist["median"],
            "k_mean_observed": dist["mean"],
            "coverage_at_k_median_pct": cov_k_median * 100,
            "coverage_at_k_mean_pct": cov_k_mean * 100,
            "gap_to_60pct_target_pp_median": 60 - cov_k_median * 100,
            "gap_to_60pct_target_pp_mean": 60 - cov_k_mean * 100,
        },
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out_json_path = OUT_DIR / f"coverage_youtube_only_{date_str}.json"
    out_json_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

    # ---- Markdown table to stdout ----
    print(f"# coverage_youtube_only.py 実行結果 ({result['generated_at']})\n")
    print(f"gate categories: {len(categories)} (market_salience JOIN matched: {len(salience_scores)}, "
          f"score range [{min(salience_scores):.2f}, {max(salience_scores):.2f}])\n" if salience_scores else "")
    print(f"dev.dishes distribution (restaurant単位, COUNT DISTINCT category_id, n={dist['n_restaurants']}):")
    print(f"- mean={dist['mean']:.3f}, median={dist['median']:.1f}, p25={dist['p25']:.1f}, "
          f"p75={dist['p75']:.1f}, p90={dist['p90']:.1f}, min={dist['min']}, max={dist['max']}\n")

    print(f"## Coverage table (p_attempt = {P_ATTEMPT_V3:.2f} = {P_ATTEMPT_V3*4:.0f}/20, N = {N_RESTAURANTS_JP:,})\n")
    print("| k | coverage | total queries | time @par5 (4000-5000 q/h) |")
    print("|---|---:|---:|---:|")
    for row in table_rows:
        h_lo, h_hi = row["hours_par5_range"]
        d_lo, d_hi = row["days_par5_range"]
        print(
            f"| {row['k_label']} (k={row['k']:.2f}) | {row['coverage_pct']:.1f}% | "
            f"{row['total_queries']:,.0f} | {h_lo:,.0f}-{h_hi:,.0f}h ({d_lo:.1f}-{d_hi:.1f}d) |"
        )

    print(f"\n## Sensitivity: p_attempt discount, k required for {COVERAGE_TARGET*100:.0f}% coverage\n")
    print("| discount | p_attempt | k for 60% coverage | coverage @ k=avg({:.2f}) |".format(k_avg))
    print("|---|---:|---:|---:|")
    for row in sensitivity_rows:
        k60 = row["k_for_60pct_coverage"]
        print(
            f"| x{row['discount']} | {row['p_attempt']:.3f} | {k60:.1f} | "
            f"{row['coverage_at_k_avg_realistic']:.1f}% |"
        )

    print("\n## 現実的な上限k(実測メニュー幅)でのcoverage点推定")
    print(
        f"- k=median observed ({dist['median']:.0f}): coverage = {cov_k_median*100:.1f}% "
        f"(60%目標とのギャップ: {60 - cov_k_median*100:.1f}pp)"
    )
    print(
        f"- k=mean observed ({dist['mean']:.2f}): coverage = {cov_k_mean*100:.1f}% "
        f"(60%目標とのギャップ: {60 - cov_k_mean*100:.1f}pp)"
    )

    print(f"\nSaved: {out_json_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
