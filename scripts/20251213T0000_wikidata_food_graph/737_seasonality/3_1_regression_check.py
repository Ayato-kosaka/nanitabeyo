#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
3_1_regression_check.py

【目的】
#737 季節補正を入れた後の推薦リグレッションを、**PostgreSQL dev の実データ**で測る。

【何を測るか】
`581_relevance_scoring/manual/README.md` の「recommendationへの影響確認」に従い、
1 回の結果で判断せず、同じ検索条件を w_season = 0（＝補正なし＝従来）と
w_season = 0.25（＝今回）で繰り返し実行して比較する。

  A. 順位（jitter なし）: どのカテゴリが何位に動いたか。**非季節カテゴリが動かないこと**の確認
  B. 出現率（jitter あり × N 回）: 冬型カテゴリが上位 6 件に入る割合

【SQL は写経しない】
推薦の SQL は `api/src/v1/dish-categories/dish-categories.repository.ts` の
テンプレートリテラルから**実行時に抜き出して**使う。ここへコピーすると、
本体が変わったときにこの計測だけが古い式を測り続ける。

⚠️ B は `order_score` の上位 6 件で数えており、**スレート選択の多様性ペナルティと
macro_genre の重複除外は含まない**（それは service 側の TypeScript にある）。
したがって B は「実際に 6 枚へ入る確率」の上限側の近似である。A は近似ではない。

【読み取りしかしない】
このスクリプトは SELECT しか実行しない。

【使用方法】.github/workflows/db-script-run.yml から
  script_path: scripts/20251213T0000_wikidata_food_graph/737_seasonality/3_1_regression_check.py
  args: --schema dev --repeats 300
