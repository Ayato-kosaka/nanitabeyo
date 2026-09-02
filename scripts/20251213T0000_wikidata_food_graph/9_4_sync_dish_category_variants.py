#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
9_4_sync_dish_category_variants.py

【目的】
BigQuery → PostgreSQL: dish_category_variants テーブルの同期

【処理内容】
1. BigQuery から dish_category_variant_catalog を取得
2. PostgreSQL へ UPSERT

【使用方法】
# 通常実行
python3 9_4_sync_dish_category_variants.py --schema dev

# ドライラン
python3 9_4_sync_dish_category_variants.py --schema dev --dry-run

【環境変数】
- DATABASE_URL: PostgreSQL 接続文字列（必須）
"""

import sys
import os
import argparse
import logging
from datetime import datetime, timezone
from typing import List, Dict
from pathlib import Path
from psycopg2.extras import execute_values

# プロジェクトルートのモジュールをインポート
sys.path.append(str(Path(__file__).parent))
from loader_bigquery import BigQueryLoader
from sync_common import (
    PostgreSQLConnection, SyncStats, backup_table_to_gcs,
    write_dry_run_summary, GCP_PROJECT, BQ_DATASET
)

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def classify_app_row_conflicts(
    app_rows: List[tuple],
    bq_qid_by_surface: Dict[str, str],
) -> tuple:
    """
    アプリ由来行のうち «本当の衝突» と «同じ写像» を分ける。

    このチェックの目的は「アプリが管理している写像を BQ が **別の QID で** 上書きする」
    ことの防止である。同じ表記が同じ QID を指しているなら写像は一致しており、
    止める理由が無い。

    #1748 実際に本番でこれを踏んだ（2026-08-31）。`4_1` 側で label_ja が
    「豚カツ」→「とんかつ」へ変わり、BQ に `'とんかつ' -> Q1142841` が現れた。
    本番にはアプリ由来の `'とんかつ' -> Q1142841`（source = wikidata_qid_match）が
    既にあり、**同じ QID なのに**同期全体が例外で止まった
    （dev には該当行が無いので通り、本番だけ落ちた）。

    ⚠️ 同じ QID でも **UPSERT の対象からは外す**こと。呼び出し側の
       `ON CONFLICT DO UPDATE` は `source` も上書きするので、通してしまうと
       アプリ側が持っている出所（wikidata_qid_match 等）が BQ の source へ
       書き換わり、«この行は誰が入れたのか» が失われる。写像が同じなら、
       アプリ由来行をそのまま残すのが正しい。

    Args:
        app_rows: アプリ由来行の (surface_form, dish_category_id, source) のリスト
        bq_qid_by_surface: BQ 側の surface_form -> dish_category_id

    Returns:
        (別の QID を指していた行のリスト, 同じ QID だった surface_form の集合)
    """
    real_conflicts = []
    same_mapping_surfaces = set()
    for surface_form, app_qid, source in app_rows:
        if bq_qid_by_surface.get(surface_form) == app_qid:
            same_mapping_surfaces.add(surface_form)
        else:
            real_conflicts.append((surface_form, app_qid, source))
    return real_conflicts, same_mapping_surfaces


def sync_dish_category_variants(
    loader: BigQueryLoader,
    pg_conn: PostgreSQLConnection,
    dry_run: bool = False
) -> SyncStats:
    """
    dish_category_variants を同期（UPSERT）
    - 旧BQ由来(source in BQ_SOURCES)のみ削除
    - アプリ由来(sourceは削除・上書きしない)
    - (dish_category_id, surface_form) で UPSERT（要: Postgres側にUNIQUE）
    - surface_form 単体 UNIQUE に引っかかるケースは例外で落ちる（要件どおり）
    """
    import re
    from collections import defaultdict
    stats = SyncStats()

    BQ_SOURCES = ["wikidata-label", "kata2hira", "romaji", "canonical-label-en"]

    # 1) BQ取得
    query = f"""
        SELECT dish_category_id, surface_form, source, created_at
        FROM `{loader.dataset_ref}.dish_category_variant_catalog`
        WHERE dish_category_id IS NOT NULL
          AND surface_form IS NOT NULL
          AND surface_form != ''
    """
    rows = list(loader.client.query(query).result())
    variants = [{
        "dish_category_id": r.dish_category_id,
        "surface_form": r.surface_form,
        "source": r.source or "bq_generated",
        "created_at": r.created_at,
    } for r in rows]

    logger.info(f"Fetched {len(variants)} variants from BigQuery")
    if not variants:
        return stats

    values = [(v["dish_category_id"], v["surface_form"], v["source"], v["created_at"]) for v in variants]

    if dry_run:
        logger.info(f"[DRY-RUN] Would delete old BQ sources and sync {len(values)} rows")
        stats.inserted = len(values)
        return stats

    try:
        pg_conn.cursor.execute("BEGIN")

        # 2) 旧BQ由来だけ削除
        pg_conn.cursor.execute(
            "DELETE FROM dish_category_variants WHERE source = ANY(%s)",
            (BQ_SOURCES,)
        )
        stats.deleted = pg_conn.cursor.rowcount
        logger.info(f"Deleted {stats.deleted} old BQ variants")

        # 3) アプリ由来と衝突する surface_form があるか事前チェック
        #    - BQ側 surface_form を一時的に配列にして問い合わせ（量が多いので本当は一時テーブルがより良いが、まずは素直に）
        bq_surface_forms = list({v["surface_form"] for v in variants})
        pg_conn.cursor.execute(
            """
            SELECT surface_form, dish_category_id, source
            FROM dish_category_variants
            WHERE source <> ALL(%s)
              AND surface_form = ANY(%s)
            """,
            (BQ_SOURCES, bq_surface_forms)
        )
        app_rows = pg_conn.cursor.fetchall()

        bq_qid_by_surface = {v["surface_form"]: v["dish_category_id"] for v in variants}
        real_conflicts, same_mapping_surfaces = classify_app_row_conflicts(
            app_rows, bq_qid_by_surface
        )

        if same_mapping_surfaces:
            logger.info(
                f"アプリ由来と同じ写像だった表記を BQ 側の投入対象から外します: "
                f"{len(same_mapping_surfaces)} 件"
            )
            for sf in sorted(same_mapping_surfaces)[:20]:
                logger.info(f"  [KEEP-APP-ROW] '{sf}' -> {bq_qid_by_surface[sf]}（写像は同じ）")

        if real_conflicts:
            # 先頭だけログ
            for sf, dcid, src in real_conflicts[:20]:
                logger.error(
                    f"[CONFLICT] BQ surface_form conflicts with APP row: surface_form='{sf}', "
                    f"dish_category_id={dcid}(APP) vs {bq_qid_by_surface.get(sf)}(BQ), source={src}"
                )
            raise ValueError(f"BQ conflicts with APP-managed variants: {len(real_conflicts)} surface_forms")

        # 同じ写像だった表記は、アプリ由来行を残すために BQ 側から落とす
        if same_mapping_surfaces:
            values = [v for v in values if v[1] not in same_mapping_surfaces]

        # 4) ここまで来たら「アプリ由来とは（別の QID で）衝突しない」ことが保証されたので、BQ勝ちUPSERTしてOK
        insert_sql = """
            INSERT INTO dish_category_variants (
                dish_category_id, surface_form, source, created_at
            ) VALUES %s
            ON CONFLICT (surface_form)
            DO UPDATE SET
                dish_category_id = EXCLUDED.dish_category_id,
                source = EXCLUDED.source,
                created_at = EXCLUDED.created_at
        """
        execute_values(pg_conn.cursor, insert_sql, values)
        pg_conn.conn.commit()
        stats.inserted = len(values)
        return stats

    except Exception:
        pg_conn.conn.rollback()
        raise


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(
        description='Sync dish_category_variants from BigQuery to PostgreSQL'
    )
    parser.add_argument(
        '--schema',
        required=True,
        choices=['public', 'dev'],
        help='PostgreSQL schema (public or dev)'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Dry run mode (no actual changes)'
    )
    parser.add_argument(
        '--output-dir',
        default='/tmp',
        help='Output directory for dry-run summary'
    )
    parser.add_argument(
        '--yes',
        action='store_true',
        help='Skip the interactive (y/N) confirmation for --schema public. '
             'Required for non-interactive environments (e.g. GitHub Actions), '
             'where input() would otherwise raise EOFError. Has no effect for --schema dev.'
    )

    args = parser.parse_args()
    
    # 環境変数チェック
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        sys.exit(1)
    
    logger.info("=" * 80)
    logger.info("BigQuery → PostgreSQL Sync: dish_category_variants")
    logger.info("=" * 80)
    logger.info(f"Schema: {args.schema}")
    logger.info(f"Dry-run: {args.dry_run}")
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    
    # PostgreSQL 接続初期化
    pg_conn = PostgreSQLConnection(database_url, args.schema)
    
    # スキーマバリデーション（--yes 指定時のみ public の対話確認をスキップする）
    if not pg_conn.validate_schema(require_confirmation=not args.yes):
        sys.exit(1)
    
    # BigQuery Loader 初期化
    loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    try:
        # PostgreSQL に接続
        pg_conn.connect()
        
        # バックアップ（dry-run でない場合）
        if not args.dry_run:
            backup_path = backup_table_to_gcs(pg_conn, "dish_category_variants", args.dry_run)
            if not backup_path:
                raise RuntimeError("Backup failed twice; aborting sync for safety.")
            if backup_path:
                logger.info(f"✅ Backup completed: {backup_path}")
        
        # 同期処理
        stats = sync_dish_category_variants(loader, pg_conn, args.dry_run)
        
        # 統計出力
        if args.dry_run:
            write_dry_run_summary(stats, "dish_category_variants", args.output_dir)
        else:
            stats.print_summary("dish_category_variants")
        
        logger.info("=" * 80)
        logger.info("✅ Sync completed successfully")
        logger.info("=" * 80)
        
    except Exception as e:
        logger.error(f"❌ Sync failed: {e}", exc_info=True)
        sys.exit(1)
    finally:
        pg_conn.close()


if __name__ == "__main__":
    main()
