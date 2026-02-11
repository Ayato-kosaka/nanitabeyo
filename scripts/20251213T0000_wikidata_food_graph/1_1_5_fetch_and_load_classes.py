#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_1_5_fetch_and_load_classes.py

#745 【目的】
Wikidata から P279* クラス閉包を取得し、food_class_closure テーブルに保存する

【処理内容】
1. BigQuery の food_roots テーブルから root 定義を取得
2. 各 root について P279* でクラス閉包を取得
   - SPARQL クエリ: ?class wdt:P279* ?root
   - クラス階層のみを対象とするため、インスタンス数より遥かに少ない
3. 結果を food_class_closure テーブルに Load Job でロード
4. 検証：代表的なクラスが含まれているか確認

【使用方法】
# 全件取得（推奨）
python3 1_1_5_fetch_and_load_classes.py

# デバッグ用（depth 制限）
python3 1_1_5_fetch_and_load_classes.py --max-depth 5

【注意】
- この処理は 1_2_fetch_and_load_nodes.py の前に実行する必要がある
- クラス数は数百〜数千程度なので、処理時間は短い（数分程度）
- 更新頻度は低い（root 変更時、Wikidata 構造変更時のみ）
"""

import sys
import json
import logging
import argparse
from pathlib import Path
from typing import Dict, List, Set, Tuple

from wikidata_client import WikidataClient
from loader_bigquery import BigQueryLoader

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 固定値
GCP_PROJECT = "food-scroll"
BQ_DATASET = "wikidata_food_graph"

# 一時ファイル保存先
TEMP_DIR = Path("/tmp/wikidata_food_graph")
CLASSES_FILE = TEMP_DIR / "classes.jsonl"

# #745 【設計】検証用：代表的なクラス QID（cake, ice cream, wine, soup など）
EXPECTED_CLASSES = {
    "Q13276",   # cake
    "Q13233",   # ice cream
    "Q282",     # wine
    "Q41415",   # soup
    "Q44541",   # pancake
    "Q20129",   # omelette
}


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(
        description="Fetch and load Wikidata class closure (P279*)"
    )
    parser.add_argument(
        "--max-depth",
        type=int,
        default=None,
        help="Maximum depth for P279* traversal (for debugging, None for unlimited)"
    )
    parser.add_argument(
        "--keep-temp",
        action="store_true",
        help="Keep temporary files after completion (for debugging)"
    )
    args = parser.parse_args()
    
    logger.info("=" * 80)
    logger.info("Step 1.5: Fetching and loading class closure from Wikidata")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    if args.max_depth:
        logger.info(f"Max depth: {args.max_depth}")
    
    # 一時ディレクトリ作成
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    
    # Wikidata クライアント初期化
    wikidata_client = WikidataClient()
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # #745 【設計】food_roots テーブルから root 定義を取得
    logger.info("=" * 80)
    logger.info("Phase 0: Fetching food roots from BigQuery")
    logger.info("=" * 80)
    
    try:
        food_roots = bq_loader.fetch_food_roots()
        if not food_roots:
            logger.error("No food roots found in BigQuery")
            sys.exit(1)
        logger.info(f"Loaded {len(food_roots)} food roots from BigQuery")
    except Exception as e:
        logger.error(f"Failed to fetch food roots: {e}")
        sys.exit(1)
    
    # #745 【設計】1. root単位でクラス閉包を取得
    logger.info("=" * 80)
    logger.info("Phase 1: Fetching class closure per root")
    logger.info("=" * 80)
    
    all_classes: List[Dict] = []
    seen_class_root_pairs: Set[Tuple[str, str]] = set()
    
    for root_qid, root_kind in food_roots:
        logger.info("-" * 80)
        logger.info(f"Processing root: {root_qid} ({root_kind})")
        logger.info("-" * 80)
        
        try:
            classes = wikidata_client.fetch_class_closure(
                root_qid,
                max_depth=args.max_depth
            )
            
            if not classes:
                logger.warning(f"No classes fetched for root {root_qid}")
                continue
            
            logger.info(f"Fetched {len(classes)} classes for root {root_qid}")
            
            # #745 【設計】重複排除（同じクラスが複数の root に属する可能性がある）
            for class_item in classes:
                class_qid = class_item["class_qid"]
                depth = class_item["depth"]
                pair = (class_qid, root_qid)
                
                if pair not in seen_class_root_pairs:
                    all_classes.append({
                        "class_qid": class_qid,
                        "root_qid": root_qid,
                        "kind": root_kind,
                        "depth": depth
                    })
                    seen_class_root_pairs.add(pair)
            
            logger.info(f"Total unique (class, root) pairs so far: {len(all_classes)}")
        
        except Exception as e:
            logger.error(f"Failed to fetch classes for root {root_qid}: {e}")
            logger.error("Aborting because class fetch failed")
            sys.exit(1)
    
    if not all_classes:
        logger.error("No classes fetched from any root")
        sys.exit(1)
    
    logger.info("=" * 80)
    logger.info(f"Phase 1 completed: {len(all_classes)} unique (class, root) pairs fetched")
    logger.info("=" * 80)
    
    # #745 【設計】一時ファイルに保存（デバッグ用）
    with open(CLASSES_FILE, 'w', encoding='utf-8') as f:
        for class_item in all_classes:
            f.write(json.dumps(class_item, ensure_ascii=False) + '\n')
    logger.info(f"Saved classes to {CLASSES_FILE}")
    
    # #745 【設計】2. BigQuery にクラス閉包をロード
    logger.info("=" * 80)
    logger.info("Phase 2: Loading classes to BigQuery")
    logger.info("=" * 80)
    
    try:
        bq_loader.load_food_class_closure(all_classes)
        logger.info("Classes loaded to food_class_closure successfully")
    except Exception as e:
        logger.error(f"Failed to load classes: {e}")
        sys.exit(1)
    
    # #745 【設計】3. 検証：代表的なクラスが含まれているか確認
    logger.info("=" * 80)
    logger.info("Phase 3: Validation")
    logger.info("=" * 80)
    
    class_qids = {item["class_qid"] for item in all_classes}
    found_expected = EXPECTED_CLASSES & class_qids
    missing_expected = EXPECTED_CLASSES - class_qids
    
    logger.info(f"Expected classes found: {len(found_expected)}/{len(EXPECTED_CLASSES)}")
    if found_expected:
        logger.info(f"  Found: {sorted(found_expected)}")
    if missing_expected:
        logger.warning(f"  Missing: {sorted(missing_expected)}")
    
    # 統計情報
    unique_classes = len(class_qids)
    unique_roots = len({item["root_qid"] for item in all_classes})
    logger.info(f"Statistics:")
    logger.info(f"  - Unique classes: {unique_classes}")
    logger.info(f"  - Unique roots: {unique_roots}")
    logger.info(f"  - Total (class, root) pairs: {len(all_classes)}")
    
    # #745 【設計】depth 分布
    depth_counts: Dict[int, int] = {}
    for item in all_classes:
        depth = item["depth"]
        depth_counts[depth] = depth_counts.get(depth, 0) + 1
    
    logger.info(f"  - Depth distribution:")
    for depth in sorted(depth_counts.keys()):
        logger.info(f"      depth={depth}: {depth_counts[depth]} pairs")
    
    # 一時ファイルのクリーンアップ
    if not args.keep_temp:
        logger.info("Cleaning up temporary files...")
        CLASSES_FILE.unlink()
        logger.info("Temporary files cleaned up")
    else:
        logger.info(f"Temporary files kept: {CLASSES_FILE}")
    
    logger.info("=" * 80)
    logger.info("✅ Step 1.5 completed successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Summary:")
    logger.info(f"  - Total unique classes: {unique_classes}")
    logger.info(f"  - Total (class, root) pairs: {len(all_classes)}")
    logger.info(f"  - Expected classes found: {len(found_expected)}/{len(EXPECTED_CLASSES)}")
    logger.info("")
    logger.info("Next step:")
    logger.info("  python3 1_2_fetch_and_load_nodes.py")


if __name__ == "__main__":
    main()
