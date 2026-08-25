#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
io.py

【目的】
ファイル I/O ユーティリティ（#737 seasonality 用。#575 からの複製）

【機能】
- JSONL 読み書き
- 部分再開対応
- ファイル存在確認
"""

import json
import logging
from pathlib import Path
from typing import List, Dict, Optional, Any

logger = logging.getLogger(__name__)


def read_jsonl(file_path: Path) -> List[Dict]:
    """
    JSONL ファイルを読み込む
    
    Args:
        file_path: JSONL ファイルパス
        
    Returns:
        辞書のリスト
    """
    if not file_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")
    
    items = []
    with open(file_path, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
                items.append(item)
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse line {line_num}: {e}")
                continue
    
    logger.info(f"Read {len(items)} items from {file_path}")
    return items


def write_jsonl(items: List[Dict], file_path: Path, force: bool = False) -> int:
    """
    辞書のリストを JSONL ファイルに書き込む
    
    Args:
        items: 辞書のリスト
        file_path: 出力先ファイルパス
        force: 既存ファイルを上書きするか
        
    Returns:
        書き込んだ行数
    """
    if file_path.exists() and not force:
        logger.warning(f"File already exists (use --force to overwrite): {file_path}")
        return 0
    
    file_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(file_path, 'w', encoding='utf-8') as f:
        for item in items:
            f.write(json.dumps(item, ensure_ascii=False) + '\n')
    
    logger.info(f"Wrote {len(items)} items to {file_path}")
    return len(items)


def file_exists_or_skip(file_path: Path, force: bool = False) -> bool:
    """
    ファイルが存在する場合はスキップするかどうかを判定
    
    Args:
        file_path: ファイルパス
        force: 強制実行フラグ
        
    Returns:
        True: スキップする（既存ファイルあり＆force=False）
        False: 実行する（ファイルなし or force=True）
    """
    if file_path.exists() and not force:
        logger.info(f"File already exists, skipping: {file_path}")
        return True
    return False


def ensure_directory(dir_path: Path) -> None:
    """
    ディレクトリが存在しない場合は作成
    
    Args:
        dir_path: ディレクトリパス
    """
    dir_path.mkdir(parents=True, exist_ok=True)
    logger.debug(f"Ensured directory: {dir_path}")


def load_yaml_config(config_path: Path) -> Dict[str, Any]:
    """
    YAML 設定ファイルを読み込む
    
    Args:
        config_path: 設定ファイルパス
        
    Returns:
        設定辞書
    """
    import yaml
    
    if not config_path.exists():
        raise FileNotFoundError(f"Config file not found: {config_path}")
    
    with open(config_path, 'r', encoding='utf-8') as f:
        config = yaml.safe_load(f)
    
    logger.info(f"Loaded config from {config_path}")
    return config


def save_json(data: Any, file_path: Path, indent: int = 2) -> None:
    """
    データを JSON ファイルに保存
    
    Args:
        data: 保存するデータ
        file_path: 出力先ファイルパス
        indent: インデント幅
    """
    file_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(file_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=indent)
    
    logger.info(f"Saved JSON to {file_path}")


def load_json(file_path: Path) -> Any:
    """
    JSON ファイルを読み込む
    
    Args:
        file_path: JSON ファイルパス
        
    Returns:
        パースされたデータ
    """
    if not file_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")
    
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    logger.info(f"Loaded JSON from {file_path}")
    return data
