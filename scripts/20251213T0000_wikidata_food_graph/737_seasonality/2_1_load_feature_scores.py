#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
2_1_load_feature_scores.py

【目的】
#737 レビューで approve された季節曲線を、**既存の**
`wikidata_food_llm_feature_scores` へ INSERT する。

【他の特徴量フローと同じ形にしてある】
575 / 581 / 581-manual と同じ層構造:

    外部の生データ（ローカル /tmp）
      → wikidata_food_llm_feature_scores   ← ここ（このスクリプト）
      → dish_category_features_catalog     ← 581_relevance_scoring/manual/2_merge_feature_scores.py
      → PostgreSQL dish_category_features  ← 9_2_sync_dish_category_features.py

**season 専用のテーブルは 1 本も作らない。** BigQuery の migration も不要。
publish も専用スクリプトを持たず、既存の汎用 MERGE をそのまま使う:

    python3 ../581_relevance_scoring/manual/2_merge_feature_scores.py \\
      --run-id 20260825T0000 --expected-row-count 228 --dry-run

【保存される値】（LLM run と監査上区別するため偽装しない）
    task       = #737_seasonality
    phase      = pageviews
    model      = wikimedia_pageviews
    feature_type = season
    feature_key  = <region_scope>:month:MM
    score        = min(index_value, 1.0)   ※ 1.0 = 無補正
    confidence   = high / medium（振幅と PV から機械判定）
    reason       = 月指数・振幅・PV・記事名・レビュー理由

【reject したものは INSERT しない】
判断そのものは `data/review_<run_id>.jsonl`（git 管理）に残す。
BigQuery には「採用したもの」だけが入るので、汎用 MERGE がそのまま使える。

【曲線 JSONL は data/ にコミットしてある】
`--curve` を省くと `work_dir`（ローカルの /tmp）を見る。GitHub Actions
（db-script-run.yml）から流すときは 1_1〜1_3 が動いていないので、git にある
`data/curve_<run_id>.jsonl` を明示的に渡す。**BigQuery に入る 228 行は、この
ファイルと review ファイルだけから決まる**（実行環境に依存しない）。

【使用方法】
python3 2_1_load_feature_scores.py --run-id 20260825T0000 \\
  --review data/review_20260825T0000.jsonl \\
  --curve data/curve_20260825T0000.jsonl --dry-run
