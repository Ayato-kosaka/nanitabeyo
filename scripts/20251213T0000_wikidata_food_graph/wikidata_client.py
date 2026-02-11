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

import csv
import logging
import re
import time
from typing import Dict, Generator, List, Optional, Set, Tuple

import requests
from SPARQLWrapper import JSON, SPARQLExceptions, SPARQLWrapper
from tenacity import before_sleep_log, retry, retry_if_exception_type, stop_after_attempt, wait_exponential
import json as json_module

logger = logging.getLogger(__name__)

# 設定
SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"
USER_AGENT = "nanitabeyo-wikidata-food-graph/1.0 (https://github.com/Ayato-kosaka/nanitabeyo)"


class ResponseSizeLimitExceeded(Exception):
    """
    #555 【設計】レスポンスサイズが閾値を超えた場合の例外
    
    バッチ分割の判断に使用（リトライ対象外）
    """
    pass


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
    def execute_query_json(self, query: str) -> List[Dict]:
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

    # 既存呼び出しとの互換性を維持
    def execute_query(self, query: str) -> List[Dict]:
        return self.execute_query_json(query)

    @retry(
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=2, min=4, max=120),
        retry=retry_if_exception_type((
            requests.exceptions.RequestException,
            requests.exceptions.HTTPError,
        )),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True
    )
    def execute_query_tsv_iter(
        self,
        query: str,
        max_response_size: Optional[int] = None
    ) -> Generator[Dict[str, str], None, Tuple[int, int]]:
        """
        #555 【設計】SPARQL クエリを TSV 形式でストリーム取得し、行単位で yield する。
        
        P0対応：
        - retry/backoff 追加（429/503/504 対策）
        - ストリーム処理でメモリ使用量を一定化
        - Content-Length 事前チェックで無駄なDL回避
        
        Args:
            query: SPARQL クエリ文字列
            max_response_size: 最大レスポンスサイズ（バイト）。超えた場合は ResponseSizeLimitExceeded を raise
            
        Yields:
            パース済み行の辞書
            
        Returns:
            (受信バイト数, スキップ行数) のタプル（generator終了時）
            
        Raises:
            ResponseSizeLimitExceeded: レスポンスサイズが max_response_size を超えた場合（分割対象）
            RequestException: ネットワークエラー（リトライ対象）
            HTTPError: HTTP エラー（429/503/504 はリトライ対象）
        """
        params = {
            "query": query,
        }

        response = requests.get(
            SPARQL_ENDPOINT,
            params=params,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/tab-separated-values; charset=utf-8",
            },
            stream=True,
            timeout=120,
        )
        response.raise_for_status()

        # #555 【P0-3】Content-Length 事前チェック（受信前に分割判断）
        declared_size = response.headers.get("Content-Length")
        declared_size_int = int(declared_size) if declared_size and declared_size.isdigit() else None
        
        if declared_size_int and max_response_size and declared_size_int > max_response_size:
            logger.warning(
                "Content-Length %d bytes exceeds limit %d bytes. Aborting download.",
                declared_size_int,
                max_response_size,
            )
            response.close()
            raise ResponseSizeLimitExceeded(
                f"Content-Length {declared_size_int} exceeds limit {max_response_size}"
            )

        content_size = 0
        skipped_lines = 0

        line_iter = response.iter_lines(decode_unicode=True)
        header_line = next(line_iter, None)
        ct = (response.headers.get("Content-Type") or "").lower()

        if header_line is None:
            logger.warning("TSV response is empty (no header)")
            return content_size, skipped_lines

        # ヘッダーにタブがない＝TSVとして成立してない可能性が高い
        if "\t" not in header_line:
            snippet = header_line[:200].replace("\r", "\\r").replace("\n", "\\n")
            logger.error("TSV header seems invalid (no tab). Content-Type=%s, header=%r", ct, snippet)
            response.close()
            # retry対象にしたいので RequestException 系を投げる
            raise requests.exceptions.RequestException("Non-TSV response (invalid header)")

        # HTML混入の簡易検出
        hl = header_line.lstrip()
        if hl.startswith("<!DOCTYPE") or hl.startswith("<html") or hl.startswith("<?xml"):
            snippet = header_line[:200]
            logger.error("Non-TSV markup detected in header. Content-Type=%s, header=%r", ct, snippet)
            response.close()
            raise requests.exceptions.RequestException("Markup response instead of TSV")

        content_size += len(header_line.encode("utf-8")) + 1

        try:
            raw_fieldnames = next(csv.reader([header_line], delimiter="\t"))
            fieldnames = [name.lstrip("?") for name in raw_fieldnames]
        except Exception as e:
            logger.error(f"Failed to parse TSV header: {e}")
            return content_size, skipped_lines

        for line_number, line in enumerate(line_iter, start=2):
            line_size = len(line.encode("utf-8")) + 1
            content_size += line_size

            # #555 【P0-3】受信中に閾値超過を検出（Content-Length が無い場合の防御）
            if max_response_size and content_size > max_response_size:
                logger.warning(
                    "Response size %d bytes exceeded limit %d bytes during streaming. Aborting.",
                    content_size,
                    max_response_size,
                )
                response.close()
                raise ResponseSizeLimitExceeded(
                    f"Streaming size {content_size} exceeded limit {max_response_size}"
                )

            if not line:
                continue

            try:
                parsed = next(csv.reader([line], delimiter="\t"))
            except Exception as e:
                skipped_lines += 1
                logger.warning(
                    "Failed to parse TSV line %d (error: %s). Skipping.",
                    line_number,
                    e,
                )
                continue

            if len(parsed) != len(fieldnames):
                skipped_lines += 1
                logger.warning(
                    "Malformed TSV line %d (expected %d columns, got %d). Skipping.",
                    line_number,
                    len(fieldnames),
                    len(parsed),
                )
                continue

            row = {fieldnames[i]: parsed[i] for i in range(len(fieldnames))}
            yield row

        # #555 【P2-7】可観測性強化：統一ログ出力
        if skipped_lines > 0:
            logger.warning("TSV parsing skipped %d lines due to errors", skipped_lines)

        if declared_size_int is not None and declared_size_int != content_size:
            logger.info(
                "TSV response: status=200, declared=%d bytes, received=%d bytes, skipped=%d lines",
                declared_size_int,
                content_size,
                skipped_lines,
            )
        else:
            logger.info(
                "TSV response: status=200, size=%d bytes, skipped=%d lines",
                content_size,
                skipped_lines,
            )

        return content_size, skipped_lines

    def execute_query_tsv(self, query: str) -> Tuple[List[Dict[str, str]], int]:
        """
        #555 【互換性】既存呼び出しのための互換メソッド（非推奨：メモリ効率が悪い）
        
        新規実装では execute_query_tsv_iter を使用すること。
        
        Returns:
            (パース済み行のリスト, 受信バイト数)
        """
        rows = []
        content_size = 0
        
        # #555 【バグ】generator の return 値を取得するには手動で next() を呼ぶ必要がある
        gen = self.execute_query_tsv_iter(query)
        try:
            while True:
                row = next(gen)
                rows.append(row)
        except StopIteration as e:
            # generator の return 値は StopIteration.value から取得
            if e.value:
                content_size, _ = e.value
        
        return rows, content_size

    def fetch_food_nodes(
        self,
        class_qids: List[str],
        limit: Optional[int] = None,
        page_size: int = 1000,
    ) -> List[Dict]:
        """
        #745 【設計】2 段階設計 Stage 2: P31-only でインスタンスを取得
        
        food_class_closure から取得したクラス QID のリストに対して、
        ?item wdt:P31 ?class を満たすノードを取得する。
        
        property path (wdt:P31|wdt:P279)* を使用しないため、
        WDQS への負荷が大幅に削減され、抽出の完全性が向上する。
        
        大量データ対策として、カーソル方式でページングしながら取得する。
        OFFSETではなくORDER BY + FILTERを使い、WDQSへの負荷を軽減。
        
        Args:
            class_qids: クラス QID のリスト（food_class_closure から取得）
            limit: 取得件数の上限（開発用、None で無制限）
            page_size: 1ページあたりの取得件数（デフォルト 1000）
            
        Returns:
            ノード情報のリスト
            [{'item_qid': 'Q12345', 'label_ja': '寿司', 'label_en': 'sushi', ...}, ...]
        """
        # #745 【設計】監視用：代表的な QID が取得されているかチェック
        WATCH_QIDS = {
            "Q13233",   # アイスクリーム (ice cream)
            "Q13276",   # ケーキ (cake)
            "Q282",     # ワイン (wine)
            "Q13290",   # スムージー (smoothie)
            "Q375",     # ワッフル (waffle)
            "Q44541",   # パンケーキ (pancake)
            "Q20129",   # オムレツ (omelette)
            "Q58263",   # エッグベネディクト (eggs Benedict)
            "Q6128",    # トースト (toast)
            "Q6663",    # ハンバーガー (hamburger)
            "Q8486",    # コーヒー (coffee)
            "Q9266",    # サラダ (salad)
            "Q41415",   # 汁物料理 (soup)
            "Q6137769", # チーズ盛り合わせ (cheese platter)
        }
        watch_found: Set[str] = set()
        
        if not class_qids:
            logger.warning("No class QIDs provided")
            return []
        
        # #745 【設計】VALUES 句用にクラス QID を準備
        values_clause = " ".join([f"wd:{qid}" for qid in class_qids])
        
        nodes: List[Dict] = []
        total_fetched = 0
        page = 1
        last_item_uri: Optional[str] = None  # #545 【設計】カーソル方式：前回取得した最後のitem URI
        
        logger.info(
            f"Fetching food nodes for {len(class_qids)} classes "
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
            
            # #745 【設計】P31-only クエリ（property path を使わない）
            query = f"""
            SELECT DISTINCT ?item ?label_ja ?label_en ?desc_ja ?desc_en
            WHERE {{
              VALUES ?class {{ {values_clause} }}
              ?item wdt:P31 ?class .
              
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
                
                # #745 【設計】WATCH_QIDS の監視
                if item_qid in WATCH_QIDS and item_qid not in watch_found:
                    watch_found.add(item_qid)
                    logger.info(f"🎯 WATCH_QID found: {item_qid} (page {page})")
                
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
        
        # #745 【設計】WATCH_QIDS のサマリーログ
        logger.info(f"Fetched {len(nodes)} food nodes in total")
        logger.info(f"🎯 WATCH_QIDS found: {len(watch_found)}/{len(WATCH_QIDS)}")
        if watch_found:
            logger.info(f"   Found: {sorted(watch_found)}")
        missing = WATCH_QIDS - watch_found
        if missing:
            logger.warning(f"   Missing: {sorted(missing)}")
        
        return nodes

    
    def fetch_class_closure(
        self,
        root_qid: str,
        max_depth: Optional[int] = None,
    ) -> List[Dict]:
        """
        #745 【設計】指定された root_qid に対して P279* でクラス閉包を取得
        
        2 段階設計の Stage 1: クラス階層（type）のみを取得する。
        インスタンス（P31）は含まれないため、件数は少ない（数百〜数千程度）。
        
        Args:
            root_qid: ルート QID（例: 'Q746549'）
            max_depth: P279* の最大深度（None で無制限、デバッグ用）
            
        Returns:
            クラス情報のリスト
            [{'class_qid': 'Q12345', 'depth': 0}, ...]
        """
        logger.info(f"Fetching class closure for root {root_qid}")
        
        # #745 【設計】P279* のみを使用（P31 は含めない）
        # max_depth を指定する場合は、SPARQL の property path では制御できないため、
        # 複数クエリで段階的に取得する必要がある。
        # ただし、デフォルトは無制限で、全クラスを一度に取得する。
        
        if max_depth is None:
            # 無制限：P279* で一度に取得
            query = f"""
            SELECT DISTINCT ?class
            WHERE {{
              ?class wdt:P279* wd:{root_qid} .
              FILTER(STRSTARTS(STR(?class), "http://www.wikidata.org/entity/Q"))
            }}
            """
            
            logger.info(f"Fetching all classes for root {root_qid} (unlimited depth)")
            results = self.execute_query(query)
            
            classes = []
            for result in results:
                class_uri = result.get("class", {}).get("value", "")
                class_qid = class_uri.split("/")[-1] if class_uri else None
                
                if not class_qid:
                    continue
                
                # depth は正確に計算できないため、-1 で保存
                # 後で BFS で計算することも可能だが、今回は省略
                classes.append({
                    "class_qid": class_qid,
                    "depth": -1  # 深度不明（P279* で一括取得時）
                })
            
            logger.info(f"Fetched {len(classes)} classes for root {root_qid}")
            return classes
        
        else:
            # 深度制限：BFS で段階的に取得
            logger.info(f"Fetching classes for root {root_qid} (max_depth={max_depth})")
            
            classes = []
            current_level = {root_qid}
            seen = {root_qid}
            
            for depth in range(max_depth + 1):
                if not current_level:
                    break
                
                # 現在のレベルをクラスリストに追加
                for qid in current_level:
                    classes.append({
                        "class_qid": qid,
                        "depth": depth
                    })
                
                # 次のレベルを取得（P279 で 1 ステップ）
                if depth < max_depth:
                    next_level = set()
                    
                    # バッチ処理（SPARQL エンドポイントの制限対策）
                    batch_size = 100
                    current_list = list(current_level)
                    
                    for i in range(0, len(current_list), batch_size):
                        batch = current_list[i:i + batch_size]
                        values_clause = " ".join([f"wd:{qid}" for qid in batch])
                        
                        query = f"""
                        SELECT DISTINCT ?subclass
                        WHERE {{
                          VALUES ?superclass {{ {values_clause} }}
                          ?subclass wdt:P279 ?superclass .
                          FILTER(STRSTARTS(STR(?subclass), "http://www.wikidata.org/entity/Q"))
                        }}
                        """
                        
                        results = self.execute_query(query)
                        
                        for result in results:
                            subclass_uri = result.get("subclass", {}).get("value", "")
                            subclass_qid = subclass_uri.split("/")[-1] if subclass_uri else None
                            
                            if subclass_qid and subclass_qid not in seen:
                                next_level.add(subclass_qid)
                                seen.add(subclass_qid)
                        
                        # Rate limit 対策
                        time.sleep(0.5)
                    
                    logger.info(f"  Depth {depth}: {len(current_level)} classes, next: {len(next_level)}")
                    current_level = next_level
            
            logger.info(f"Fetched {len(classes)} classes for root {root_qid} (depth 0-{max_depth})")
            return classes
    
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
