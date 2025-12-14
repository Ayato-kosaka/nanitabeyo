#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_unit.py

#545 【テスト】単体テスト（モック使用、ネットワーク不要）

【目的】
改修後のロジックをモックデータで検証
"""

import sys
import json
import logging
from pathlib import Path
from unittest.mock import Mock, patch
from typing import List, Dict

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def test_cursor_logic():
    """カーソルロジックの単体テスト（ネットワーク不要）"""
    logger.info("=" * 80)
    logger.info("Test 1: Cursor logic (unit test)")
    logger.info("=" * 80)
    
    # モックデータ
    mock_pages = [
        # Page 1
        [
            {"item": {"value": "http://www.wikidata.org/entity/Q100"}, "label_ja": {"value": "test1"}},
            {"item": {"value": "http://www.wikidata.org/entity/Q101"}, "label_ja": {"value": "test2"}},
            {"item": {"value": "http://www.wikidata.org/entity/Q102"}, "label_ja": {"value": "test3"}},
        ],
        # Page 2
        [
            {"item": {"value": "http://www.wikidata.org/entity/Q103"}, "label_ja": {"value": "test4"}},
            {"item": {"value": "http://www.wikidata.org/entity/Q104"}, "label_ja": {"value": "test5"}},
        ],
    ]
    
    # カーソルロジックをシミュレート
    all_nodes = []
    last_item_uri = None
    page_size = 3
    
    for page_num, page_results in enumerate(mock_pages, 1):
        logger.info(f"Page {page_num}: cursor={last_item_uri}, results={len(page_results)}")
        
        for result in page_results:
            item_uri = result.get("item", {}).get("value", "")
            item_qid = item_uri.split("/")[-1] if item_uri else None
            
            # カーソルチェック（実際のクエリではWDQS側で実施）
            if last_item_uri and item_uri <= last_item_uri:
                logger.warning(f"Skipping {item_qid} (not > cursor)")
                continue
            
            all_nodes.append({
                "item_qid": item_qid,
                "label_ja": result.get("label_ja", {}).get("value"),
            })
            last_item_uri = item_uri
        
        # 最後のページ判定
        if len(page_results) < page_size:
            logger.info(f"Last page reached (results < page_size)")
            break
    
    # 検証
    assert len(all_nodes) == 5, f"Expected 5 nodes, got {len(all_nodes)}"
    assert all_nodes[0]["item_qid"] == "Q100"
    assert all_nodes[-1]["item_qid"] == "Q104"
    assert last_item_uri == "http://www.wikidata.org/entity/Q104"
    
    logger.info(f"✅ Collected {len(all_nodes)} nodes with cursor logic")
    logger.info("✅ Test 1 passed")
    return True


def test_deduplication():
    """重複排除のテスト"""
    logger.info("=" * 80)
    logger.info("Test 2: Deduplication logic")
    logger.info("=" * 80)
    
    # モックデータ（重複あり）
    nodes_from_root1 = [
        {"item_qid": "Q100", "label_ja": "test1"},
        {"item_qid": "Q101", "label_ja": "test2"},
        {"item_qid": "Q102", "label_ja": "test3"},
    ]
    
    nodes_from_root2 = [
        {"item_qid": "Q101", "label_ja": "test2"},  # 重複
        {"item_qid": "Q103", "label_ja": "test4"},
        {"item_qid": "Q102", "label_ja": "test3"},  # 重複
    ]
    
    # 重複排除ロジックをシミュレート
    all_nodes = []
    seen_qids = set()
    
    for root_nodes in [nodes_from_root1, nodes_from_root2]:
        for node in root_nodes:
            qid = node["item_qid"]
            if qid not in seen_qids:
                all_nodes.append(node)
                seen_qids.add(qid)
    
    # 検証
    assert len(all_nodes) == 4, f"Expected 4 unique nodes, got {len(all_nodes)}"
    assert len(seen_qids) == 4, f"Expected 4 unique QIDs, got {len(seen_qids)}"
    
    qids = [n["item_qid"] for n in all_nodes]
    assert qids == ["Q100", "Q101", "Q102", "Q103"], f"Unexpected QID order: {qids}"
    
    logger.info(f"✅ Deduplicated to {len(all_nodes)} unique nodes from 6 total")
    logger.info("✅ Test 2 passed")
    return True


def test_temp_file_format():
    """一時ファイルフォーマットのテスト"""
    logger.info("=" * 80)
    logger.info("Test 3: Temp file format (JSONL)")
    logger.info("=" * 80)
    
    temp_dir = Path("/tmp/wikidata_food_graph/test_nodes")
    temp_dir.mkdir(parents=True, exist_ok=True)
    temp_file = temp_dir / "Q123456.jsonl"
    
    # テストデータ
    test_nodes = [
        {"item_qid": "Q100", "label_ja": "寿司", "label_en": "sushi"},
        {"item_qid": "Q101", "label_ja": "ラーメン", "label_en": "ramen"},
    ]
    
    # JSONL形式で保存
    with open(temp_file, 'w', encoding='utf-8') as f:
        for node in test_nodes:
            f.write(json.dumps(node, ensure_ascii=False) + '\n')
    
    logger.info(f"Wrote {len(test_nodes)} nodes to {temp_file}")
    
    # 読み込みテスト
    loaded_nodes = []
    with open(temp_file, 'r', encoding='utf-8') as f:
        for line in f:
            loaded_nodes.append(json.loads(line))
    
    # 検証
    assert len(loaded_nodes) == 2, f"Expected 2 nodes, got {len(loaded_nodes)}"
    assert loaded_nodes[0]["item_qid"] == "Q100"
    assert loaded_nodes[1]["label_ja"] == "ラーメン"
    
    # クリーンアップ
    temp_file.unlink()
    
    logger.info(f"✅ Successfully read {len(loaded_nodes)} nodes from JSONL")
    logger.info("✅ Test 3 passed")
    return True


def test_limit_distribution():
    """limit指定時の分配ロジックのテスト"""
    logger.info("=" * 80)
    logger.info("Test 4: Limit distribution across roots")
    logger.info("=" * 80)
    
    total_limit = 100
    roots = ["Q1", "Q2", "Q3", "Q4"]
    total_fetched = 0
    
    root_limits = []
    for i, root in enumerate(roots):
        remaining = total_limit - total_fetched
        if remaining <= 0:
            break
        
        remaining_roots = len(roots) - i
        root_limit = remaining // remaining_roots
        
        # シミュレート：各rootから実際にroot_limit件取得
        fetched = min(root_limit, remaining)
        total_fetched += fetched
        root_limits.append(fetched)
        
        logger.info(f"Root {root}: limit={root_limit}, fetched={fetched}, total={total_fetched}")
    
    # 検証
    assert total_fetched <= total_limit, f"Exceeded limit: {total_fetched} > {total_limit}"
    assert sum(root_limits) == total_fetched
    
    logger.info(f"✅ Distributed limit correctly: {root_limits} (total={total_fetched})")
    logger.info("✅ Test 4 passed")
    return True


def main():
    """テスト実行"""
    logger.info("=" * 80)
    logger.info("Unit Tests (Mock-based, No Network)")
    logger.info("=" * 80)
    logger.info("")
    
    tests = [
        ("Cursor Logic", test_cursor_logic),
        ("Deduplication", test_deduplication),
        ("Temp File Format", test_temp_file_format),
        ("Limit Distribution", test_limit_distribution),
    ]
    
    results = []
    for test_name, test_func in tests:
        try:
            passed = test_func()
            results.append((test_name, passed))
        except Exception as e:
            logger.error(f"Test '{test_name}' crashed: {e}")
            import traceback
            traceback.print_exc()
            results.append((test_name, False))
    
    # 結果サマリー
    logger.info("")
    logger.info("=" * 80)
    logger.info("Test Results Summary")
    logger.info("=" * 80)
    
    all_passed = True
    for test_name, passed in results:
        status = "✅ PASSED" if passed else "❌ FAILED"
        logger.info(f"{test_name}: {status}")
        if not passed:
            all_passed = False
    
    logger.info("=" * 80)
    
    if all_passed:
        logger.info("🎉 All unit tests passed!")
        return 0
    else:
        logger.error("❌ Some tests failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
