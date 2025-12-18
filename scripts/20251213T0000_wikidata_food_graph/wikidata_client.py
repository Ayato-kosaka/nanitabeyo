#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
wikidata_client.py

【目的】
Wikidata SPARQL エンドポイントに対してクエリを実行するクライアント

【機能】
- SPARQL クエリの実行
- rate limit 対策のリトライ機能
- ノード情報（label, description）の取得
- 親子関係（P31, P279）の取得
"""

import time
import logging
import re
from typing import List, Dict, Set, Tuple, Optional
from SPARQLWrapper import SPARQLWrapper, JSON, SPARQLExceptions
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type, before_sleep_log
import requests
import json as json_module

logger = logging.getLogger(__name__)

# 設定
SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"
USER_AGENT = "nanitabeyo-wikidata-food-graph/1.0 (https://github.com/Ayato-kosaka/nanitabeyo)"


class WikidataClient:
    """Wikidata SPARQL クエリを実行するクライアント"""
    
    def __init__(self):
        self.sparql = SPARQLWrapper(SPARQL_ENDPOINT)
        self.sparql.setReturnFormat(JSON)
        self.sparql.addCustomHttpHeader("User-Agent", USER_AGENT)

    @staticmethod
    def _sanitize_control_characters(text: str) -> Tuple[str, int]:
        """
        JSON仕様で禁止されている制御文字（0x00-0x1Fの一部）を除去する。

        例：multilang データの中に混入した NUL や BEL など。

        Returns:
            (サニタイズ後の文字列, 除去した文字数)
        """

        control_chars_pattern = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
        sanitized_text, removed_count = control_chars_pattern.subn("", text)
        return sanitized_text, removed_count
    
    @staticmethod
    def _should_retry(exception):
        """
        #555 【設計】リトライ対象を「WDQS由来の揺らぎ」に寄せる
        
        Args:
            exception: 発生した例外
            
        Returns:
            リトライすべきかどうか
        """
        # JSONDecodeError: WDQS側のレスポンス不整合（HTML混入、途中切断等）
        if isinstance(exception, json_module.JSONDecodeError):
            logger.warning(f"JSONDecodeError detected (WDQS response issue), will retry: {exception}")
            return True
        
        # HTTPError: 429/503/504 を主対象
        if isinstance(exception, requests.exceptions.HTTPError):
            status_code = exception.response.status_code if exception.response else None
            if status_code in [429, 503, 504]:
                logger.warning(f"SPARQL HTTP {status_code} detected, will retry...")
                return True
            # その他のHTTPエラーはリトライしない（400番台等）
            logger.error(f"HTTP {status_code} - not retrying")
            return False
        
        # RequestException: 接続エラー、タイムアウト等
        if isinstance(exception, requests.exceptions.RequestException):
            logger.warning(f"RequestException (network issue), will retry: {exception}")
            return True
        
        # SPARQLWrapperException: SPARQL実行時の例外
        if hasattr(SPARQLExceptions, 'SPARQLWrapperException'):
            if isinstance(exception, SPARQLExceptions.SPARQLWrapperException):
                logger.warning(f"SPARQLWrapperException, will retry: {exception}")
                return True
        
        # その他のException: ロジックエラーの可能性があるため即落とす
        logger.error(f"Unhandled exception (not retrying): {type(exception).__name__}: {exception}")
        return False
    
    @retry(
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=2, min=4, max=120),
        retry=retry_if_exception_type((
            json_module.JSONDecodeError,
            requests.exceptions.RequestException,
            SPARQLExceptions.SPARQLWrapperException if hasattr(SPARQLExceptions, 'SPARQLWrapperException') else Exception,
        )),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True
    )
    def execute_query(self, query: str) -> List[Dict]:
        """
        SPARQL クエリを実行して結果を返す（可観測性強化版）
        
        Args:
            query: SPARQL クエリ文字列
            
        Returns:
            クエリ結果のリスト
            
        Raises:
            JSONDecodeError: レスポンスがJSONとしてパースできない
            RequestException: ネットワークエラー
            SPARQLWrapperException: SPARQL実行エラー
        """
        self.sparql.setQuery(query)
        
        try:
            # SPARQLWrapper の内部処理を模倣し、可観測性を強化
            response = self.sparql.query()
            
            # HTTPレスポンスの情報を取得
            if hasattr(response, 'response'):
                http_response = response.response
                status_code = http_response.status if hasattr(http_response, 'status') else 'unknown'
                
                # レスポンスボディを読み取る
                response_body = http_response.read()
                response_size = len(response_body)
                
                logger.info(f"SPARQL response: status={status_code}, size={response_size} bytes")
                
                # レスポンスの先頭・末尾をログ出力（デバッグ用）
                if response_size > 0:
                    head = response_body[:500].decode('utf-8', errors='replace')
                    tail = response_body[-500:].decode('utf-8', errors='replace') if response_size > 500 else ""
                    logger.debug(f"Response head: {head[:200]}...")
                    if tail:
                        logger.debug(f"Response tail: ...{tail[-200:]}")
                    
                    # HTMLエラーページの検出
                    if response_body.startswith(b'<!DOCTYPE') or response_body.startswith(b'<html'):
                        logger.error("Response is HTML (likely error page), not JSON")
                        raise json_module.JSONDecodeError(
                            "Response is HTML error page",
                            response_body.decode('utf-8', errors='replace')[:1000],
                            0
                        )
                
                # JSONパース（制御文字対応：errors='replace'で吸収）
                try:
                    # Wikidata SPARQL endpoint の既知問題：
                    # multilang（label/desc/alias）に制御文字（U+0000〜U+001F）が混入し、
                    # strict JSON parse が失敗するケースがある。
                    # データ完全性優先のため、壊れた文字を \uFFFD に置換して処理を継続。
                    decoded_body = response_body.decode('utf-8', errors='replace')

                    sanitized_body, removed_count = self._sanitize_control_characters(decoded_body)
                    if removed_count > 0:
                        logger.warning(
                            "Removed %d invalid control characters from SPARQL response (status=%s, size=%d bytes)",
                            removed_count,
                            status_code,
                            response_size,
                        )
                    
                    # 制御文字の置換が発生したかログ記録
                    if '\ufffd' in sanitized_body:
                        logger.warning("Response contains invalid UTF-8 sequences (replaced with U+FFFD)")
                        logger.warning("This may indicate control characters in Wikidata multilang data")
                    
                    result_json = json_module.loads(sanitized_body)
                    return result_json.get("results", {}).get("bindings", [])
                except json_module.JSONDecodeError as e:
                    logger.error(f"JSONDecodeError: {e}")
                    logger.error(f"Response size: {response_size}")
                    logger.error(f"Error position: {e.pos}, line: {e.lineno}, col: {e.colno}")
                    # レスポンスのエラー位置周辺をログ出力
                    if hasattr(e, 'pos') and e.pos:
                        start = max(0, e.pos - 200)
                        end = min(len(response_body), e.pos + 200)
                        context = response_body[start:end].decode('utf-8', errors='replace')
                        logger.error(f"Context around error: ...{context}...")
                    raise
            else:
                # 通常の convert() を使用（フォールバック）
                logger.warning("Using fallback convert() method")
                results = response.convert()
                return results.get("results", {}).get("bindings", [])
                
        except json_module.JSONDecodeError:
            # JSONDecodeError は再スロー（リトライ対象）
            raise
        except requests.exceptions.RequestException:
            # RequestException は再スロー（リトライ対象）
            raise
        except Exception as e:
            # その他の例外はログに記録して再スロー
            status_code = None
            if hasattr(e, 'response') and e.response:
                status_code = e.response.status_code
            
            logger.error(f"SPARQL query failed (status={status_code}): {type(e).__name__}: {e}")
            raise

    def fetch_food_nodes(
        self,
        root_qids: List[str],
        limit: Optional[int] = None,
        page_size: int = 1000,
    ) -> List[Dict]:
        """
        food_roots に含まれる root_qid のいずれかに対して
        ?item wdt:P31/wdt:P279* ?root_qid を満たすノードを取得

        大量データ対策として、カーソル方式でページングしながら取得する。
        OFFSETではなくORDER BY + FILTERを使い、WDQSへの負荷を軽減。

        Args:
            root_qids: ルート QID のリスト（例: ['Q746549', 'Q8495', ...]）
            limit: 取得件数の上限（開発用、None で無制限）
            page_size: 1ページあたりの取得件数（デフォルト 1000）

        Returns:
            ノード情報のリスト
            [{'item_qid': 'Q12345', 'label_ja': '寿司', 'label_en': 'sushi', ...}, ...]
        """
        values_clause = " ".join([f"wd:{qid}" for qid in root_qids])

        nodes: List[Dict] = []
        total_fetched = 0
        page = 1
        last_item_uri: Optional[str] = None  # #545 【設計】カーソル方式：前回取得した最後のitem URI

        logger.info(
            f"Fetching food nodes for {len(root_qids)} roots "
            f"(limit: {limit}, page_size: {page_size})"
        )

        while True:
            # limit が指定されている場合は、その範囲内で page_size を切る
            if limit is not None:
                remaining = limit - total_fetched
                if remaining <= 0:
                    break
                batch_limit = min(page_size, remaining)
            else:
                batch_limit = page_size

            # #545 【設計】カーソル条件を動的に生成
            cursor_filter = ""
            if last_item_uri:
                cursor_filter = f'FILTER(STR(?item) > "{last_item_uri}")'

            query = f"""
            SELECT DISTINCT ?item ?label_ja ?label_en ?desc_ja ?desc_en
            WHERE {{
              VALUES ?root {{ {values_clause} }}
              ?item (wdt:P31|wdt:P279)* ?root .

              OPTIONAL {{ ?item rdfs:label ?label_ja FILTER(LANG(?label_ja) = "ja") }}
              OPTIONAL {{ ?item rdfs:label ?label_en FILTER(LANG(?label_en) = "en") }}
              OPTIONAL {{ ?item schema:description ?desc_ja FILTER(LANG(?desc_ja) = "ja") }}
              OPTIONAL {{ ?item schema:description ?desc_en FILTER(LANG(?desc_en) = "en") }}

              FILTER(STRSTARTS(STR(?item), "http://www.wikidata.org/entity/Q"))
              {cursor_filter}
            }}
            ORDER BY ?item
            LIMIT {batch_limit}
            """

            logger.info(
                f"Fetching page {page} "
                f"(LIMIT {batch_limit}, cursor={last_item_uri or 'None'}, total_fetched={total_fetched})"
            )

            results = self.execute_query(query)

            if not results:
                logger.info(
                    f"No more results (page {page}). "
                    f"Total fetched: {total_fetched}"
                )
                break

            page_count = 0
            for result in results:
                item_uri = result.get("item", {}).get("value", "")
                item_qid = item_uri.split("/")[-1] if item_uri else None

                if not item_qid:
                    continue

                nodes.append({
                    "item_qid": item_qid,
                    "label_ja": result.get("label_ja", {}).get("value"),
                    "label_en": result.get("label_en", {}).get("value"),
                    "desc_ja": result.get("desc_ja", {}).get("value"),
                    "desc_en": result.get("desc_en", {}).get("value"),
                })
                page_count += 1
                last_item_uri = item_uri  # #545 【設計】カーソル更新

            total_fetched += page_count
            logger.info(
                f"Page {page} fetched {page_count} nodes "
                f"(total_fetched={total_fetched}, last_item={last_item_uri})"
            )

            # 次ページへ
            page += 1

            # レスポンス件数が LIMIT 未満なら「終端まで来た」と判断して終了
            if page_count < batch_limit:
                logger.info(
                    f"Last page reached (page {page-1}, "
                    f"page_count={page_count} < batch_limit={batch_limit})"
                )
                break

            # Rate limit 対策
            if total_fetched % 1000 == 0:
                time.sleep(1)

        logger.info(f"Fetched {len(nodes)} food nodes in total")
        return nodes
    
    def fetch_parent_edges(self, qids: List[str]) -> List[Tuple[str, str]]:
        """
        指定された QID のリストについて、P31/P279 の親を取得
        
        Args:
            qids: QID のリスト
            
        Returns:
            (child_qid, parent_qid) のタプルのリスト
        """
        if not qids:
            return []
        
        # バリデーション: Q + 数字のみ
        valid_qids = [qid for qid in qids if qid.startswith('Q') and qid[1:].isdigit()]
        if not valid_qids:
            return []
        
        # バッチサイズで分割（SPARQL エンドポイントの制限対策）
        batch_size = 100
        all_edges = []
        
        for i in range(0, len(valid_qids), batch_size):
            batch = valid_qids[i:i + batch_size]
            values_clause = " ".join([f"wd:{qid}" for qid in batch])
            
            query = f"""
            SELECT DISTINCT ?child ?parent
            WHERE {{
              VALUES ?child {{ {values_clause} }}
              ?child (wdt:P31|wdt:P279) ?parent .
              FILTER(STRSTARTS(STR(?parent), "http://www.wikidata.org/entity/Q"))
            }}
            """
            
            logger.info(f"Fetching parent edges for batch {i // batch_size + 1}/{(len(valid_qids) + batch_size - 1) // batch_size}")
            results = self.execute_query(query)
            
            for result in results:
                child_uri = result.get("child", {}).get("value", "")
                parent_uri = result.get("parent", {}).get("value", "")
                
                child_qid = child_uri.split("/")[-1] if child_uri else None
                parent_qid = parent_uri.split("/")[-1] if parent_uri else None
                
                if child_qid and parent_qid:
                    all_edges.append((child_qid, parent_qid))
            
            # Rate limit 対策
            time.sleep(0.5)
        
        logger.info(f"Fetched {len(all_edges)} parent edges")
        return all_edges
