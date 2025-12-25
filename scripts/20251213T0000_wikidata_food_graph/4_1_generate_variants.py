#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
4_1_generate_variants.py

【目的】
BigQuery の dish_category_catalog から variants を生成し、
dish_category_variant_catalog に格納する。

【処理内容】
1. dish_category_catalog から label_en, labels_json を取得
2. variants を正規化・重複排除して生成
   - generate_variants.py のロジックを BigQuery データに適用
   - canonical 優先
   - 日本語は kata2hira, romaji 派生を生成
   - グローバル一意化（canonical優先 → source priority + QID番号で競合解決）
3. dish_category_variant_catalog にロード（CREATE OR REPLACE）

【使用方法】
python3 4_1_generate_variants.py

【注意】
- Wikidata への新規アクセスは行わない
- 既存の dish_category_catalog データのみを使用
- テーブルは CREATE OR REPLACE で再生成される
- generate_variants.py の設計思想に従う（4 sources のみ、alias 除外）
"""

import sys
import json
import logging
import unicodedata
from datetime import datetime, timezone
from typing import List, Dict, Set, Tuple
from pathlib import Path
from collections import defaultdict
from google.cloud import bigquery

# 日本語処理用ライブラリ（必須）
import jaconv
from pykakasi import kakasi

_kks = kakasi()

# プロジェクトルートのモジュールをインポート
sys.path.append(str(Path(__file__).parent))
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


def norm_key(s: str) -> str:
    """
    文字列を正規化（NFKC → 空白圧縮 → 小文字化）
    
    Args:
        s: 正規化する文字列
    
    Returns:
        正規化された文字列
    """
    if not s:
        return ""
    s = unicodedata.normalize("NFKC", s)
    s = " ".join(s.split())
    return s.lower()


def is_bad(s: str) -> bool:
    """
    空または無意味な文字列かどうかを判定
    
    Args:
        s: 判定する文字列
    
    Returns:
        True: 空または無意味, False: 有効
    """
    return (not s) or (s == "") or (s in {"null", "\\n", "\\N"})


def qid_num(qid: str) -> int:
    """
    QID から数値を抽出（競合解決用）
    
    Args:
        qid: Wikidata QID (例: "Q12345")
    
    Returns:
        QID の数値部分、抽出失敗時は大きな数値
    """
    try:
        return int(qid.rsplit("Q", 1)[1])
    except Exception:
        return 10**12


def to_romaji(text: str) -> str:
    """
    日本語をローマ字に変換
    
    Args:
        text: 日本語テキスト
    
    Returns:
        ローマ字変換結果
    """
    parts = _kks.convert(text)
    return "".join(p.get("hepburn", "") for p in parts).replace(" ", "")


def extract_variants_from_json(
    item_qid: str,
    label_en: str,
    labels_json: str
) -> List[Dict]:
    """
    JSON から variants を抽出
    generate_variants.py のロジックを適用（labels のみ、aliases 除外）
    
    Args:
        item_qid: dish_category QID
        label_en: 英語ラベル
        labels_json: 全言語ラベルの JSON 文字列
    
    Returns:
        candidates のリスト [{"qid": ..., "surface": ..., "source": ..., "canonical": bool}, ...]
    """
    candidates = []
    seen_per_qid = set()  # (qid, surface) の重複を防ぐ
    
    def add_candidate(raw: str, source: str, canonical: bool = False):
        """候補を追加（QID内重複抑止）"""
        s = norm_key(raw)
        if is_bad(s):
            return
        key = (item_qid, s)
        if key in seen_per_qid:
            return
        seen_per_qid.add(key)
        candidates.append({
            "qid": item_qid,
            "surface": s,
            "source": source,
            "canonical": canonical
        })
    
    # 1) label_en を canonical として追加
    if label_en and not is_bad(label_en):
        add_candidate(label_en, "canonical-label-en", canonical=True)
    
    # 2) labels_json からラベルを追加（日本語は派生も生成）
    # NOTE: aliases は generate_variants.py で扱っていないため除外
    if labels_json:
        try:
            labels = json.loads(labels_json)
            for lang, label_val in labels.items():
                if isinstance(label_val, str) and not is_bad(label_val):
                    add_candidate(label_val, "wikidata-label")
                    
                    # 日本語の場合は派生形を生成
                    if lang == "ja":
                        hira = jaconv.kata2hira(label_val)
                        add_candidate(hira, "kata2hira")
                        add_candidate(to_romaji(hira), "romaji")
        except (json.JSONDecodeError, TypeError) as e:
            logger.warning(f"Failed to parse labels_json for {item_qid}: {e}")
    
    return candidates


def generate_variants(loader: BigQueryLoader) -> None:
    """
    dish_category_catalog から variants を生成し、
    dish_category_variant_catalog に格納
    generate_variants.py のロジックを適用（canonical優先、グローバル一意化）
    
    Args:
        loader: BigQueryLoader インスタンス
    """
    logger.info("=" * 80)
    logger.info("Generating variants from dish_category_catalog")
    logger.info("=" * 80)
    
    # 1) dish_category_catalog からデータ取得
    # NOTE: aliases_json は取得せず、labels のみを使用（generate_variants.py に準拠）
    query = f"""
        SELECT
            item_qid,
            label_en,
            labels_json
        FROM `{loader.dataset_ref}.dish_category_catalog`
        WHERE item_qid IS NOT NULL
    """
    
    logger.info("Fetching dish_category_catalog data...")
    job = loader.client.query(query)
    rows = list(job.result())
    logger.info(f"Fetched {len(rows)} categories")
    
    # 2) 全カテゴリから candidates を生成
    all_candidates = []
    stats = {
        "total_categories": len(rows),
        "total_candidates": 0,
        "skipped_empty": 0
    }
    
    for row in rows:
        item_qid = row.item_qid
        label_en = row.label_en or ""
        labels_json = row.labels_json or ""
        
        candidates = extract_variants_from_json(
            item_qid, label_en, labels_json
        )
        
        all_candidates.extend(candidates)
        stats["total_candidates"] += len(candidates)
    
    logger.info(f"Generated {stats['total_candidates']} candidates from {stats['total_categories']} categories")
    
    # 3) グローバル一意化（canonical 優先 → 非canonicalは競合解決）
    # generate_variants.py の source_priority に厳密に従う（4 sources のみ）
    source_priority = {
        "wikidata-label": 0,
        "kata2hira": 1,
        "romaji": 2,
        "canonical-label-en": -1
    }
    
    winners = {}  # surface -> candidate_index
    
    # まず canonical を確定（surface が衝突したら qid_num が小さい方を採用）
    for i, c in enumerate(all_candidates):
        if not c["canonical"]:
            continue

        surf = c["surface"]
        if surf not in winners:
            winners[surf] = i
            continue

        # winners には canonical しか入っていない段階なので qid_num が小さい方を採用
        cur_idx = winners[surf]
        cur = all_candidates[cur_idx]
        if qid_num(c["qid"]) < qid_num(cur["qid"]):
            winners[surf] = i
    
    # 非canonical を surface ごとにグループ化
    by_surface = defaultdict(list)
    for i, c in enumerate(all_candidates):
        if not c["canonical"]:
            by_surface[c["surface"]].append(i)
    
    def rank(idx: int):
        """競合解決用のランク付け（source priority + QID番号）"""
        c = all_candidates[idx]
        return (source_priority.get(c["source"], 9), qid_num(c["qid"]))
    
    # 非canonical は空いていれば採用（競合時は優先度で解決）
    collide_skipped = 0
    for surf, idxs in by_surface.items():
        if surf in winners:
            # canonical が既に確定しているので全てスキップ
            collide_skipped += len(idxs)
            continue
        # 複数候補があれば source priority + QID で決定
        winners[surf] = min(idxs, key=rank)
        collide_skipped += (len(idxs) - 1)
    
    logger.info(f"Global deduplication - kept: {len(winners)}, collide_skipped: {collide_skipped}")
    
    # 4) 出力用データ準備
    final_variants = []
    for surf, idx in winners.items():
        c = all_candidates[idx]
        # 念のため最終防衛（空が紛れていたら捨てる）
        if is_bad(c["surface"]):
            continue
        final_variants.append({
            "dish_category_id": c["qid"],
            "surface_form": c["surface"],
            "source": c["source"],
            "created_at": datetime.now(timezone.utc).isoformat()
        })
    
    logger.info(f"Final variants: {len(final_variants)}")
    
    # 5) dish_category_variant_catalog に格納（CREATE OR REPLACE）
    if not final_variants:
        logger.warning("No variants to load")
        return
    
    table_id = f"{loader.dataset_ref}.dish_category_variant_catalog"
    logger.info(f"Loading {len(final_variants)} variants to {table_id}")
    
    # まず既存テーブルを削除して再作成
    delete_sql = f"DROP TABLE IF EXISTS `{table_id}`"
    loader.execute_sql(delete_sql)
    
    # テーブル作成
    create_sql = f"""
        CREATE TABLE `{table_id}` (
            dish_category_id STRING NOT NULL,
            surface_form     STRING NOT NULL,
            source           STRING NOT NULL,
            created_at       TIMESTAMP NOT NULL
        )
    """
    loader.execute_sql(create_sql)
    
    # データ挿入
    job_config = bigquery.LoadJobConfig(
        write_disposition="WRITE_APPEND",
        schema=[
            {"name": "dish_category_id", "type": "STRING", "mode": "REQUIRED"},
            {"name": "surface_form", "type": "STRING", "mode": "REQUIRED"},
            {"name": "source", "type": "STRING", "mode": "REQUIRED"},
            {"name": "created_at", "type": "TIMESTAMP", "mode": "REQUIRED"},
        ]
    )
    
    job = loader.client.load_table_from_json(
        final_variants,
        table_id,
        job_config=job_config
    )
    job.result()
    
    logger.info(f"✅ Loaded {len(final_variants)} variants to {table_id}")


def main():
    """メイン処理"""
    logger.info("=" * 80)
    logger.info("BigQuery Variants Generation Script")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    
    # BigQuery Loader 初期化
    loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    try:
        # variants 生成
        generate_variants(loader)
        
        logger.info("=" * 80)
        logger.info("✅ Variants generation completed successfully")
        logger.info("=" * 80)
    except Exception as e:
        logger.error(f"❌ Error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
