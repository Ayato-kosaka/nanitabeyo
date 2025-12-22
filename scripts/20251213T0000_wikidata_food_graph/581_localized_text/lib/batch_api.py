#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
#581 【設計】Batch API 操作ライブラリ

OpenAI Batch API の投入・ポーリング・結果取得を担当
"""

import os
import time
import logging
import requests
from typing import Optional, Dict

logger = logging.getLogger(__name__)


class BatchAPIClient:
    """OpenAI Batch API クライアント"""
    
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError("OPENAI_API_KEY environment variable is not set")
        
        self.base_url = "https://api.openai.com/v1"
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
    
    def upload_file(self, filepath: str) -> str:
        """
        ファイルをアップロード
        
        Args:
            filepath: アップロードするファイルのパス
            
        Returns:
            file_id
        """
        logger.info(f"Uploading file: {filepath}")
        
        with open(filepath, 'rb') as f:
            files = {
                'purpose': (None, 'batch'),
                'file': (os.path.basename(filepath), f, 'application/jsonl')
            }
            
            response = requests.post(
                f"{self.base_url}/files",
                headers={"Authorization": f"Bearer {self.api_key}"},
                files=files
            )
        
        response.raise_for_status()
        file_id = response.json()["id"]
        
        logger.info(f"File uploaded successfully: {file_id}")
        return file_id
    
    def create_batch(self, input_file_id: str, endpoint: str = "/v1/chat/completions") -> str:
        """
        バッチを作成
        
        Args:
            input_file_id: 入力ファイルID
            endpoint: エンドポイント
            
        Returns:
            batch_id
        """
        logger.info(f"Creating batch with input_file_id: {input_file_id}")
        
        data = {
            "input_file_id": input_file_id,
            "endpoint": endpoint,
            "completion_window": "24h"
        }
        
        response = requests.post(
            f"{self.base_url}/batches",
            headers=self.headers,
            json=data
        )
        
        response.raise_for_status()
        batch_id = response.json()["id"]
        
        logger.info(f"Batch created successfully: {batch_id}")
        return batch_id
    
    def get_batch_status(self, batch_id: str) -> Dict:
        """
        バッチのステータスを取得
        
        Args:
            batch_id: バッチID
            
        Returns:
            ステータス辞書
        """
        response = requests.get(
            f"{self.base_url}/batches/{batch_id}",
            headers=self.headers
        )
        
        response.raise_for_status()
        return response.json()
    
    def poll_batch(self, batch_id: str, interval_sec: int = 30, timeout_sec: int = 86400) -> Dict:
        """
        バッチの完了を待機
        
        Args:
            batch_id: バッチID
            interval_sec: ポーリング間隔（秒）
            timeout_sec: タイムアウト（秒）
            
        Returns:
            最終ステータス辞書
        """
        logger.info(f"Polling batch {batch_id} (interval={interval_sec}s, timeout={timeout_sec}s)")
        
        start_time = time.time()
        
        while True:
            status = self.get_batch_status(batch_id)
            current_status = status["status"]
            
            logger.info(f"Batch status: {current_status}")
            
            if current_status in ["completed", "failed", "expired", "cancelled"]:
                logger.info(f"Batch finished with status: {current_status}")
                return status
            
            elapsed = time.time() - start_time
            if elapsed > timeout_sec:
                raise TimeoutError(f"Batch polling timed out after {timeout_sec}s")
            
            time.sleep(interval_sec)
    
    def download_results(self, output_file_id: str, output_path: str) -> None:
        """
        結果ファイルをダウンロード
        
        Args:
            output_file_id: 出力ファイルID
            output_path: 保存先パス
        """
        logger.info(f"Downloading results from file_id: {output_file_id}")
        
        response = requests.get(
            f"{self.base_url}/files/{output_file_id}/content",
            headers=self.headers
        )
        
        response.raise_for_status()
        
        with open(output_path, 'wb') as f:
            f.write(response.content)
        
        logger.info(f"Results downloaded to: {output_path}")