"""

import argparse
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lib.io import load_yaml_config, read_jsonl

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

SCORES_TABLE = "food-scroll.wikidata_food_graph.wikidata_food_llm_feature_scores"
PHASE = "pageviews"
MODEL = "wikimedia_pageviews"
VALID_DECISIONS = {"approve", "reject"}


def main():
    parser = argparse.ArgumentParser(description="Load season feature scores")
    parser.add_argument("--config", type=str, default="config.yml")
    parser.add_argument("--run-id", type=str, required=True)
    parser.add_argument("--review", type=str, required=True, help="判断済みの review JSONL")
    parser.add_argument(
        "--curve", type=str, default=None,
        help="曲線 JSONL。省略時は work_dir/curve_<run_id>.jsonl（CI では data/ 配下を指定する）",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    config = load_yaml_config(Path(__file__).parent / args.config)
    region_scope = config["region_scope"]
    work_dir = Path(config["work_dir"])

    curve_path = Path(args.curve) if args.curve else work_dir / f"curve_{args.run_id}.jsonl"
    curves = {c["item_qid"]: c for c in read_jsonl(curve_path)}
    if not curves:
        raise SystemExit(f"{curve_path} が空です。1_3 を先に実行するか --curve を指定してください。")

    reviews = read_jsonl(Path(args.review))
    logger.info("=" * 80)
    logger.info("Step 2-1: Load season feature scores")
    logger.info("=" * 80)
    logger.info(f"run_id: {args.run_id} / region_scope: {region_scope} / レビュー {len(reviews)} 件")
    logger.info(f"curve: {curve_path}（{len(curves)} カテゴリ）")

    # ── validation。1 件でも駄目なら 1 行も入れない ──
    errors = []
    approved = []
    for i, r in enumerate(reviews, 1):
        qid = (r.get("item_qid") or "").strip()
        decision = (r.get("decision") or "").strip()
        reason = (r.get("reason") or "").strip()
        if not qid:
            errors.append(f"{i} 行目: item_qid が空")
            continue
        if qid not in curves:
            errors.append(f"{i} 行目: {qid} は {curve_path.name} に存在しない")
        if decision not in VALID_DECISIONS:
            errors.append(f"{i} 行目: {qid} の decision が不正（'{decision}'）")
        if not reason:
            errors.append(f"{i} 行目: {qid} の reason が空。理由の無い判断は受け付けません")
        if decision == "approve":
            approved.append((qid, reason))

    if errors:
        logger.error(f"validation エラー {len(errors)} 件。1 行も投入しません:")
        for e in errors[:30]:
            logger.error(f"  - {e}")
        raise SystemExit(1)

    if not approved:
        raise SystemExit("approve が 1 件もありません（空の run を作らないため中断します）")

    now = datetime.now(timezone.utc).isoformat()
    rows = []
    for qid, reason in approved:
        c = curves[qid]
        for m in range(1, 13):
            idx = c["index_value"][str(m)]
            rows.append({
                "item_qid": qid,
                "task": config["task"],
                "feature_type": "season",
                "feature_key": f"{region_scope}:month:{m:02d}",
                # 1.0 が「無補正」。1 を超える押し上げはしない（夏物の押し上げは旬枠でやる）
                "score": min(idx, 1.0),
                "confidence": "high" if c["monthly_pv_mean"] >= 1000 else "medium",
                "reason": (f"{m}月指数 {idx:.2f} / 振幅 {c['amplitude']}x / "
                           f"月{c['monthly_pv_mean']:,}PV / 記事:{c['article']} / {reason}")[:1000],
                "model": MODEL,
                "run_id": args.run_id,
                "phase": PHASE,
                "created_at": now,
            })

    logger.info(f"投入対象: {len(approved)} カテゴリ × 12 か月 = {len(rows)} 行")
    for qid, _ in approved:
        c = curves[qid]
        logger.info(f"  {qid:<12} {c['article']:<12} "
                    f"8月{c['index_value']['8']:.2f} 12月{c['index_value']['12']:.2f} "
                    f"振幅{c['amplitude']}x")

    if args.dry_run:
        logger.info("Dry run: BigQuery へは入れない")
        return

    # BigQuery の import はここまで遅延させる。
    # --dry-run は資格情報も google-cloud-bigquery も無い環境で動く必要がある
    # （レビュー内容の確認は CI やローカルでもできるべきなので）。
    from google.cloud import bigquery

    client = bigquery.Client(project="food-scroll")
    # load_table_from_json ではなく insert_rows_json を使う（581-manual と同じ）。
    # load job はスキーマを自動検出して全列を NULLABLE と推定するため、
    # REQUIRED 列を持つこのテーブルに対して必ず落ちる（実測 run 32998467068:
    # "Field model has changed mode from REQUIRED to NULLABLE"）。
    # insert_rows_json は既存スキーマをそのまま使うのでこの問題が起きない。
    errors = client.insert_rows_json(SCORES_TABLE, rows)
    if errors:
        raise RuntimeError(f"insert_rows_json returned errors: {errors[:5]}")
    logger.info(f"{len(rows)} 行を append しました: {SCORES_TABLE}")
    logger.info("=" * 80)
    logger.info("✅ Step 2-1 completed")
    logger.info("")
    logger.info("次: 既存の汎用 MERGE で catalog へ（★オーナー承認が要る）")
    logger.info(f"  ../581_relevance_scoring/manual/2_merge_feature_scores.py \\")
    logger.info(f"    --run-id {args.run_id} --expected-row-count {len(rows)} --dry-run")


if __name__ == "__main__":
    main()
