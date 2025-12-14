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
from typing import List, Dict, Set, Tuple, Optional
from SPARQLWrapper import SPARQLWrapper, JSON
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

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
    
    @retry(
        stop=stop_after_attempt(10),
        wait=wait_exponential(multiplier=1, min=4, max=60),
        retry=retry_if_exception_type((Exception,))
    )
    def execute_query(self, query: str) -> List[Dict]:
        """
        SPARQL クエリを実行して結果を返す
        
        Args:
            query: SPARQL クエリ文字列
            
        Returns:
            クエリ結果のリスト
        """
        self.sparql.setQuery(query)
        try:
            results = self.sparql.query().convert()
            return results.get("results", {}).get("bindings", [])
        except Exception as e:
            logger.error(f"SPARQL query failed: {e}")
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

        大量データ対策として、LIMIT + OFFSET でページングしながら取得する。

        Args:
            root_qids: ルート QID のリスト（例: ['Q746549', 'Q8495', ...]）
            limit: 取得件数の上限（開発用、None で無制限）
            page_size: 1ページあたりの取得件数（デフォルト 10000）

        Returns:
            ノード情報のリスト
            [{'item_qid': 'Q12345', 'label_ja': '寿司', 'label_en': 'sushi', ...}, ...]
        """
        values_clause = " ".join([f"wd:{qid}" for qid in root_qids])

        nodes: List[Dict] = []
        total_fetched = 0
        offset = 0
        page = 1

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
            }}
            LIMIT {batch_limit}
            OFFSET {offset}
            """

            logger.info(
                f"Fetching page {page} "
                f"(LIMIT {batch_limit} OFFSET {offset}, total_fetched={total_fetched})"
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

            total_fetched += page_count
            logger.info(
                f"Page {page} fetched {page_count} nodes "
                f"(total_fetched={total_fetched})"
            )

            # 次ページへ
            page += 1
            offset += page_count  # or offset += batch_limit

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
