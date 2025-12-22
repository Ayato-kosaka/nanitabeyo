#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
#581 【設計】ファイル I/O ライブラリ

JSONL 読み書き、ディレクトリ作成などを担当
"""

import json
import logging
from pathlib import Path
from typing import List, Dict

logger = logging.getLogger(__name__)


def ensure_dir(path: Path) -> None:
    """
    ディレクトリを作成（存在しない場合）
    
    Args:
        path: ディレクトリパス
    """
    path.mkdir(parents=True, exist_ok=True)
    logger.debug(f"Ensured directory: {path}")


def write_jsonl(filepath: Path, items: List[Dict]) -> None:
    """
    JSONL ファイルに書き込み
    
    Args:
        filepath: ファイルパス
        items: 書き込むアイテムのリスト
    """
    logger.info(f"Writing {len(items)} items to {filepath}")
    
    with open(filepath, 'w', encoding='utf-8') as f:
        for item in items:
            f.write(json.dumps(item, ensure_ascii=False) + '\n')
    
    logger.info(f"Successfully wrote {len(items)} items")


def read_jsonl(filepath: Path) -> List[Dict]:
    """
    JSONL ファイルを読み込み
    
    Args:
        filepath: ファイルパス
        
    Returns:
        アイテムのリスト
    """
    logger.info(f"Reading items from {filepath}")
    
    items = []
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                items.append(json.loads(line))
    
    logger.info(f"Read {len(items)} items")
    return items


def write_json(filepath: Path, data: Dict) -> None:
    """
    JSON ファイルに書き込み
    
    Args:
        filepath: ファイルパス
        data: 書き込むデータ
    """
    logger.info(f"Writing data to {filepath}")
    
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    logger.info(f"Successfully wrote data")


def read_json(filepath: Path) -> Dict:
    """
    JSON ファイルを読み込み
    
    Args:
        filepath: ファイルパス
        
    Returns:
        データ辞書
    """
    logger.info(f"Reading data from {filepath}")
    
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    logger.info(f"Successfully read data")
    return data


def read_text(filepath: Path) -> str:
    """
    テキストファイルを読み込み
    
    Args:
        filepath: ファイルパス
        
    Returns:
        テキスト内容
    """
    with open(filepath, 'r', encoding='utf-8') as f:
        return f.read().strip()


def write_text(filepath: Path, text: str) -> None:
    """
    テキストファイルに書き込み
    
    Args:
        filepath: ファイルパス
        text: テキスト内容
    """
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(text)