"""

import argparse
import logging
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[3]
REPOSITORY_TS = REPO_ROOT / "api/src/v1/dish-categories/dish-categories.repository.ts"

# app-expo/lib/remoteConfig.ts の DEFAULT_REMOTE_CONFIG と同じ既定値。
# Remote Config を変えたらここも合わせる（合っていないと «本番と違う条件» を測ることになる）。
WEIGHTS = {
    "wTime": 1.5, "wScene": 1.1, "wSatiety": 1.0, "wTaste": 5.0,
    "wBudgetIntent": 2.2, "wDiningPace": 2.2, "wCoreIngredient": 8.0,
    "wMarketSalience": 0.05, "wDineOutOrderability": 0.1,
}
JITTER = 0.12
CANDIDATE_LIMIT = 200

# 承認した 19 件のうち冬型（8月指数 < 1.0）。README / review JSONL と一致させてある。
WINTER_QIDS = [
    "Q655040", "Q1962004", "Q3775525", "Q5183356", "Q862569", "Q701756",
    "Q56236136", "Q1061856", "Q1412833", "Q846849", "Q28100912",
    "Q108798661", "Q2706994",
]
# 季節の行を持たない対照群。w_season をどれだけ動かしても 1 つも動かないはず。
CONTROL_LABELS = ["焼肉", "唐揚げ", "ラーメン", "焼き鳥", "とんかつ", "オムライス"]

SCENARIOS = [
    {"name": "夜 × 友人", "timeSlotKey": "dinner", "sceneKey": "friends"},
    {"name": "深夜 × 飲み", "timeSlotKey": "late_night", "sceneKey": "drinking"},
    {"name": "昼 × 一人", "timeSlotKey": "lunch", "sceneKey": "solo"},
    {"name": "条件なし", "timeSlotKey": None, "sceneKey": None},
]


def load_sql() -> tuple[str, list[str]]:
    """repository.ts のテンプレートリテラルから SQL を抜き、${...} を %s へ置き換える"""
    src = REPOSITORY_TS.read_text(encoding="utf-8")
    start = src.index("WITH params AS (")
    end = src.index("LIMIT (SELECT candidate_limit FROM params)", start)
    sql = src[start:end] + "LIMIT (SELECT candidate_limit FROM params)"
    exprs: list[str] = []

    def repl(m):
        exprs.append(m.group(1))
        return "%s"

    sql = re.sub(r"\$\{([^}]*)\}", repl, sql)
    if "${" in sql:
        raise SystemExit("ネストした ${} が残っている。抽出ロジックを見直すこと")
    return sql, exprs


def build_params(exprs: list[str], scenario: dict, month: str, w_season: float, jitter: float):
    """抜き出した順に値を積む。式の中身で引くので、TS 側の並び替えに追従できる"""
    region_tokens = ["region:country:JP"]
    values = {
        "userId": "00000000-0000-0000-0000-000000000000",
        "addressTokens": ["country:JP"],
        "regionTokens": region_tokens,
        "regionFallbackKeys": list(reversed(region_tokens)) + ["global"],
        "seasonFallbackKeys": [f"region:country:JP:month:{month}", f"global:month:{month}"],
        "budgetIntentKeys": [],
        "timeSlotKey": scenario["timeSlotKey"],
        "sceneKey": scenario["sceneKey"],
        "satietyKey": None,
        "diningPaceKey": None,
        "coreIngredientKey": None,
        "tasteKey": None,
        "candidateLimit": CANDIDATE_LIMIT,
        "scoreJitterRatio": jitter,
        "wSeason": w_season,
        **WEIGHTS,
    }
    out = []
    for expr in exprs:
        hit = [k for k in values if re.search(rf"\b{k}\b", expr)]
        if len(hit) != 1:
            raise SystemExit(f"プレースホルダを解決できない: {expr!r}（候補 {hit}）")
        out.append(values[hit[0]])
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--schema", required=True, choices=["dev", "public"])
    p.add_argument("--repeats", type=int, default=300,
                   help="jitter ありの試行回数。0 を渡すと出現率の計測を飛ばす（順位だけ見たいとき）")
    p.add_argument("--months", type=str, default="08,12")
    p.add_argument(
        "--watch", type=str, default=None,
        help="final_score を追跡する QID をカンマ区切りで指定する。"
             "feature の値を直す前後で 2 回流し、動いてよいものだけが動いたかを見る（#1637）",
    )
    args = p.parse_args()

    sql, exprs = load_sql()
    logger.info(f"SQL を {REPOSITORY_TS.relative_to(REPO_ROOT)} から抽出（{len(exprs)} プレースホルダ）")

    import psycopg2
    dsn = os.environ["DATABASE_URL"]
    conn = psycopg2.connect(dsn)
    conn.set_session(readonly=True, autocommit=True)
    cur = conn.cursor()
    cur.execute(f'SET search_path TO "{args.schema}", public')

    # dish_category_features.dish_category_id は BigQuery の item_qid そのものなので
    # （9_2 の `item_qid as dish_category_id`）、dish_categories.id ＝ QID である。
    cur.execute("SELECT id, COALESCE(labels->>'ja', label_en) FROM dish_categories")
    label = {r[0]: r[1] for r in cur.fetchall()}
    winter_ids = {q for q in WINTER_QIDS if q in label}
    # QID でも料理名でも指定できる（対照群は QID を覚えていないことが多い）
    by_label = {v: k for k, v in label.items()}
    watch = []
    for tok in (args.watch.split(",") if args.watch else []):
        tok = tok.strip()
        if not tok:
            continue
        cid = tok if tok in label else by_label.get(tok)
        if cid is None:
            logger.warning(f"--watch で指定された '{tok}' は dev に見つからない")
            continue
        watch.append(cid)
    missing = [q for q in WINTER_QIDS if q not in label]
    logger.info(f"冬型カテゴリ: {len(winter_ids)} / {len(WINTER_QIDS)} 件を dev で解決")
    if missing:
        logger.warning(f"dev に存在しない QID: {missing}")

    def run(scenario, month, w_season, jitter):
        cur.execute(sql, build_params(exprs, scenario, month, w_season, jitter))
        return cur.fetchall(), [d[0] for d in cur.description]

    for month in args.months.split(","):
        print("\n" + "=" * 78)
        print(f"◆ {month} 月")
        print("=" * 78)
        for sc in SCENARIOS:
            rows0, cols = run(sc, month, 0.0, 0.0)
            rows1, _ = run(sc, month, 0.25, 0.0)
            i_id, i_final = cols.index("category_id"), cols.index("final_score")
            i_season = cols.index("season_score")
            rank0 = {r[i_id]: n for n, r in enumerate(rows0, 1)}
            rank1 = {r[i_id]: n for n, r in enumerate(rows1, 1)}
            score0 = {r[i_id]: float(r[i_final]) for r in rows0}
            score1 = {r[i_id]: float(r[i_final]) for r in rows1}

            # 【重要】順位の差で数えてはいけない。
            # jitter=0 だと final_score が同値のカテゴリが多数でき、ORDER BY の同点行は
            # 並び順が不定なので «動いた» が大量に出る（12 月は score が 1 つも変わらないのに
            # 80/134 件が動いたように見えた）。判定は score の一致で行う。
            changed = [c for c in score0 if abs(score0[c] - score1.get(c, score0[c])) > 1e-9]
            controls = [c for c in score0 if label.get(c) in CONTROL_LABELS]
            controls_changed = [c for c in controls if c in changed]

            print(f"\n--- {sc['name']} ---")
            print(f"score が変わったカテゴリ: {len(changed)} / {len(score0)} 件"
                  f"（対照群 {len(controls) - len(controls_changed)}/{len(controls)} 件は完全一致）")
            print("  ※ 順位は上位が沈んだぶん下位が繰り上がるので «順位が動いた件数» では測らない"
                  "（同点行の並び順も不定）")
            shown = 0
            for cid in sorted(winter_ids & rank0.keys(), key=lambda c: rank0[c]):
                s = next((r[i_season] for r in rows1 if r[i_id] == cid), None)
                f0 = next(r[i_final] for r in rows0 if r[i_id] == cid)
                f1 = next(r[i_final] for r in rows1 if r[i_id] == cid)
                print(f"  {label.get(cid, cid):<12} {rank0[cid]:>3}位 → {rank1[cid]:>3}位 "
                      f"/ score {float(f0):.4f} → {float(f1):.4f} (season {float(s):.2f})")
                shown += 1
                if shown >= 8:
                    break

            if watch:
                print("  [watch] final_score（w_season=0.25 / jitter=0）")
                for cid in watch:
                    if cid in score1:
                        print(f"    {label.get(cid, cid):<12} {score1[cid]:.6f}"
                              f"  ({rank1.get(cid)}位)")
                    else:
                        print(f"    {label.get(cid, cid):<12} (候補に出ていない)")

            # B: jitter ありで上位 6 件に冬型が入る割合
            if args.repeats <= 0:
                continue
            hits = {0.0: 0, 0.25: 0}
            for w in (0.0, 0.25):
                for _ in range(args.repeats):
                    rows, _c = run(sc, month, w, JITTER)
                    top6 = {r[i_id] for r in rows[:6]}
                    if top6 & winter_ids:
                        hits[w] += 1
            n = args.repeats
            print(f"  冬型が上位6件に入る割合（{n} 回）: "
                  f"w=0 {hits[0.0]/n*100:.1f}% → w=0.25 {hits[0.25]/n*100:.1f}%"
                  "  ※多様性ペナルティ未考慮の上限側近似")

    cur.close()
    conn.close()
    print("\n✅ 完了")


if __name__ == "__main__":
    main()
