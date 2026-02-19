#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_2_fetch_and_load_nodes.py

【目的】
Wikidata から料理・飲み物のノード情報を取得し、BigQuery にロードする

【処理内容】
1. BigQuery の food_roots テーブルから root 定義を取得
2. Wikidata から food_roots に基づいてノードを取得
   - ?item (P31|P279)* ?root を満たすノードを対象
   - ラベル（日本語・英語）と説明を取得
   - root単位の一時ファイル保存先 TODO: 将来的に再開処理で利用することを想定
3. BigQuery の food_nodes_raw_staging に Load Job でロード
4. staging から food_nodes_raw へ MERGE（累積運用）
5. 親子エッジ（P31, P279）を取得
6. 一時ファイルにエッジデータを保存（次のステップで使用）

【使用方法】
# 全件取得（時間がかかる）
python3 1_2_fetch_and_load_nodes.py

# ノード数を制限（開発・テスト用）
python3 1_2_fetch_and_load_nodes.py --limit 1000

# 一時ファイルを保持（デバッグ用）
python3 1_2_fetch_and_load_nodes.py --keep-temp

【注意】
- SPARQL endpoint への大量リクエストが発生するため、実行には時間がかかる
- rate limit 対策として retry/backoff が実装されている
"""

import sys
import json
import logging
import argparse
from pathlib import Path
from typing import Dict, List, Set

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

# #741 【設計】staging と Python 側の件数乖離の許容閾値（5%）
STAGING_DISCREPANCY_THRESHOLD = 0.05

# 一時ファイル保存先
TEMP_DIR = Path("/tmp/wikidata_food_graph")
NODES_TEMP_DIR = TEMP_DIR / "nodes"  # #545 【設計】root単位の一時ファイル保存先
EDGES_FILE = TEMP_DIR / "edges.json"
NEW_QIDS_FILE = TEMP_DIR / "new_qids.jsonl"  # #741 【設計】今回新規に追加されるQIDのリスト


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Fetch and load Wikidata food nodes")
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit the number of nodes to fetch (for development)"
    )
    parser.add_argument(
        "--keep-temp",
        action="store_true",
        help="Keep temporary files after completion (for debugging)"
    )
    args = parser.parse_args()
    
    logger.info("=" * 80)
    logger.info("Step 2: Fetching and loading nodes from Wikidata")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    if args.limit:
        logger.info(f"Limit: {args.limit} nodes (across all roots)")
    
    # 一時ディレクトリ作成
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    NODES_TEMP_DIR.mkdir(parents=True, exist_ok=True)
    
    # Wikidata クライアント初期化
    wikidata_client = WikidataClient()
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # #741 【設計】food_roots テーブルから root 定義を取得
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
    
    # #545 【設計】1. root単位でノードを取得し、一時ファイルに保存
    logger.info("=" * 80)
    logger.info("Phase 1: Fetching nodes per root")
    logger.info("=" * 80)
    
    all_nodes: List[Dict] = []
    seen_qids: Set[str] = set()
    total_fetched = 0
    
    for root_index, (root_qid, root_kind) in enumerate(food_roots):
        logger.info("-" * 80)
        logger.info(f"Processing root: {root_qid} ({root_kind})")
        logger.info("-" * 80)
        
        temp_file = NODES_TEMP_DIR / f"{root_qid}.jsonl"
        
        # #545 【設計】limit指定時は各rootに均等割り当て
        root_limit = None
        if args.limit:
            remaining = args.limit - total_fetched
            if remaining <= 0:
                logger.info(f"Limit reached ({args.limit}), skipping remaining roots")
                break
            # 残りのrootで均等割り当て（簡易版）
            remaining_roots = len(food_roots) - root_index
            if remaining_roots <= 1:
                # 最後の root は残りを全部
                root_limit = remaining
            else:
                # シンプル均等割り（最低 1）
                root_limit = max(1, remaining // remaining_roots)

            logger.info(f"Root limit for {root_qid}: {root_limit}")
        
        try:
            nodes = wikidata_client.fetch_food_nodes([root_qid], limit=root_limit)
            
            if not nodes:
                logger.warning(f"No nodes fetched for root {root_qid}")
                continue
            
            # #545 【設計】一時ファイルに保存（JSONL形式）
            with open(temp_file, 'w', encoding='utf-8') as f:
                for node in nodes:
                    f.write(json.dumps(node, ensure_ascii=False) + '\n')
            
            logger.info(f"Saved {len(nodes)} nodes to {temp_file}")
            
            # #545 【設計】メモリ上でも保持し、item_qid単位で重複排除
            for node in nodes:
                qid = node["item_qid"]
                if qid not in seen_qids:
                    all_nodes.append(node)
                    seen_qids.add(qid)
            
            total_fetched = len(all_nodes)
            logger.info(f"Total unique nodes so far: {total_fetched}")

        except Exception as e:
            logger.error(f"Failed to fetch nodes for root {root_qid}: {e}")
            logger.error("Aborting because root fetch failed")
            sys.exit(1)

    
    if not all_nodes:
        logger.error("No nodes fetched from any root")
        sys.exit(1)
    
    logger.info("=" * 80)
    logger.info(f"Phase 1 completed: {len(all_nodes)} unique nodes fetched")
    logger.info("=" * 80)
    
    # #741 【設計】2. BigQuery staging にノードデータをロード（Load Job）
    logger.info("=" * 80)
    logger.info("Phase 2: Loading nodes to BigQuery staging")
    logger.info("=" * 80)
    
    try:
        bq_loader.load_food_nodes_to_staging(all_nodes)
        logger.info("Nodes loaded to staging successfully")
    except Exception as e:
        logger.error(f"Failed to load nodes to staging: {e}")
        sys.exit(1)
    
    # #741 【設計】整合チェック: staging の統計情報を取得
    logger.info("=" * 80)
    logger.info("Phase 2.5: Validating staging data")
    logger.info("=" * 80)
    
    try:
        staging_summary = bq_loader.get_staging_summary()
        logger.info(f"Staging summary:")
        logger.info(f"  - Distinct QIDs: {staging_summary['distinct_qids']}")
        logger.info(f"  - Total rows: {staging_summary['total_rows']}")
        logger.info(f"  - Label EN null rate: {staging_summary.get('label_en_null_rate', 0):.2%}")
        logger.info(f"  - Label JA null rate: {staging_summary.get('label_ja_null_rate', 0):.2%}")
        
        # #741 【設計】fail fast: staging が空または Python と大きく乖離
        if staging_summary['distinct_qids'] == 0:
            logger.error("CRITICAL: Staging is empty after load!")
            sys.exit(1)
        
        python_count = len(all_nodes)
        staging_count = staging_summary['distinct_qids']
        discrepancy = abs(python_count - staging_count) / python_count if python_count > 0 else 0
        
        if discrepancy > STAGING_DISCREPANCY_THRESHOLD:
            logger.warning(f"WARNING: Discrepancy between Python ({python_count}) and staging ({staging_count}): {discrepancy:.2%}")
        else:
            logger.info(f"Integrity check passed: Python ({python_count}) vs staging ({staging_count})")
            
    except Exception as e:
        logger.error(f"Failed to validate staging: {e}")
        sys.exit(1)
    
    # #741 【設計】Phase 2.7: 新規QIDをファイルに書き出し（MERGE前）
    logger.info("=" * 80)
    logger.info("Phase 2.7: Extracting new QIDs before MERGE")
    logger.info("=" * 80)
    
    try:
        new_qids_iter = bq_loader.iter_new_qids_in_staging()
        new_qids_count = 0
        
        with open(NEW_QIDS_FILE, "w", encoding="utf-8") as f:
            for qid in new_qids_iter:
                f.write(qid + "\n")
                new_qids_count += 1
        
        logger.info(f"Saved new QIDs list: {NEW_QIDS_FILE} ({new_qids_count} QIDs)")
        
        if new_qids_count == 0:
            logger.warning("No new QIDs to add (all QIDs already exist in raw)")
        
    except Exception as e:
        logger.error(f"Failed to extract new QIDs: {e}")
        sys.exit(1)
    
    # #741 【設計】3. staging → food_nodes_raw に MERGE
    logger.info("=" * 80)
    logger.info("Phase 3: Merging nodes from staging to raw")
    logger.info("=" * 80)
    
    try:
        merge_result = bq_loader.merge_food_nodes_from_staging()
        logger.info(f"MERGE completed:")
        logger.info(f"  - Before: {merge_result['before_count']} distinct QIDs")
        logger.info(f"  - After: {merge_result['after_count']} distinct QIDs")
        logger.info(f"  - New QIDs (from pre-MERGE extraction): {new_qids_count}")
        logger.info(f"  - Affected rows: {merge_result['affected_rows']}")
        
        # #741 【設計】整合チェック: 事前抽出した新規QID数とMERGE後の増加が一致するか
        actual_increase = merge_result['after_count'] - merge_result['before_count']
        if actual_increase != new_qids_count:
            logger.warning(f"WARNING: New QID count mismatch: pre-MERGE extraction={new_qids_count}, actual increase={actual_increase}")
    except Exception as e:
        logger.error(f"Failed to merge nodes: {e}")
        sys.exit(1)
    
    # 4. 親子エッジを取得
    logger.info("=" * 80)
    logger.info("Phase 4: Fetching parent edges")
    logger.info("=" * 80)
    node_qids = [node["item_qid"] for node in all_nodes]
    edges = wikidata_client.fetch_parent_edges(node_qids)
    
    if not edges:
        logger.warning("No edges fetched from Wikidata")
    else:
        logger.info(f"Fetched {len(edges)} edges")
    
    # 5. エッジデータを一時ファイルに保存
    # #545 【設計】edges.jsonのフォーマットは変更しない（1_3との互換性維持）
    logger.info(f"Saving edges to {EDGES_FILE}...")
    with open(EDGES_FILE, 'w') as f:
        json.dump(edges, f)
    logger.info("Edges saved successfully")
    
    # 6. 一時ファイルのクリーンアップ
    if not args.keep_temp:
        logger.info("Cleaning up temporary node files...")
        for temp_file in NODES_TEMP_DIR.glob("*.jsonl"):
            temp_file.unlink()
            logger.debug(f"Deleted {temp_file}")
        logger.info("Temporary node files cleaned up")
        logger.info(f"Kept: {EDGES_FILE}, {NEW_QIDS_FILE}")
    else:
        logger.info(f"Temporary files kept in {NODES_TEMP_DIR}")
        logger.info(f"Also kept: {EDGES_FILE}, {NEW_QIDS_FILE}")
    
    logger.info("=" * 80)
    logger.info("✅ Step 2 completed successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info(f"Summary:")
    logger.info(f"  - Total unique nodes fetched: {len(all_nodes)}")
    logger.info(f"  - BigQuery raw table: {merge_result['after_count']} distinct QIDs")
    logger.info(f"  - New QIDs added: {new_qids_count}")
    logger.info(f"  - New QIDs list saved to: {NEW_QIDS_FILE}")
    logger.info(f"  - Total edges: {len(edges)}")
    logger.info(f"  - Temporary files: {'kept' if args.keep_temp else 'deleted'}")
    logger.info("")
    logger.info("Next step:")
    logger.info("  python3 1_3_generate_paths_and_summary.py")


if __name__ == "__main__":
    main()
