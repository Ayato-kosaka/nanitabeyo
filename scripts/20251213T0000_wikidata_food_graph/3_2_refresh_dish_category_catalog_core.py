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
"""

import sys
import json
import logging
import time
import urllib.parse
from pathlib import Path
from typing import List, Dict, Optional
from google.cloud import bigquery

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
BATCH_SIZE = 300  # #543 【設計】SPARQL タイムアウト対策：バッチサイズ


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


def fetch_core_data_batch(
    wikidata_client: WikidataClient,
    qids: List[str]
) -> List[Dict]:
    """
    #543 【設計】SPARQL で core 情報を一括取得
    
    Args:
        wikidata_client: Wikidata クライアント
        qids: 取得対象の QID リスト
        
    Returns:
        core 情報のリスト
    """
    if not qids:
        return []
    
    values_clause = " ".join([f"wd:{qid}" for qid in qids])
    
    # #543 【設計】SPARQL で labels, descriptions, aliases, sitelinks, origin, cuisine, image を取得
    query = f"""
    SELECT DISTINCT ?item
      (GROUP_CONCAT(DISTINCT CONCAT(LANG(?label), ":", STR(?label)); separator="|") AS ?labels)
      (GROUP_CONCAT(DISTINCT CONCAT(LANG(?desc), ":", STR(?desc)); separator="|") AS ?descriptions)
      (GROUP_CONCAT(DISTINCT CONCAT(LANG(?alias), ":", STR(?alias)); separator="|") AS ?aliases)
      (GROUP_CONCAT(DISTINCT CONCAT(?sitelink, ":", ?article); separator="|") AS ?sitelinks)
      (GROUP_CONCAT(DISTINCT STR(?origin); separator="|") AS ?origins)
      (GROUP_CONCAT(DISTINCT STR(?cuisine); separator="|") AS ?cuisines)
      (SAMPLE(?image) AS ?image_sample)
    WHERE {{
      VALUES ?item {{ {values_clause} }}
      
      OPTIONAL {{ ?item rdfs:label ?label }}
      OPTIONAL {{ ?item schema:description ?desc }}
      OPTIONAL {{ ?item skos:altLabel ?alias }}
      OPTIONAL {{
        ?article schema:about ?item ;
                 schema:isPartOf ?sitelink .
        FILTER(STRSTARTS(STR(?sitelink), "https://"))
      }}
      OPTIONAL {{ ?item wdt:P495 ?origin }}
      OPTIONAL {{ ?item wdt:P2012 ?cuisine }}
      OPTIONAL {{ ?item wdt:P18 ?image }}
    }}
    GROUP BY ?item
    """
    
    results = wikidata_client.execute_query(query)
    
    core_data = []
    for result in results:
        item_uri = result.get("item", {}).get("value", "")
        item_qid = item_uri.split("/")[-1] if item_uri else None
        
        if not item_qid:
            continue
        
        # #543 【設計】labels/descriptions/aliases を JSON 化
        labels_json = parse_lang_value_list(result.get("labels", {}).get("value", ""))
        descriptions_json = parse_lang_value_list(result.get("descriptions", {}).get("value", ""))
        aliases_json = parse_lang_value_list(result.get("aliases", {}).get("value", ""))
        sitelinks_json = parse_sitelink_list(result.get("sitelinks", {}).get("value", ""))
        
        # #543 【設計】origin/cuisine を QID 配列化
        origin_qids = parse_qid_list(result.get("origins", {}).get("value", ""))
        cuisine_qids = parse_qid_list(result.get("cuisines", {}).get("value", ""))
        
        # #543 【設計】image_url を Commons URL から実体 URL に変換
        image_raw = result.get("image_sample", {}).get("value", "")
        image_url = resolve_commons_url(image_raw) if image_raw else None
        
        core_data.append({
            "item_qid": item_qid,
            "labels_json": json.dumps(labels_json, ensure_ascii=False) if labels_json else None,
            "descriptions_json": json.dumps(descriptions_json, ensure_ascii=False) if descriptions_json else None,
            "aliases_json": json.dumps(aliases_json, ensure_ascii=False) if aliases_json else None,
            "sitelinks_json": json.dumps(sitelinks_json, ensure_ascii=False) if sitelinks_json else None,
            "origin_qids": origin_qids,
            "cuisine_qids": cuisine_qids,
            "image_url": image_url,
        })
    
    return core_data


def parse_lang_value_list(concatenated: str) -> Optional[Dict[str, str]]:
    """
    #543 【設計】"lang:value|lang:value|..." を {"lang": "value", ...} に変換
    
    Args:
        concatenated: SPARQL の GROUP_CONCAT 結果
        
    Returns:
        言語コード → 値の辞書
    """
    if not concatenated:
        return None
    
    result = {}
    for item in concatenated.split("|"):
        if ":" not in item:
            continue
        lang, value = item.split(":", 1)
        # #543 【設計】同じ言語コードが複数ある場合は最初のものを採用
        if lang not in result:
            result[lang] = value
    
    return result if result else None


def parse_sitelink_list(concatenated: str) -> Optional[Dict[str, str]]:
    """
    #543 【設計】"site:article|site:article|..." を {"site": "article", ...} に変換
    
    Args:
        concatenated: SPARQL の GROUP_CONCAT 結果
        
    Returns:
        サイト → 記事名の辞書
    """
    if not concatenated:
        return None
    
    result = {}
    for item in concatenated.split("|"):
        if ":" not in item:
            continue
        # #543 【設計】"https://en.wikipedia.org:Article_Name" の形式
        parts = item.split(":", 2)
        if len(parts) >= 3:
            site = f"{parts[0]}:{parts[1]}"
            article = parts[2]
            result[site] = article
    
    return result if result else None


def parse_qid_list(concatenated: str) -> Optional[List[str]]:
    """
    #543 【設計】"http://www.wikidata.org/entity/Q123|..." を ["Q123", ...] に変換
    
    Args:
        concatenated: SPARQL の GROUP_CONCAT 結果
        
    Returns:
        QID のリスト
    """
    if not concatenated:
        return None
    
    qids = []
    for item in concatenated.split("|"):
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
    
    # #543 【設計】FilePath 形式の場合はそのまま返す（実体 URL に近い）
    if "Special:FilePath" in image_raw:
        # #543 【設計】http → https に変換
        return image_raw.replace("http://", "https://")
    
    # #543 【設計】ファイル名を抽出して upload.wikimedia.org 形式に変換
    # 例: "http://commons.wikimedia.org/wiki/File:Example.jpg" → filename = "Example.jpg"
    if "/File:" in image_raw or "/wiki/" in image_raw:
        filename = image_raw.split("/")[-1]
        if filename.startswith("File:"):
            filename = filename[5:]  # "File:" を除去
        
        # #543 【設計】URL エンコード
        filename_encoded = urllib.parse.quote(filename)
        
        # #543 【設計】upload.wikimedia.org 形式に変換（簡易版、正確な MD5 ハッシュは不要）
        return f"https://upload.wikimedia.org/wikipedia/commons/thumb/{filename_encoded}"
    
    return None


def load_core_data_to_bigquery(
    bq_loader: BigQueryLoader,
    core_data: List[Dict]
) -> None:
    """
    #543 【設計】core データを一時テーブル経由で BigQuery に流し込む
    
    Args:
        bq_loader: BigQuery ローダー
        core_data: core 情報のリスト
    """
    if not core_data:
        logger.warning("No core data to load")
        return
    
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
    
    # #543 【設計】データをロード
    rows_to_insert = []
    for item in core_data:
        rows_to_insert.append({
            "item_qid": item["item_qid"],
            "labels_json": item.get("labels_json"),
            "descriptions_json": item.get("descriptions_json"),
            "aliases_json": item.get("aliases_json"),
            "sitelinks_json": item.get("sitelinks_json"),
            "origin_qids": item.get("origin_qids") or [],
            "cuisine_qids": item.get("cuisine_qids") or [],
            "image_url": item.get("image_url"),
        })
    
    # #543 【設計】バッチでインサート
    batch_size = 10000
    for i in range(0, len(rows_to_insert), batch_size):
        batch = rows_to_insert[i:i + batch_size]
        errors = bq_loader.client.insert_rows_json(temp_table_id, batch)
        if errors:
            logger.error(f"Errors occurred while loading core data: {errors}")
            raise Exception(f"Failed to load core data: {errors}")
        logger.info(f"Loaded batch {i // batch_size + 1}/{(len(rows_to_insert) + batch_size - 1) // batch_size}")
    
    logger.info(f"Loaded {len(core_data)} core data items to temp table")


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
    #543 【設計】candidates に存在しない item_qid を dish_category_catalog から削除
    
    Args:
        bq_loader: BigQuery ローダー
        candidate_qids: 対象 QID のリスト
    """
    if not candidate_qids:
        logger.warning("No candidate QIDs, skipping delete")
        return
    
    # #543 【設計】一時テーブルに candidates を投入
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
    
    rows_to_insert = [{"item_qid": qid} for qid in candidate_qids]
    
    # #543 【設計】バッチでインサート
    batch_size = 10000
    for i in range(0, len(rows_to_insert), batch_size):
        batch = rows_to_insert[i:i + batch_size]
        errors = bq_loader.client.insert_rows_json(temp_table_id, batch)
        if errors:
            logger.error(f"Errors occurred while loading candidates: {errors}")
            raise Exception(f"Failed to load candidates: {errors}")
    
    logger.info(f"Loaded {len(candidate_qids)} candidates to temp table")
    
    # #543 【設計】candidates に存在しない行を削除
    target_table_id = f"{bq_loader.dataset_ref}.dish_category_catalog"
    sql = f"""
    DELETE FROM `{target_table_id}`
    WHERE item_qid NOT IN (
      SELECT item_qid FROM `{temp_table_id}`
    )
    """
    
    affected = bq_loader.execute_dml(sql)
    logger.info(f"Deleted {affected} stale entries")
    
    # #543 【設計】一時テーブルを削除
    bq_loader.client.delete_table(temp_table_id)
    logger.info(f"Deleted temp table: {temp_table_id}")


def main():
    """メイン処理"""
    logger.info("=" * 80)
    logger.info("Refreshing dish_category_catalog (core)")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    
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
    
    # 2. SPARQL でバッチ分割して core 情報を取得
    logger.info(f"Step 2: Fetching core data in batches (batch_size={BATCH_SIZE})...")
    all_core_data = []
    
    for i in range(0, len(candidate_qids), BATCH_SIZE):
        batch = candidate_qids[i:i + BATCH_SIZE]
        logger.info(f"Fetching batch {i // BATCH_SIZE + 1}/{(len(candidate_qids) + BATCH_SIZE - 1) // BATCH_SIZE} ({len(batch)} items)...")
        
        core_data = fetch_core_data_batch(wikidata_client, batch)
        all_core_data.extend(core_data)
        
        # #543 【設計】Rate limit 対策
        time.sleep(1)
    
    logger.info(f"Fetched {len(all_core_data)} core data items")
    
    # 3. BigQuery に流し込み
    logger.info("Step 3: Loading core data to BigQuery...")
    load_core_data_to_bigquery(bq_loader, all_core_data)
    
    # 4. MERGE
    logger.info("Step 4: Merging core data...")
    merge_core_data(bq_loader)
    
    # 5. 過分の削除
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
