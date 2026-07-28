#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
3_2_refresh_dish_category_catalog_core.py

【目的】
Wikidata から core 情報を取得し、dish_category_catalog を MERGE 更新する

【処理内容】
1. food_nodes_raw - dish_blacklist の QID 集合を取得（candidates）
2. SPARQL でバッチ分割して core 情報を取得
   - labels_json, descriptions_json, aliases_json, sitelinks_json
   - origin_qids, cuisine_qids
   - image_url（P18 から変換）
3. 取得結果を一時テーブル経由で BigQuery に流し込み、MERGE する
4. candidates に存在しない item_qid は削除する

【使用方法】
python3 3_2_refresh_dish_category_catalog_core.py

# catalog に未登録の候補だけを追加し、既存 catalog の更新や stale 削除は避ける
python3 3_2_refresh_dish_category_catalog_core.py --missing-only --skip-delete-stale
"""

import sys
import json
import logging
import argparse
import time
import urllib.parse
import tempfile
import os
from collections import deque
from typing import Dict, List, Optional, Set, Tuple
from google.cloud import bigquery
import requests

from wikidata_client import WikidataClient, ResponseSizeLimitExceeded
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
BATCH_SIZE = 80  # #555 【バグ】504対策：300→80に縮小（安定性優先）
MULTILANG_BATCH_SIZE = 5  # 多言語データ専用の極小バッチ（制御文字混入・巨大レスポンス対策）

# 【設計】文字列フィールドの最大長（truncate用）
MAX_STRING_LENGTH = 10000  # 1フィールドあたりの最大文字数
MAX_ALIASES_COUNT = 1000   # aliases配列の最大要素数

# #555 【設計】対応ロケール→Wikipedia言語コードのマッピング
SUPPORTED_LOCALES = {
    "ar-SA": "ar",
    "en-US": "en",
    "es-ES": "es",
    "fr-FR": "fr",
    "hi-IN": "hi",
    "ja-JP": "ja",
    "ko-KR": "ko",
    "zh-CN": "zh",
}

# #555 【設計】sitelinks allowlist：必要なWikipedia言語だけに絞る
SITELINK_ALLOW_SITES = [
    f"https://{lang}.wikipedia.org/" 
    for lang in SUPPORTED_LOCALES.values()
]


def fetch_candidate_qids(bq_loader: BigQueryLoader) -> List[str]:
    """
    #543 【設計】対象 QID 集合を取得（food_nodes_raw - dish_blacklist）
    
    Returns:
        候補 QID のリスト
    """
    logger.info("Fetching candidate QIDs (food_nodes_raw - dish_blacklist)...")
    
    sql = f"""
    SELECT n.item_qid
    FROM `{bq_loader.dataset_ref}.food_nodes_raw` n
    LEFT JOIN `{bq_loader.dataset_ref}.dish_blacklist` b
      ON b.dish_qid = n.item_qid
    WHERE b.dish_qid IS NULL
    ORDER BY n.item_qid
    """
    
    query_job = bq_loader.client.query(sql)
    results = query_job.result()
    
    qids = [row.item_qid for row in results]
    logger.info(f"Found {len(qids)} candidate QIDs")
    
    return qids


def filter_missing_catalog_qids(
    bq_loader: BigQueryLoader,
    candidate_qids: List[str]
) -> List[str]:
    """
    # 【設計】candidate のうち、dish_category_catalog にまだ存在しない QID だけを返す。

    `3_2_refresh_dish_category_catalog_core.py` の通常モードは、既存 catalog の
    label/image/多言語 JSON も Wikidata 最新値で更新する「全件 refresh」である。
    一方で、手動で raw/blacklist を調整した直後は「新規候補だけ catalog に到達させたい」
    ことがある。その用途では既存 1万件以上を WDQS から取り直す必要がなく、失敗面も
    コスト面も大きい。

    この関数は `--missing-only` 用の局所絞り込みであり、candidate 集合そのものは変えない。
    つまり stale 判定を実行する場合は、引き続き `food_nodes_raw - dish_blacklist` の
    全 candidate を使うことで、整合性確認の意味を保つ。
    
    Args:
        bq_loader: BigQuery ローダー
        candidate_qids: `food_nodes_raw - dish_blacklist` の全候補 QID

    Returns:
        catalog 未登録の QID リスト
    """
    if not candidate_qids:
        return []

    logger.info("Filtering candidates to items missing from dish_category_catalog...")

    sql = f"""
    WITH candidates AS (
      SELECT qid AS item_qid
      FROM UNNEST(@candidate_qids) AS qid
    )
    SELECT c.item_qid
    FROM candidates c
    LEFT JOIN `{bq_loader.dataset_ref}.dish_category_catalog` cat
      ON cat.item_qid = c.item_qid
    WHERE cat.item_qid IS NULL
    ORDER BY c.item_qid
    """

    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ArrayQueryParameter("candidate_qids", "STRING", candidate_qids),
        ]
    )
    query_job = bq_loader.client.query(sql, job_config=job_config)
    results = query_job.result()

    missing_qids = [row.item_qid for row in results]
    logger.info(
        "Found %d missing catalog QIDs out of %d candidates",
        len(missing_qids),
        len(candidate_qids),
    )

    return missing_qids


def fetch_core_data_batch(
    wikidata_client: WikidataClient,
    qids: List[str]
) -> List[Dict]:
    """
    #555 【バグ】SPARQL で core 情報を取得（クエリ分割版：504対策）
    
    Args:
        wikidata_client: Wikidata クライアント
        qids: 取得対象の QID リスト
        
    Returns:
        core 情報のリスト
    """
    if not qids:
        return []
    
    # #555 【設計】Query A（軽い）：基本データ + origin/cuisine/image
    basic_data = fetch_basic_data(wikidata_client, qids)
    
    # #555 【設計】Query B（sitelinks専用）：allowlistフィルタ
    sitelinks_data = fetch_sitelinks_data(wikidata_client, qids)
    
    # #555 【設計】Query C（多言語系）：labels/descriptions/aliases
    multilang_data = fetch_multilang_data(wikidata_client, qids)
    
    # #555 【設計】Python側でitem_qidをキーにマージ
    merged_data = {}
    
    for item in basic_data:
        qid = item["item_qid"]
        merged_data[qid] = item
    
    for item in sitelinks_data:
        qid = item["item_qid"]
        if qid in merged_data:
            merged_data[qid]["sitelinks_json"] = item["sitelinks_json"]
    
    for item in multilang_data:
        qid = item["item_qid"]
        if qid in merged_data:
            merged_data[qid]["labels_json"] = item["labels_json"]
            merged_data[qid]["descriptions_json"] = item["descriptions_json"]
            merged_data[qid]["aliases_json"] = item["aliases_json"]
    
    return list(merged_data.values())


def fetch_basic_data(
    wikidata_client: WikidataClient,
    qids: List[str]
) -> List[Dict]:
    """
    #555 【設計】Query A：基本データ（label_ja/en, desc_ja/en, origin, cuisine, image）
    
    Args:
        wikidata_client: Wikidata クライアント
        qids: 取得対象の QID リスト
        
    Returns:
        基本データのリスト
    """
    values_clause = " ".join([f"wd:{qid}" for qid in qids])
    
    query = f"""
    SELECT DISTINCT ?item ?label_ja ?label_en ?desc_ja ?desc_en
      (GROUP_CONCAT(DISTINCT STR(?origin); separator="||") AS ?origins)
      (GROUP_CONCAT(DISTINCT STR(?cuisine); separator="||") AS ?cuisines)
      (SAMPLE(?image) AS ?image_sample)
    WHERE {{
      VALUES ?item {{ {values_clause} }}
      
      OPTIONAL {{ ?item rdfs:label ?label_ja FILTER(LANG(?label_ja) = "ja") }}
      OPTIONAL {{ ?item rdfs:label ?label_en FILTER(LANG(?label_en) = "en") }}
      OPTIONAL {{ ?item schema:description ?desc_ja FILTER(LANG(?desc_ja) = "ja") }}
      OPTIONAL {{ ?item schema:description ?desc_en FILTER(LANG(?desc_en) = "en") }}
      OPTIONAL {{ ?item wdt:P495 ?origin }}
      OPTIONAL {{ ?item wdt:P2012 ?cuisine }}
      OPTIONAL {{ ?item wdt:P18 ?image }}
    }}
    GROUP BY ?item ?label_ja ?label_en ?desc_ja ?desc_en
    """
    
    results = wikidata_client.execute_query(query)
    
    basic_data = []
    for result in results:
        item_uri = result.get("item", {}).get("value", "")
        item_qid = item_uri.split("/")[-1] if item_uri else None
        
        if not item_qid:
            continue
        
        # #555 【設計】基本フィールド
        label_ja = result.get("label_ja", {}).get("value")
        label_en = result.get("label_en", {}).get("value")
        desc_ja = result.get("desc_ja", {}).get("value")
        desc_en = result.get("desc_en", {}).get("value")
        
        # #555 【設計】origin/cuisine を QID 配列化
        origin_qids = parse_qid_list(result.get("origins", {}).get("value", ""))
        cuisine_qids = parse_qid_list(result.get("cuisines", {}).get("value", ""))
        
        # #555 【設計】image_url を Commons URL から実体 URL に変換
        image_raw = result.get("image_sample", {}).get("value", "")
        image_url = resolve_commons_url(image_raw) if image_raw else None
        
        basic_data.append({
            "item_qid": item_qid,
            "label_ja": label_ja,
            "label_en": label_en,
            "desc_ja": desc_ja,
            "desc_en": desc_en,
            "origin_qids": origin_qids,
            "cuisine_qids": cuisine_qids,
            "image_url": image_url,
            # #555 【設計】多言語系はNone初期化（Query Cで埋める）
            "labels_json": None,
            "descriptions_json": None,
            "aliases_json": None,
            "sitelinks_json": None,
        })
    
    return basic_data


def fetch_sitelinks_data(
    wikidata_client: WikidataClient,
    qids: List[str]
) -> List[Dict]:
    """
    #555 【設計】Query B：sitelinks（allowlistフィルタで必要言語のWikipediaだけ）
    
    Args:
        wikidata_client: Wikidata クライアント
        qids: 取得対象の QID リスト
        
    Returns:
        sitelinks データのリスト
    """
    values_clause = " ".join([f"wd:{qid}" for qid in qids])
    
    # #555 【設計】allowlist をSPARQL の IN (...) に変換
    sitelink_filter = ", ".join([f"<{site}>" for site in SITELINK_ALLOW_SITES])
    
    query = f"""
    SELECT ?item (STR(?sitelink) AS ?site) (STR(?article) AS ?article_name)
    WHERE {{
      VALUES ?item {{ {values_clause} }}
      
      ?article schema:about ?item ;
               schema:isPartOf ?sitelink .
      FILTER(?sitelink IN ({sitelink_filter}))
    }}
    """
    
    results = wikidata_client.execute_query(query)
    
    # #555 【設計】行で取得→Python側で集約
    sitelinks_by_qid = {}
    for result in results:
        item_uri = result.get("item", {}).get("value", "")
        item_qid = item_uri.split("/")[-1] if item_uri else None
        
        if not item_qid:
            continue
        
        site = result.get("site", {}).get("value", "")
        article = result.get("article_name", {}).get("value", "")
        
        if not site or not article:
            continue
        
        if item_qid not in sitelinks_by_qid:
            sitelinks_by_qid[item_qid] = {}
        
        sitelinks_by_qid[item_qid][site] = article
    
    # #555 【設計】JSON化
    sitelinks_data = []
    for qid, sitelinks in sitelinks_by_qid.items():
        sitelinks_data.append({
            "item_qid": qid,
            "sitelinks_json": json.dumps(sitelinks, ensure_ascii=False) if sitelinks else None,
        })
    
    return sitelinks_data


def fetch_multilang_data(
    wikidata_client: WikidataClient,
    qids: List[str]
) -> List[Dict]:
    """
    Query C：多言語labels/descriptions/aliases（TSVストリーム→Python集約）

    P0/P1 対応：
    - TSV streaming で即時集約（メモリ効率化）
    - Content-Length 事前チェック + 受信中閾値監視
    - alias の重複除去（set 使用）
    - 分割深度制限（無限分割回避）
    - failed QIDs の記録（後続で永続化可能）
    
    * 取得言語は制限しない（データ完全性優先）
    * レスポンスサイズに応じてバッチを自動分割
    """
    all_labels_by_qid: Dict[str, Dict[str, str]] = {}
    all_descriptions_by_qid: Dict[str, Dict[str, str]] = {}
    # #555 【P1-5】alias は set で受けて重複除去
    all_aliases_by_qid: Dict[str, Dict[str, Set[str]]] = {}
    failed_qids: List[str] = []

    logger.info(
        "Fetching multilang data for %d QIDs (initial batch size=%d)...",
        len(qids),
        MULTILANG_BATCH_SIZE,
    )

    # #555 【P1-6】分割深度を追跡（無限分割回避）
    batches: deque[Tuple[List[str], int]] = deque()
    MAX_SPLIT_DEPTH = 10
    
    for i in range(0, len(qids), MULTILANG_BATCH_SIZE):
        batches.append((qids[i:i + MULTILANG_BATCH_SIZE], 0))

    def enqueue_split(batch: List[str], depth: int, reason: str) -> None:
        """
        #555 【P1-6】分割深度を追跡してバッチを分割
        
        Args:
            batch: 分割対象のQIDリスト
            depth: 現在の分割深度
            reason: 分割理由（ログ用）
        """
        if len(batch) <= 1:
            logger.warning(
                "Cannot split batch of size 1 (reason: %s). Marking as failed.",
                reason
            )
            failed_qids.extend(batch)
            return
        
        if depth >= MAX_SPLIT_DEPTH:
            logger.error(
                "Max split depth %d reached for batch size %d (reason: %s). Marking as failed.",
                MAX_SPLIT_DEPTH,
                len(batch),
                reason
            )
            failed_qids.extend(batch)
            return
        
        mid = max(1, len(batch) // 2)
        first, second = batch[:mid], batch[mid:]
        logger.info(
            "Splitting batch (size=%d, depth=%d→%d, reason=%s) into [%d, %d]",
            len(batch),
            depth,
            depth + 1,
            reason,
            len(first),
            len(second)
        )
        batches.extendleft([(second, depth + 1), (first, depth + 1)])

    # #555 【P0-3】サイズ閾値の定義
    HARD_LIMIT_MB = 80  # 絶対に超えてはいけない閾値
    SOFT_LIMIT_MB = 30  # 超えたら分割を推奨する閾値

    processed_batches = 0
    while batches:
        batch_qids, depth = batches.popleft()
        processed_batches += 1
        logger.info(
            "  Multilang batch %d (size=%d, depth=%d, remaining=%d)...",
            processed_batches,
            len(batch_qids),
            depth,
            len(batches),
        )

        values_clause = " ".join([f"wd:{qid}" for qid in batch_qids])
        query = f"""
        SELECT ?item (LANG(?label) AS ?label_lang) (STR(?label) AS ?label_value)
                     (LANG(?desc) AS ?desc_lang) (STR(?desc) AS ?desc_value)
                     (LANG(?alias) AS ?alias_lang) (STR(?alias) AS ?alias_value)
        WHERE {{
          VALUES ?item {{ {values_clause} }}

          OPTIONAL {{ ?item rdfs:label ?label }}
          OPTIONAL {{ ?item schema:description ?desc }}
          OPTIONAL {{ ?item skos:altLabel ?alias }}
        }}
        """

        try:
            # #555 【P0-2, P0-3】streaming + Content-Length 事前チェック
            gen = wikidata_client.execute_query_tsv_iter(
                query,
                max_response_size=HARD_LIMIT_MB * 1024 * 1024
            )
            
            response_size = 0
            skipped_lines = 0
            
            # #555 【P0-2】即時集約（メモリに溜めない）
            # #555 【バグ】generator の return 値を取得するには手動で next() を呼ぶ必要がある
            try:
                while True:
                    result = next(gen)
                    item_uri = result.get("item", "")
                    item_uri = item_uri.strip()
                    if item_uri.startswith("<") and item_uri.endswith(">"):
                        item_uri = item_uri[1:-1] 
                    item_qid = item_uri.split("/")[-1] if item_uri else None

                    if not item_qid:
                        continue

                    if not (item_qid and item_qid.startswith("Q") and item_qid[1:].isdigit()):
                        continue

                    label_lang = result.get("label_lang", "")
                    label_value = result.get("label_value", "")
                    if label_lang and label_value:
                        all_labels_by_qid.setdefault(item_qid, {})[label_lang] = label_value

                    desc_lang = result.get("desc_lang", "")
                    desc_value = result.get("desc_value", "")
                    if desc_lang and desc_value:
                        all_descriptions_by_qid.setdefault(item_qid, {})[desc_lang] = desc_value

                    # #555 【P1-5】alias を set で受けて重複除去
                    alias_lang = result.get("alias_lang", "")
                    alias_value = result.get("alias_value", "")
                    if alias_lang and alias_value:
                        all_aliases_by_qid.setdefault(item_qid, {}).setdefault(alias_lang, set()).add(alias_value)
            except StopIteration as e:
                # generator の return 値は StopIteration.value から取得
                if e.value:
                    response_size, skipped_lines = e.value
            
            # #555 【P0-3】soft limit チェック（次回は分割推奨）
            if response_size > SOFT_LIMIT_MB * 1024 * 1024 and len(batch_qids) > 1:
                logger.warning(
                    "TSV response %.2f MB exceeded soft limit (>%dMB). Data accepted but splitting for next time.",
                    response_size / (1024 * 1024),
                    SOFT_LIMIT_MB
                )
                # 今回のデータは受け入れ済みなので、警告のみ（分割しない）

        except Exception as e:
            # #555 【P1-6】例外種別に応じた retry/split 判断
            
            if isinstance(e, ResponseSizeLimitExceeded):
                # サイズ超過 → 即分割（リトライ不要）
                logger.warning(
                    "Response size limit exceeded for %d QIDs: %s",
                    len(batch_qids),
                    e
                )
                enqueue_split(batch_qids, depth, "size_limit")
                continue
            elif isinstance(e, (requests.exceptions.HTTPError, requests.exceptions.RequestException)):
                # HTTP/ネットワークエラー → tenacity が既にリトライ済み
                # それでも失敗 → 分割して再試行
                logger.warning(
                    "TSV multilang query failed after retries for %d QIDs (error: %s)",
                    len(batch_qids),
                    e
                )
                enqueue_split(batch_qids, depth, "network_error")
                continue
            else:
                # その他のエラー → パースエラー等、分割しても無駄な可能性
                logger.error(
                    "Unexpected error for %d QIDs: %s",
                    len(batch_qids),
                    e
                )
                enqueue_split(batch_qids, depth, "parse_error")
                continue

        if batches:
            time.sleep(1)

    # #555 【P1-5】set → list 変換（出力前）
    multilang_data = []
    all_qids = set(all_labels_by_qid.keys()) | set(all_descriptions_by_qid.keys()) | set(all_aliases_by_qid.keys())

    logger.info(
        "Collected multilang data for %d QIDs (failed=%d)",
        len(all_qids),
        len(failed_qids),
    )

    for qid in all_qids:
        labels = all_labels_by_qid.get(qid, {})
        descriptions = all_descriptions_by_qid.get(qid, {})
        aliases_sets = all_aliases_by_qid.get(qid, {})
        
        # #555 【P1-5】set → list 変換
        aliases = {lang: list(alias_set) for lang, alias_set in aliases_sets.items()}

        multilang_data.append({
            "item_qid": qid,
            "labels_json": json.dumps(labels, ensure_ascii=False) if labels else None,
            "descriptions_json": json.dumps(descriptions, ensure_ascii=False) if descriptions else None,
            "aliases_json": json.dumps(aliases, ensure_ascii=False) if aliases else None,
        })

    # #555 【P1-4】failed QIDs をログ出力（永続化は将来対応）
    if failed_qids:
        logger.error("Multilang fetch failed for %d QIDs: %s", len(failed_qids), ",".join(failed_qids))
        logger.info("TODO: Persist failed_qids to BigQuery/GCS for retry in next run")

    return multilang_data


def parse_qid_list(concatenated: str) -> Optional[List[str]]:
    """
    #555 【設計】"http://www.wikidata.org/entity/Q123||..." を ["Q123", ...] に変換
    （origin/cuisineのGROUP_CONCAT用に残す）
    
    Args:
        concatenated: SPARQL の GROUP_CONCAT 結果
        
    Returns:
        QID のリスト
    """
    if not concatenated:
        return None
    
    qids = []
    for item in concatenated.split("||"):
        if "/entity/" in item:
            qid = item.split("/")[-1]
            if qid.startswith("Q") and qid not in qids:
                qids.append(qid)

    return qids if qids else None


def resolve_commons_url(image_raw: str) -> Optional[str]:
    """
    #543 【設計】Wikimedia Commons URL を実体 URL に変換
    
    Args:
        image_raw: 元の画像 URL（例: "http://commons.wikimedia.org/wiki/Special:FilePath/Example.jpg"）
        
    Returns:
        実体 URL（例: "https://upload.wikimedia.org/wikipedia/commons/..."）
    """
    if not image_raw:
        return None
    
    try:
        # #543 【設計】FilePath 形式の場合はそのまま https に変換して返す
        if "Special:FilePath" in image_raw:
            return image_raw.replace("http://", "https://")
        
        # #543 【設計】ファイル名を抽出
        filename = None
        if "/File:" in image_raw:
            filename = image_raw.split("/File:")[-1]
        elif "/wiki/" in image_raw:
            filename = image_raw.split("/")[-1]
        
        if not filename:
            return None
        
        # #543 【設計】URL デコード（%20 などを戻す）
        filename = urllib.parse.unquote(filename)
        
        # #543 【設計】スペースをアンダースコアに変換（Commons の規則）
        filename = filename.replace(" ", "_")
        
        # #543 【設計】MD5 ハッシュを計算（Commons の URL 構造に必要）
        import hashlib
        md5_hash = hashlib.md5(filename.encode('utf-8')).hexdigest()
        
        # #543 【設計】upload.wikimedia.org 形式に変換
        # 例: https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.jpg
        return f"https://upload.wikimedia.org/wikipedia/commons/{md5_hash[0]}/{md5_hash[0:2]}/{urllib.parse.quote(filename)}"
    except Exception as e:
        logger.warning(f"Failed to resolve Commons URL: {image_raw}, error: {e}")
        return None


def truncate_string(value: Optional[str], max_length: int) -> Optional[str]:
    """
    【設計】文字列を指定文字数で切り詰める
    
    Args:
        value: 切り詰め対象の文字列
        max_length: 最大文字数
        
    Returns:
        切り詰め後の文字列（max_length以下）
    """
    if value is None:
        return None
    if len(value) <= max_length:
        return value
    return value[:max_length]


def truncate_multilang_field(field_value: Optional[str], max_length: int) -> Tuple[Optional[str], int]:
    """
    【設計】多言語JSONフィールド（labels_json, descriptions_json）を切り詰める
    
    Args:
        field_value: JSON文字列
        max_length: 最大文字数
        
    Returns:
        (切り詰め後のJSON文字列, 切り詰めた言語数)
    """
    if field_value is None or len(field_value) <= max_length:
        return field_value, 0
    
    try:
        data = json.loads(field_value)
        if not isinstance(data, dict):
            # dict以外の場合は単純切り詰め
            return truncate_string(field_value, max_length), 1
        
        truncated_count = 0
        truncated_data = {}
        
        for lang, text in data.items():
            if isinstance(text, str) and len(text) > max_length:
                truncated_data[lang] = text[:max_length]
                truncated_count += 1
            else:
                truncated_data[lang] = text
        
        result_json = json.dumps(truncated_data, ensure_ascii=False)
        # JSON全体がmax_lengthを超える場合は、言語を削減
        if len(result_json) > max_length:
            # 優先言語順に保持（en, ja, その他）
            priority_langs = ["en", "ja", "ar", "es", "fr", "hi", "ko", "zh"]
            limited_data = {}
            # 【設計】JSON最小サイズ（空のオブジェクト"{}"）から開始
            MIN_JSON_SIZE = len('{}')
            current_size = MIN_JSON_SIZE
            
            for lang in priority_langs:
                if lang in truncated_data:
                    # 【設計】JSON エスケープを考慮したサイズ見積もり（安全マージン 20%）
                    # 形式: "lang":"value", の概算（エスケープで最大1.2倍に膨らむ可能性）
                    lang_entry_size = int(len(f'"{lang}":"{truncated_data[lang]}",') * 1.2)
                    if current_size + lang_entry_size > max_length:
                        truncated_count += 1
                        continue
                    limited_data[lang] = truncated_data[lang]
                    current_size += lang_entry_size
            
            # 優先言語以外も可能な限り追加
            for lang, text in truncated_data.items():
                if lang not in limited_data:
                    lang_entry_size = int(len(f'"{lang}":"{text}",') * 1.2)
                    if current_size + lang_entry_size > max_length:
                        truncated_count += 1
                        continue
                    limited_data[lang] = text
                    current_size += lang_entry_size
            
            result_json = json.dumps(limited_data, ensure_ascii=False)
        
        return result_json, truncated_count
    except Exception as e:
        logger.warning(f"Failed to parse multilang field, using simple truncate: {e}")
        return truncate_string(field_value, max_length), 1


def truncate_aliases_field(field_value: Optional[str], max_length: int, max_count: int) -> Tuple[Optional[str], int, int]:
    """
    【設計】aliases_jsonフィールドを切り詰める（要素数制限 + 各要素の文字数制限）
    
    Args:
        field_value: JSON文字列（形式: {"lang": ["alias1", "alias2", ...]}）
        max_length: 各要素の最大文字数
        max_count: 各言語あたりの最大要素数
        
    Returns:
        (切り詰め後のJSON文字列, 切り詰めた要素数, 切り詰めた文字数)
    """
    if field_value is None:
        return None, 0, 0
    
    try:
        data = json.loads(field_value)
        if not isinstance(data, dict):
            # dict以外の場合は単純切り詰め
            return truncate_string(field_value, max_length), 0, 1
        
        truncated_elements = 0
        truncated_strings = 0
        truncated_data = {}
        
        for lang, aliases in data.items():
            if not isinstance(aliases, list):
                truncated_data[lang] = aliases
                continue
            
            # 要素数制限
            if len(aliases) > max_count:
                aliases = aliases[:max_count]
                truncated_elements += len(data[lang]) - max_count
            
            # 各要素の文字数制限
            truncated_aliases = []
            for alias in aliases:
                if isinstance(alias, str) and len(alias) > max_length:
                    truncated_aliases.append(alias[:max_length])
                    truncated_strings += 1
                else:
                    truncated_aliases.append(alias)
            
            truncated_data[lang] = truncated_aliases
        
        result_json = json.dumps(truncated_data, ensure_ascii=False)
        return result_json, truncated_elements, truncated_strings
    except Exception as e:
        logger.warning(f"Failed to parse aliases field, using simple truncate: {e}")
        return truncate_string(field_value, max_length), 0, 1


def apply_truncation(core_data: List[Dict]) -> Dict[str, int]:
    """
    【設計】core_dataの全フィールドに文字数制限を適用
    
    Args:
        core_data: core情報のリスト（in-placeで変更される）
        
    Returns:
        切り詰め統計の辞書
    """
    stats = {
        "label_ja": 0,
        "label_en": 0,
        "desc_ja": 0,
        "desc_en": 0,
        "labels_json": 0,
        "descriptions_json": 0,
        "aliases_json_elements": 0,
        "aliases_json_strings": 0,
        "sitelinks_json": 0,
        "image_url": 0,
    }
    
    for item in core_data:
        # 単純文字列フィールド
        for field in ["label_ja", "label_en", "desc_ja", "desc_en", "image_url"]:
            original = item.get(field)
            if original and len(original) > MAX_STRING_LENGTH:
                item[field] = truncate_string(original, MAX_STRING_LENGTH)
                stats[field] += 1
        
        # 多言語JSONフィールド
        for field in ["labels_json", "descriptions_json", "sitelinks_json"]:
            original = item.get(field)
            if original:
                truncated, count = truncate_multilang_field(original, MAX_STRING_LENGTH)
                if count > 0:
                    item[field] = truncated
                    stats[field] += count
        
        # aliases_json（特殊処理）
        original_aliases = item.get("aliases_json")
        if original_aliases:
            truncated, elem_count, str_count = truncate_aliases_field(
                original_aliases, MAX_STRING_LENGTH, MAX_ALIASES_COUNT
            )
            if elem_count > 0 or str_count > 0:
                item["aliases_json"] = truncated
                stats["aliases_json_elements"] += elem_count
                stats["aliases_json_strings"] += str_count
    
    return stats


def load_core_data_to_bigquery(
    bq_loader: BigQueryLoader,
    core_data: List[Dict]
) -> None:
    """
    【設計】core データを Load Job（JSONL）で一時テーブルに流し込む
    
    変更点：
    - insertAll（insert_rows_json）から Load Job に移行
    - 事前に文字列フィールドを truncate（10,000文字制限）
    - JSONL形式で一時ファイルに書き出し、load_table_from_file でロード
    
    Args:
        bq_loader: BigQuery ローダー
        core_data: core 情報のリスト
    """
    if not core_data:
        logger.warning("No core data to load")
        return
    
    # 【設計】truncate 処理を適用
    logger.info(f"Applying truncation to {len(core_data)} items...")
    truncate_stats = apply_truncation(core_data)
    
    # 【設計】truncate統計をログ出力
    if any(truncate_stats.values()):
        logger.info("Truncation statistics:")
        for field, count in truncate_stats.items():
            if count > 0:
                logger.info(f"  {field}: {count} items truncated")
    else:
        logger.info("No truncation needed")
    
    temp_table_id = f"{bq_loader.dataset_ref}.temp_core_data"
    logger.info(f"Creating temp table: {temp_table_id}")
    
    # #543 【設計】既存の一時テーブルを削除
    try:
        bq_loader.client.delete_table(temp_table_id)
        logger.info(f"Deleted existing temp table: {temp_table_id}")
    except Exception:
        pass
    
    # #543 【設計】一時テーブルを作成
    schema = [
        bigquery.SchemaField("item_qid", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("label_ja", "STRING", mode="NULLABLE"),
        bigquery.SchemaField("label_en", "STRING", mode="NULLABLE"),
        bigquery.SchemaField("desc_ja", "STRING", mode="NULLABLE"),
        bigquery.SchemaField("desc_en", "STRING", mode="NULLABLE"),
        bigquery.SchemaField("labels_json", "STRING", mode="NULLABLE"),
        bigquery.SchemaField("descriptions_json", "STRING", mode="NULLABLE"),
        bigquery.SchemaField("aliases_json", "STRING", mode="NULLABLE"),
        bigquery.SchemaField("sitelinks_json", "STRING", mode="NULLABLE"),
        bigquery.SchemaField("origin_qids", "STRING", mode="REPEATED"),
        bigquery.SchemaField("cuisine_qids", "STRING", mode="REPEATED"),
        bigquery.SchemaField("image_url", "STRING", mode="NULLABLE"),
    ]
    temp_table = bigquery.Table(temp_table_id, schema=schema)
    bq_loader.client.create_table(temp_table)
    logger.info(f"Created temp table: {temp_table_id}")
    
    # 【設計】JSONL形式で一時ファイルに書き出し
    temp_file = None
    try:
        # 一時ファイル作成（削除は自動で行われない設定）
        temp_file = tempfile.NamedTemporaryFile(
            mode='w',
            encoding='utf-8',
            suffix='.jsonl',
            delete=False
        )
        temp_file_path = temp_file.name
        
        logger.info(f"Writing {len(core_data)} items to JSONL file: {temp_file_path}")
        
        for item in core_data:
            row = {
                "item_qid": item["item_qid"],
                "label_ja": item.get("label_ja"),
                "label_en": item.get("label_en"),
                "desc_ja": item.get("desc_ja"),
                "desc_en": item.get("desc_en"),
                "labels_json": item.get("labels_json"),
                "descriptions_json": item.get("descriptions_json"),
                "aliases_json": item.get("aliases_json"),
                "sitelinks_json": item.get("sitelinks_json"),
                "origin_qids": item.get("origin_qids") or [],
                "cuisine_qids": item.get("cuisine_qids") or [],
                "image_url": item.get("image_url"),
            }
            # JSONL形式：1行1JSONオブジェクト
            temp_file.write(json.dumps(row, ensure_ascii=False) + '\n')
        
        temp_file.close()
        
        file_size_mb = os.path.getsize(temp_file_path) / (1024 * 1024)
        logger.info(f"JSONL file written: {file_size_mb:.2f} MB")
        
        # 【設計】Load Job でデータをロード
        logger.info(f"Loading data from JSONL file to {temp_table_id}...")
        
        job_config = bigquery.LoadJobConfig(
            source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            schema=schema,
            write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
        )
        
        with open(temp_file_path, 'rb') as source_file:
            load_job = bq_loader.client.load_table_from_file(
                source_file,
                temp_table_id,
                job_config=job_config
            )
        
        # ジョブ完了を待機
        load_job.result()
        
        # 【設計】ロード結果を確認
        destination_table = bq_loader.client.get_table(temp_table_id)
        logger.info(f"Loaded {destination_table.num_rows} rows to temp table")
        
        # 【設計】エラーがあればログ出力
        if load_job.errors:
            logger.error(f"Load job errors: {load_job.errors}")
            raise Exception(f"Load job completed with errors: {load_job.errors}")
        
    except Exception as e:
        logger.error(f"Failed to load core data via Load Job: {e}")
        # 【設計】ジョブエラーの詳細を取得
        if 'load_job' in locals() and load_job.errors:
            for error in load_job.errors:
                logger.error(f"  Job error: {error}")
        raise
    finally:
        # 【設計】一時ファイルを削除
        if temp_file is not None and 'temp_file_path' in locals() and os.path.exists(temp_file_path):
            try:
                os.unlink(temp_file_path)
                logger.info(f"Deleted temporary JSONL file: {temp_file_path}")
            except Exception as e:
                logger.warning(f"Failed to delete temporary file {temp_file_path}: {e}")


def merge_core_data(bq_loader: BigQueryLoader) -> None:
    """
    #543 【設計】一時テーブルから dish_category_catalog に MERGE する
    
    Args:
        bq_loader: BigQuery ローダー
    """
    temp_table_id = f"{bq_loader.dataset_ref}.temp_core_data"
    target_table_id = f"{bq_loader.dataset_ref}.dish_category_catalog"
    
    logger.info(f"Merging core data from {temp_table_id} to {target_table_id}...")
    
    # #543 【設計】MERGE: 既存行は更新、新規行は挿入
    sql = f"""
    MERGE `{target_table_id}` T
    USING `{temp_table_id}` S
    ON T.item_qid = S.item_qid
    WHEN MATCHED THEN
      UPDATE SET
        label_ja = S.label_ja,
        label_en = S.label_en,
        desc_ja = S.desc_ja,
        desc_en = S.desc_en,
        labels_json = S.labels_json,
        descriptions_json = S.descriptions_json,
        aliases_json = S.aliases_json,
        sitelinks_json = S.sitelinks_json,
        origin_qids = S.origin_qids,
        cuisine_qids = S.cuisine_qids,
        image_url = S.image_url
    WHEN NOT MATCHED THEN
      INSERT (
        item_qid,
        label_ja,
        label_en,
        desc_ja,
        desc_en,
        labels_json,
        descriptions_json,
        aliases_json,
        sitelinks_json,
        origin_qids,
        cuisine_qids,
        image_url
      )
      VALUES (
        S.item_qid,
        S.label_ja,
        S.label_en,
        S.desc_ja,
        S.desc_en,
        S.labels_json,
        S.descriptions_json,
        S.aliases_json,
        S.sitelinks_json,
        S.origin_qids,
        S.cuisine_qids,
        S.image_url
      )
    """
    
    affected = bq_loader.execute_dml(sql)
    logger.info(f"Merged {affected} rows")
    
    # #543 【設計】一時テーブルを削除
    bq_loader.client.delete_table(temp_table_id)
    logger.info(f"Deleted temp table: {temp_table_id}")


def delete_stale_entries(
    bq_loader: BigQueryLoader,
    candidate_qids: List[str]
) -> None:
    """
    【設計】candidates に存在しない item_qid を dish_category_catalog から削除
    
    変更点：
    - insertAll（insert_rows_json）から Load Job に移行
    
    Args:
        bq_loader: BigQuery ローダー
        candidate_qids: 対象 QID のリスト
    """
    if not candidate_qids:
        logger.warning("No candidate QIDs, skipping delete")
        return
    
    # 【設計】一時テーブルに candidates を投入
    temp_table_id = f"{bq_loader.dataset_ref}.temp_candidates"
    logger.info(f"Creating temp table: {temp_table_id}")
    
    try:
        bq_loader.client.delete_table(temp_table_id)
    except Exception:
        pass
    
    schema = [
        bigquery.SchemaField("item_qid", "STRING", mode="REQUIRED"),
    ]
    temp_table = bigquery.Table(temp_table_id, schema=schema)
    bq_loader.client.create_table(temp_table)
    
    # 【設計】JSONL形式で一時ファイルに書き出し
    temp_file = None
    try:
        temp_file = tempfile.NamedTemporaryFile(
            mode='w',
            encoding='utf-8',
            suffix='.jsonl',
            delete=False
        )
        temp_file_path = temp_file.name
        
        logger.info(f"Writing {len(candidate_qids)} candidates to JSONL file: {temp_file_path}")
        
        for qid in candidate_qids:
            row = {"item_qid": qid}
            temp_file.write(json.dumps(row, ensure_ascii=False) + '\n')
        
        temp_file.close()
        
        file_size_mb = os.path.getsize(temp_file_path) / (1024 * 1024)
        logger.info(f"JSONL file written: {file_size_mb:.2f} MB")
        
        # 【設計】Load Job でデータをロード
        logger.info(f"Loading candidates from JSONL file to {temp_table_id}...")
        
        job_config = bigquery.LoadJobConfig(
            source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            schema=schema,
            write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
        )
        
        with open(temp_file_path, 'rb') as source_file:
            load_job = bq_loader.client.load_table_from_file(
                source_file,
                temp_table_id,
                job_config=job_config
            )
        
        load_job.result()
        
        destination_table = bq_loader.client.get_table(temp_table_id)
        logger.info(f"Loaded {destination_table.num_rows} candidates to temp table")
        
        if load_job.errors:
            logger.error(f"Load job errors: {load_job.errors}")
            raise Exception(f"Load job completed with errors: {load_job.errors}")
        
    except Exception as e:
        logger.error(f"Failed to load candidates via Load Job: {e}")
        if 'load_job' in locals() and load_job.errors:
            for error in load_job.errors:
                logger.error(f"  Job error: {error}")
        raise
    finally:
        if temp_file is not None and 'temp_file_path' in locals() and os.path.exists(temp_file_path):
            try:
                os.unlink(temp_file_path)
                logger.info(f"Deleted temporary JSONL file: {temp_file_path}")
            except Exception as e:
                logger.warning(f"Failed to delete temporary file {temp_file_path}: {e}")
    
    # 【設計】candidates に存在しない行を削除
    target_table_id = f"{bq_loader.dataset_ref}.dish_category_catalog"
    sql = f"""
    DELETE FROM `{target_table_id}`
    WHERE item_qid NOT IN (
      SELECT item_qid FROM `{temp_table_id}`
    )
    """
    
    affected = bq_loader.execute_dml(sql)
    logger.info(f"Deleted {affected} stale entries")
    
    # 【設計】一時テーブルを削除
    bq_loader.client.delete_table(temp_table_id)
    logger.info(f"Deleted temp table: {temp_table_id}")


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Refresh dish_category_catalog core data")
    parser.add_argument(
        "--missing-only",
        action="store_true",
        help=(
            "Fetch Wikidata core data only for candidate QIDs that are not yet "
            "present in dish_category_catalog. Existing catalog rows are not refreshed."
        ),
    )
    parser.add_argument(
        "--skip-delete-stale",
        action="store_true",
        help=(
            "Skip deletion of catalog rows that are no longer in candidates. "
            "Useful for narrow missing-only backfills."
        ),
    )
    args = parser.parse_args()

    logger.info("=" * 80)
    logger.info("Refreshing dish_category_catalog (core)")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    if args.missing_only:
        logger.info("Mode: missing-only (existing catalog rows will not be fetched/refreshed)")
    if args.skip_delete_stale:
        logger.info("Stale delete: skipped by --skip-delete-stale")
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # Wikidata クライアント初期化
    wikidata_client = WikidataClient()
    
    # 1. 候補 QID を取得
    logger.info("Step 1: Fetching candidate QIDs...")
    candidate_qids = fetch_candidate_qids(bq_loader)
    
    if not candidate_qids:
        logger.warning("No candidate QIDs found, exiting")
        return

    fetch_qids = candidate_qids
    if args.missing_only:
        fetch_qids = filter_missing_catalog_qids(bq_loader, candidate_qids)
        if not fetch_qids:
            logger.info("No missing catalog QIDs found. Nothing to fetch or merge.")
            if not args.skip_delete_stale:
                logger.info("Step 5: Deleting stale entries...")
                delete_stale_entries(bq_loader, candidate_qids)
            return
    
    # 2. SPARQL でバッチ分割して core 情報を取得
    logger.info(f"Step 2: Fetching core data in batches (batch_size={BATCH_SIZE})...")
    all_core_data = []
    
    for i in range(0, len(fetch_qids), BATCH_SIZE):
        batch = fetch_qids[i:i + BATCH_SIZE]
        logger.info(f"Fetching batch {i // BATCH_SIZE + 1}/{(len(fetch_qids) + BATCH_SIZE - 1) // BATCH_SIZE} ({len(batch)} items)...")
        
        core_data = fetch_core_data_batch(wikidata_client, batch)
        all_core_data.extend(core_data)
        
        # #555 【バグ】504対策：Rate limit を厳しめに（1→2秒）
        time.sleep(2)
    
    logger.info(f"Fetched {len(all_core_data)} core data items")
    
    # 3. BigQuery に流し込み
    logger.info("Step 3: Loading core data to BigQuery...")
    load_core_data_to_bigquery(bq_loader, all_core_data)
    
    # 4. MERGE
    logger.info("Step 4: Merging core data...")
    merge_core_data(bq_loader)
    
    # 5. 過分の削除
    if args.skip_delete_stale:
        logger.info("Step 5: Skipping stale entry deletion (--skip-delete-stale)")
    else:
        logger.info("Step 5: Deleting stale entries...")
        delete_stale_entries(bq_loader, candidate_qids)
    
    logger.info("=" * 80)
    logger.info("✅ Successfully refreshed dish_category_catalog (core)")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Next step:")
    logger.info("  python3 3_3_refresh_dish_category_catalog_graph.py")


if __name__ == "__main__":
    main()
