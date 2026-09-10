#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_2_fetch_pageviews.py

【目的】
#737 Wikimedia Analytics API から月次ページビューを取り、ローカル JSONL へ書く

【処理内容】
1. 1_1 の input.jsonl を読む
2. 1 記事ずつ API を叩き、取れたものを逐次ローカルへ書く（**中断しても再開できる**）

【BigQuery へは書かない】
生の月次 PV は**ローカル JSONL に置くだけ**にする。既存の LLM パイプライン
（575 / 581）も、Batch API の生レスポンスは `results_dir`（ローカル）に置き、
構造化した結果だけを BigQuery へ入れている。それと同じ層構造に揃えた。

生データを BigQuery に残さない代わりに、再現性は
「スクリプト＋run_id＋Wikimedia が CC0 で誰でも再取得できること」で担保する。
取り直しは実測 8 分（`--resume` で途中から再開できる）。

【なぜ逐次でローカルへ書くのか】
実測で 134 件に 8 分かかる（レート制限のため 1 件あたり 1.3 秒以上のウェイトが要る）。
途中で落ちたときに最初からやり直すと、その分だけ Wikimedia に余計な負荷をかける。
`--resume` で既に取れている記事を飛ばせるようにしてある。

【使用方法】
python3 1_2_fetch_pageviews.py --run-id 20260825T0000
python3 1_2_fetch_pageviews.py --run-id 20260825T0000 --resume   # 中断から再開
python3 1_2_fetch_pageviews.py --run-id 20260825T0000 --limit 5  # 動作確認用
"""

import argparse
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lib.io import ensure_directory, load_yaml_config, read_jsonl, write_jsonl
from lib.pageviews import PageviewsClient

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(description="Fetch monthly pageviews")
    parser.add_argument("--config", type=str, default="config.yml")
    parser.add_argument("--run-id", type=str, required=True)
    parser.add_argument("--resume", action="store_true", help="取得済みの記事を飛ばす")
    parser.add_argument("--limit", type=int, default=None, help="先頭 N 件だけ処理する")
    args = parser.parse_args()

    config = load_yaml_config(Path(__file__).parent / args.config)
    work_dir = Path(config["work_dir"])
    ensure_directory(work_dir)

    items = read_jsonl(work_dir / "input.jsonl")
    if args.limit:
        items = items[: args.limit]

    raw_path = work_dir / f"raw_{args.run_id}.jsonl"
    fetched = read_jsonl(raw_path) if (args.resume and raw_path.exists()) else []
    done_qids = {r["item_qid"] for r in fetched}

    logger.info("=" * 80)
    logger.info("Step 1-2: Fetch pageviews")
    logger.info("=" * 80)
    logger.info(f"run_id: {args.run_id} / 対象 {len(items)} 件 / 取得済み {len(done_qids)} 件")
    logger.info(f"期間: {config['start_ym']} 〜 {config['end_ym']}")

    client = PageviewsClient(
        user_agent=config["user_agent"],
        sleep_sec=float(config["sleep_sec"]),
        max_retries=int(config["max_retries"]),
    )

    now = datetime.now(timezone.utc).isoformat()
    rows = list(fetched)
    not_found = []

    for i, item in enumerate(items, 1):
        # ⚠️ 進捗ログは **ループの先頭**に置く。`continue` の後ろへ置くと
        #    «最後まで通った件» のときしか出ない。2026-09-06 の run 34022514117 は
        #    3,000 件で 6 行しか出ず、«前半 1,350 件で parsed が 1» を «前半が異常» と
        #    読み違える原因になった（実際は普通の並びだった）。
        if (i - 1) % 20 == 0 and i > 1:
            logger.info(f"  ...{i - 1}/{len(items)} 件（累計 {len(rows)} 行）")
        if item["item_qid"] in done_qids:
            continue

        monthly = client.fetch_monthly(
            wiki=item["wiki"],
            article=item["article"],
            start_ym=config["start_ym"],
            end_ym=config["end_ym"],
        )

        if monthly is None:
            # 記事が無い。**黙って飛ばさない**（後で「なぜ season が付かないのか」を追えるように）
            not_found.append(f"{item['item_qid']}({item['label_ja'] or item['label_en']})")
            continue

        for m in monthly:
            rows.append(
                {
                    "item_qid": item["item_qid"],
                    "wiki": item["wiki"],
                    "article": item["article"],
                    "ym": m["ym"],
                    "views": m["views"],
                    "source": "wikimedia_pageviews",
                    "run_id": args.run_id,
                    "fetched_at": now,
                }
            )

        # 1 件ごとに書き出す（中断しても --resume で続きから）
        write_jsonl(rows, raw_path, force=True)


    logger.info(f"取得完了: {len(rows)} 行 / 記事が見つからなかったもの {len(not_found)} 件")
    if not_found:
        logger.warning("記事なし: " + ", ".join(not_found))
        logger.warning(
            "→ これらは season の行が作られない（＝補正係数 1.0 で無影響）。"
            "夏物・冬物が含まれていないかレビューの前に確認すること。"
        )

    logger.info(f"出力: {raw_path}")
    logger.info("=" * 80)
    logger.info("✅ Step 1-2 completed")
    logger.info("")
    logger.info("次: 1_3_build_curve.py --run-id <run_id>")


if __name__ == "__main__":
    main()
