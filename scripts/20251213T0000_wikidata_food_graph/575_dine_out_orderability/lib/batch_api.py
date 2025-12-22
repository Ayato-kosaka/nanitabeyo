#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
batch_api.py

【目的】
OpenAI Batch API 操作ライブラリ（#572 market_salience 用）

【機能】
- バッチジョブ作成・投入
- ジョブステータスのポーリング
- 結果のダウンロード
"""

import time
import json
import logging
from pathlib import Path
from typing import Optional, Dict, Any
import requests

logger = logging.getLogger(__name__)


class BatchAPIClient:
    """OpenAI Batch API クライアント"""
    
    def __init__(self, api_key: str):
        """
        Args:
            api_key: OpenAI API キー
        """
        self.api_key = api_key
        self.base_url = "https://api.openai.com/v1"
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        logger.info("BatchAPIClient initialized")
    
    def upload_file(self, file_path: Path) -> str:
        """
        Batch API 用ファイルをアップロード
        
        Args:
            file_path: アップロードするファイルパス
            
        Returns:
            file_id
        """
        url = f"{self.base_url}/files"
        
        with open(file_path, 'rb') as f:
            files = {
                'file': (file_path.name, f, 'application/jsonl'),
                'purpose': (None, 'batch')
            }
            headers = {"Authorization": f"Bearer {self.api_key}"}
            
            logger.info(f"Uploading file: {file_path}")
            response = requests.post(url, headers=headers, files=files)
            response.raise_for_status()
        
        file_data = response.json()
        file_id = file_data['id']
        
        logger.info(f"File uploaded: {file_id}")
        return file_id
    
    def create_batch(
        self,
        input_file_id: str,
        metadata: Optional[Dict[str, str]] = None
    ) -> str:
        """
        バッチジョブを作成
        
        Args:
            input_file_id: アップロード済みファイルID
            metadata: メタデータ（task, run_id 等）
            
        Returns:
            batch_id
        """
        url = f"{self.base_url}/batches"
        
        payload = {
            "input_file_id": input_file_id,
            "endpoint": "/v1/chat/completions",
            "completion_window": "24h"
        }
        
        if metadata:
            payload["metadata"] = metadata
        
        logger.info(f"Creating batch with file_id={input_file_id}")
        response = requests.post(url, headers=self.headers, json=payload)
        response.raise_for_status()
        
        batch_data = response.json()
        batch_id = batch_data['id']
        
        logger.info(f"Batch created: {batch_id}")
        return batch_id
    
    def get_batch_status(self, batch_id: str) -> Dict[str, Any]:
        """
        バッチのステータスを取得
        
        Args:
            batch_id: バッチID
            
        Returns:
            バッチステータス情報
        """
        url = f"{self.base_url}/batches/{batch_id}"
        
        response = requests.get(url, headers=self.headers)
        response.raise_for_status()
        
        return response.json()
    
    def poll_until_complete(
        self,
        batch_id: str,
        poll_interval_sec: int = 30,
        max_wait_sec: int = 86400
    ) -> Dict[str, Any]:
        """
        バッチが完了するまでポーリング
        
        Args:
            batch_id: バッチID
            poll_interval_sec: ポーリング間隔（秒）
            max_wait_sec: 最大待機時間（秒）
            
        Returns:
            最終ステータス
        """
        logger.info(f"Polling batch {batch_id} until complete (max {max_wait_sec}s)...")
        
        start_time = time.time()
        
        while True:
            elapsed = time.time() - start_time
            if elapsed > max_wait_sec:
                raise TimeoutError(f"Batch did not complete within {max_wait_sec}s")
            
            status_data = self.get_batch_status(batch_id)
            status = status_data['status']
            
            logger.info(f"Batch status: {status} (elapsed: {int(elapsed)}s)")
            
            if status == 'completed':
                logger.info("Batch completed successfully")
                return status_data
            elif status in ['failed', 'expired', 'cancelled']:
                raise RuntimeError(f"Batch failed with status: {status}")
            elif status in ['validating', 'in_progress', 'finalizing']:
                # 継続してポーリング
                time.sleep(poll_interval_sec)
            else:
                logger.warning(f"Unknown status: {status}, continuing to poll...")
                time.sleep(poll_interval_sec)
    
    def download_results(self, file_id: str, output_path: Path) -> int:
        """
        結果ファイルをダウンロード
        
        Args:
            file_id: 結果ファイルID
            output_path: 保存先パス
            
        Returns:
            ダウンロードした行数
        """
        url = f"{self.base_url}/files/{file_id}/content"
        
        logger.info(f"Downloading results from file_id={file_id}")
        response = requests.get(url, headers=self.headers)
        response.raise_for_status()
        
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(output_path, 'wb') as f:
            f.write(response.content)
        
        # 行数をカウント
        with open(output_path, 'r', encoding='utf-8') as f:
            count = sum(1 for line in f if line.strip())
        
        logger.info(f"Downloaded {count} results to {output_path}")
        return count
    
    def submit_and_wait(
        self,
        payload_path: Path,
        metadata: Optional[Dict[str, str]] = None,
        poll_interval_sec: int = 30
    ) -> Dict[str, Any]:
        """
        ペイロードを投入してバッチが完了するまで待つ（ワンストップ処理）
        
        Args:
            payload_path: ペイロードファイルパス
            metadata: メタデータ
            poll_interval_sec: ポーリング間隔
            
        Returns:
            完了ステータス（output_file_id を含む）
        """
        # 1. ファイルアップロード
        file_id = self.upload_file(payload_path)
        
        # 2. バッチ作成
        batch_id = self.create_batch(file_id, metadata)
        
        # 3. 完了まで待機
        status_data = self.poll_until_complete(batch_id, poll_interval_sec)
        
        return status_data
