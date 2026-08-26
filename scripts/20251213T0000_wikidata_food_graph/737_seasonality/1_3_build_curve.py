#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_3_build_curve.py

【目的】
#737 生の月次 PV から 12 か月の季節指数を計算し、**レビュー用のシートを書き出す**

【BigQuery へは書かない】
ここまではローカル完結。BigQuery へ入るのは、人がレビューを終えた後の
`2_1_load_feature_scores.py` から（既存の `wikidata_food_llm_feature_scores` へ）。

【計算内容】
1. 月ごとの平均 PV ÷ 全期間の平均 PV = 生の月指数（index_raw）
2. 未完成月を捨てる（全記事合計が中央値の N% 未満の月）
3. 全記事共通の季節成分を割り戻す（月ごとの中央値で割る）= index_value
4. 振幅・月平均PV・観測月数から needs_review を機械判定

【出力】
- curve_<run_id>.jsonl  : 134 件 × 12 か月の全曲線（機械可読）
- review_<run_id>.jsonl : レビュー対象だけ。decision / reason を空で出すので人が埋める
- review_<run_id>.md    : 人が読む表（12 か月を横に並べたもの）

【使用方法】
python3 1_3_build_curve.py --run-id 20260825T0000
"""

import argparse
import json
import logging
import statistics
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lib.io import ensure_directory, load_yaml_config, read_jsonl, write_jsonl

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def drop_incomplete_months(rows, ratio):
    """
    未完成月を捨てる

    Wikimedia の直近月は集計が完了しておらず、**全記事いっせいに** 90% 以上落ちた値が返る。
    実測（2026-08-25 時点、2026-07）: おでん 2,612→200 / ラーメン 15,442→444 / 焼き鳥 2,753→80。
    素直に指数を計算すると全カテゴリへ「その月は不人気」という偽の季節性を刻む
    （対照群の焼き鳥ですら振幅 34 倍になることを確認済み）。

    本物の季節性は夏物と冬物が逆方向に動くため**全記事合計はほとんど動かない**のに対し、
    この断絶は 97% 減。固定の「N か月前まで」にしないのは、遅れが常に同じ長さとは限らないため。
    """
    total_by_ym = defaultdict(int)
    for r in rows:
        total_by_ym[r["ym"]] += r["views"]
    median_total = statistics.median(total_by_ym.values())
    dropped = sorted(ym for ym, t in total_by_ym.items() if t < ratio * median_total)
    kept = [r for r in rows if r["ym"] not in set(dropped)]
    return kept, dropped, total_by_ym, median_total


def build(rows, config):
    """月指数を計算して 1 件 = 1 カテゴリの dict にまとめる"""
    by_item = defaultdict(list)
    for r in rows:
        by_item[r["item_qid"]].append(r)

    # 1) 生の月指数
    raw_index = {}
    meta = {}
    for qid, rs in by_item.items():
        overall = statistics.mean(x["views"] for x in rs)
        by_month = defaultdict(list)
        for x in rs:
            by_month[int(x["ym"][5:7])].append(x["views"])
        if overall <= 0:
            continue
        raw_index[qid] = {m: statistics.mean(v) / overall for m, v in by_month.items()}
        meta[qid] = {
            "article": rs[0]["article"],
            "wiki": rs[0]["wiki"],
            "monthly_pv_mean": overall,
            "months_observed": len(rs),
        }

    # 2) 全記事共通の季節成分（月ごとの中央値）を割り戻す
    #    8 月は全記事が一律 15% 沈む（夏休みで PC からの閲覧が減る等）。
    #    割り戻さないと、season の行を持つ料理だけが余計に沈む。
    #    中央値を使うのは、かき氷（3.08）のような極端な料理に引きずられないため。
    baseline = {}
    for m in range(1, 13):
        vals = [ri[m] for ri in raw_index.values() if m in ri]
        baseline[m] = statistics.median(vals) if vals else 1.0

    out = []
    for qid, ri in raw_index.items():
        idx = {m: ri.get(m, 1.0) / baseline[m] for m in range(1, 13)}
        amp = max(idx.values()) / max(min(idx.values()), 0.01)
        mv = meta[qid]
        needs = (
            mv["months_observed"] >= config["min_months_observed"]
            and mv["monthly_pv_mean"] >= config["min_monthly_pv"]
            and amp >= config["min_amplitude"]
        )
        flag = (
            "insufficient_history" if mv["months_observed"] < config["min_months_observed"]
            else "low_traffic" if mv["monthly_pv_mean"] < config["min_monthly_pv"]
            else "flat" if amp < config["min_amplitude"]
            else "ok"
        )
        out.append({
            "item_qid": qid, **mv,
            "index_value": {str(m): round(v, 3) for m, v in idx.items()},
            "index_raw": {str(m): round(ri.get(m, 1.0), 3) for m in range(1, 13)},
            "amplitude": round(amp, 2),
            "monthly_pv_mean": round(mv["monthly_pv_mean"]),
            "quality_flag": flag,
            "needs_review": needs,
        })
    return out, baseline


def main():
    parser = argparse.ArgumentParser(description="Build seasonality curve (local only)")
    parser.add_argument("--config", type=str, default="config.yml")
    parser.add_argument("--run-id", type=str, required=True)
    args = parser.parse_args()

    config = load_yaml_config(Path(__file__).parent / args.config)
    work_dir = Path(config["work_dir"])
    ensure_directory(work_dir)

    rows = read_jsonl(work_dir / f"raw_{args.run_id}.jsonl")
    if not rows:
        raise SystemExit(f"raw_{args.run_id}.jsonl が空です。1_2 を先に実行してください。")

    logger.info("=" * 80)
    logger.info("Step 1-3: Build seasonality curve")
    logger.info("=" * 80)
    logger.info(f"raw: {len(rows)} 行 / {len({r['item_qid'] for r in rows})} カテゴリ")

    kept, dropped, totals, median_total = drop_incomplete_months(
        rows, float(config["min_month_completeness_ratio"])
    )
    # 捨てた月は**必ず出す**。黙って月を捨てると後から追えなくなる
    if dropped:
        logger.warning(f"未完成とみなして除外する月: {len(dropped)} 件")
        for ym in dropped:
            logger.warning(f"  {ym}: 合計 {totals[ym]:,}（中央値比 {totals[ym]/median_total:.3f}）")
    else:
        logger.info("未完成とみなす月はありません")

    curves, baseline = build(kept, config)
    logger.info("全記事共通の季節成分（月ごとの中央値）: "
                + " ".join(f"{m}月{baseline[m]:.2f}" for m in range(1, 13)))

    write_jsonl(curves, work_dir / f"curve_{args.run_id}.jsonl", force=True)

    by_flag = defaultdict(int)
    for c in curves:
        by_flag[c["quality_flag"]] += 1
    logger.info("quality_flag の分布: " + " / ".join(f"{k} {v}件" for k, v in sorted(by_flag.items())))

    review = sorted([c for c in curves if c["needs_review"]],
                    key=lambda c: -c["amplitude"])
    for c in review:
        c["decision"] = ""
        c["reason"] = ""
    write_jsonl(review, work_dir / f"review_{args.run_id}.jsonl", force=True)

    # 人が読む用。12 か月を横に並べないと「形が変かどうか」を判断できない
    md = [f"# #737 季節曲線レビュー（run_id: {args.run_id}）", "",
          f"対象 {len(review)} 件 / 全 {len(curves)} 件中。"
          "各月の値は「その月の閲覧数 ÷ 全期間平均」を、全記事共通の季節成分で割り戻したもの。1.00 = 平常月。", "",
          "| 料理 | 記事 | " + " | ".join(f"{m}月" for m in range(1, 13)) + " | 振幅 | 月PV |",
          "|---|---|" + "---|" * 12 + "---|---|"]
    for c in review:
        cells = " | ".join(f"{c['index_value'][str(m)]:.2f}" for m in range(1, 13))
        md.append(f"| {c['item_qid']} | {c['article']} | {cells} | "
                  f"{c['amplitude']}x | {c['monthly_pv_mean']:,} |")
    (work_dir / f"review_{args.run_id}.md").write_text("\n".join(md) + "\n", encoding="utf-8")

    logger.info(f"レビュー対象: {len(review)} 件")
    logger.info(f"  全曲線     : {work_dir}/curve_{args.run_id}.jsonl")
    logger.info(f"  レビュー用 : {work_dir}/review_{args.run_id}.jsonl / .md")
    logger.info("")
    logger.info("次: review_*.jsonl の decision（approve/reject）と reason を埋めて")
    logger.info("    data/ へコミットし、2_1_load_feature_scores.py へ渡す")


if __name__ == "__main__":
    main()
