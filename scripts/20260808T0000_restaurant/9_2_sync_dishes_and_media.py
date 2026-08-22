#!/usr/bin/env python3
"""dish/dish_media catalogを既存PostgreSQL構造へ非破壊で同期する。"""

from __future__ import annotations

import argparse
import csv
import logging
import tempfile
from pathlib import Path
from typing import Any

from google.cloud import bigquery

from pg_sync_common import (
    SyncStats,
    assert_quality_gate_passed,
    backup_table_to_gcs,
    connect_postgres,
    new_sync_id,
    write_sync_log,
)
from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now

LOGGER = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="dish/dish_media catalogをPostgreSQLへ同期します"
    )
    parser.add_argument("--run-id")
    parser.add_argument("--schema", choices=["dev", "public"], required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--allow-public", action="store_true")
    parser.add_argument("--skip-backup", action="store_true")
    return parser.parse_args()


def csv_value(value: Any) -> Any:
    return r"\N" if value is None else value


def export_query(
    pipeline: BigQueryPipeline,
    run_id: str,
    query: str,
    path: Path,
) -> int:
    config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("run_id", "STRING", run_id)]
    )
    rows = pipeline.client.query(
        query, job_config=config, location=pipeline.config.region
    ).result(page_size=10_000)
    count = 0
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream, lineterminator="\n")
        for row in rows:
            writer.writerow(csv_value(value) for value in row.values())
            count += 1
    return count


def copy_file(connection: Any, table: str, path: Path) -> None:
    with (
        path.open("r", encoding="utf-8", newline="") as stream,
        connection.cursor() as cursor,
    ):
        cursor.copy_expert(
            f"COPY {table} FROM STDIN WITH (FORMAT CSV, NULL '\\N')",
            stream,
        )


def create_staging(connection: Any) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            CREATE TEMP TABLE dish_sync_staging (
              google_place_id TEXT NOT NULL,
              category_id TEXT NOT NULL,
              name TEXT NOT NULL
            ) ON COMMIT DROP;

            CREATE TEMP TABLE media_sync_staging (
              dish_media_id UUID NOT NULL,
              google_place_id TEXT NOT NULL,
              category_id TEXT NOT NULL,
              provider TEXT NOT NULL,
              external_content_id TEXT NOT NULL,
              canonical_url TEXT NOT NULL,
              embed_html TEXT NOT NULL,
              thumbnail_url TEXT,
              media_type TEXT NOT NULL,
              published_at TIMESTAMPTZ,
              availability_status TEXT NOT NULL,
              rights_basis TEXT NOT NULL,
              terms_version TEXT,
              last_verified_at TIMESTAMPTZ NOT NULL,
              row_hash TEXT NOT NULL
            ) ON COMMIT DROP;

            CREATE TEMP TABLE media_state_sync_staging (
              dish_media_id UUID NOT NULL,
              provider TEXT NOT NULL,
              external_content_id TEXT NOT NULL,
              availability_status TEXT NOT NULL,
              last_verified_at TIMESTAMPTZ NOT NULL
            ) ON COMMIT DROP;
            """
        )


def validate_staging(connection: Any) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT COUNT(*)
            FROM media_sync_staging media
            LEFT JOIN restaurants restaurant
              ON restaurant.google_place_id = media.google_place_id
            LEFT JOIN dishes dish
              ON dish.restaurant_id = restaurant.id
             AND dish.category_id = media.category_id
            WHERE restaurant.id IS NULL
            """
        )
        missing_restaurants = cursor.fetchone()[0]
        if missing_restaurants:
            raise RuntimeError(
                f"mediaが参照するrestaurantがPGに{missing_restaurants}件ありません。9_1を先に実行してください。"
            )

        cursor.execute(
            """
            SELECT COUNT(*)
            FROM dish_sync_staging staging
            LEFT JOIN dish_categories category ON category.id = staging.category_id
            WHERE category.id IS NULL
            """
        )
        missing_categories = cursor.fetchone()[0]
        if missing_categories:
            raise RuntimeError(
                f"dishが参照するdish_categoryがPGに{missing_categories}件ありません。料理提案同期を先に実行してください。"
            )

        # UUID v5の衝突確率は極小だが、ユーザー投稿へ外部metadataを誤接続する事故は
        # 確率に頼らず明示的に止める。
        cursor.execute(
            """
            SELECT COUNT(*)
            FROM media_sync_staging staging
            JOIN dish_media media ON media.id = staging.dish_media_id
            LEFT JOIN dish_media_external_embeddings external
              ON external.dish_media_id = media.id
            WHERE external.dish_media_id IS NULL
            """
        )
        collisions = cursor.fetchone()[0]
        if collisions:
            raise RuntimeError(
                f"既存user dish_mediaとのUUID衝突が{collisions}件あります"
            )


def calculate_stats(connection: Any) -> SyncStats:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT
              COUNT(*) FILTER (WHERE external.dish_media_id IS NULL),
              COUNT(*) FILTER (
                WHERE external.dish_media_id IS NOT NULL
                  AND external.source_row_hash IS DISTINCT FROM staging.row_hash
              ),
              COUNT(*) FILTER (
                WHERE external.dish_media_id IS NOT NULL
                  AND external.source_row_hash IS NOT DISTINCT FROM staging.row_hash
              )
            FROM media_sync_staging staging
            LEFT JOIN dish_media_external_embeddings external
              ON external.dish_media_id = staging.dish_media_id
            """
        )
        inserted, updated, skipped = cursor.fetchone()
    return SyncStats(inserted or 0, updated or 0, skipped or 0)


def apply_sync(connection: Any) -> None:
    with connection.cursor() as cursor:
        # 既存のユーザー/Google経由dishが同じ店舗×categoryにある場合は再利用し、
        # 名前やoriginを上書きしない。BQ生成dishだけは再実行で名称を更新する。
        cursor.execute(
            """
            INSERT INTO dishes AS target (
              restaurant_id, category_id, name, data_origin, synced_at
            )
            SELECT
              restaurant.id,
              staging.category_id,
              staging.name,
              'restaurant_recommendation',
              CURRENT_TIMESTAMP
            FROM dish_sync_staging staging
            JOIN restaurants restaurant USING (google_place_id)
            ON CONFLICT (restaurant_id, category_id) DO UPDATE SET
              name = CASE
                WHEN target.data_origin = 'restaurant_recommendation'
                  THEN EXCLUDED.name
                ELSE target.name
              END,
              synced_at = CURRENT_TIMESTAMP
            """
        )

        # dish_media本体は既存の検索・reaction・impression FKを再利用する互換層。
        # URL生成はAPIが子テーブルの存在で分岐するため、canonical_urlをGCS pathとして
        # 解釈してはならない。
        cursor.execute(
            """
            INSERT INTO dish_media AS target (
              id, dish_id, user_id, media_path, media_type, thumbnail_path,
              created_at, updated_at, lock_no, video_duration_ms,
              media_processing_status, thumbnail_processing_status, render_type
            )
            SELECT
              staging.dish_media_id,
              dish.id,
              NULL,
              staging.canonical_url,
              staging.media_type,
              COALESCE(staging.thumbnail_url, staging.canonical_url),
              COALESCE(staging.published_at, CURRENT_TIMESTAMP),
              CURRENT_TIMESTAMP,
              0,
              NULL,
              'completed',
              'completed',
              -- #1273 §40 この経路が作るのは全て外部埋め込み行。列の既定値は 'stored' なので
              -- ここで明示しないと、API が子テーブルから導出する renderType と列が食い違う
              -- (migration 20260814T0000 のコメント参照)。
              'external_embed'
            FROM media_sync_staging staging
            JOIN restaurants restaurant USING (google_place_id)
            JOIN dishes dish
              ON dish.restaurant_id = restaurant.id
             AND dish.category_id = staging.category_id
            ON CONFLICT (id) DO UPDATE SET
              dish_id = EXCLUDED.dish_id,
              media_path = EXCLUDED.media_path,
              media_type = EXCLUDED.media_type,
              thumbnail_path = EXCLUDED.thumbnail_path,
              render_type = EXCLUDED.render_type,
              updated_at = CURRENT_TIMESTAMP
            """
        )

        cursor.execute(
            """
            INSERT INTO dish_media_external_embeddings AS target (
              dish_media_id, dish_id, provider, external_content_id, canonical_url,
              embed_html, thumbnail_url, availability_status, rights_basis,
              terms_version, published_at, last_verified_at, source_row_hash,
              created_at, updated_at
            )
            SELECT
              staging.dish_media_id, media.dish_id,
              staging.provider, staging.external_content_id, staging.canonical_url,
              staging.embed_html, staging.thumbnail_url, staging.availability_status,
              staging.rights_basis, staging.terms_version, staging.published_at,
              staging.last_verified_at, staging.row_hash,
              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            FROM media_sync_staging staging
            -- #1375 との統合で dish_id が NOT NULL になった（自然キーが
            -- (provider, external_content_id, dish_id) へ広がり、«同じ投稿 × 別の料理» を
            -- 取り込めるようにするため）。値は dish_media から引く。
            -- 複合 FK (dish_media_id, dish_id) → dish_media (id, dish_id) があるので、
            -- ここで別の値を入れることは構造的にできない。
            JOIN dish_media media
              ON media.id = staging.dish_media_id
            ON CONFLICT (dish_media_id) DO UPDATE SET
              dish_id = EXCLUDED.dish_id,
              provider = EXCLUDED.provider,
              external_content_id = EXCLUDED.external_content_id,
              canonical_url = EXCLUDED.canonical_url,
              embed_html = EXCLUDED.embed_html,
              thumbnail_url = EXCLUDED.thumbnail_url,
              availability_status = EXCLUDED.availability_status,
              rights_basis = EXCLUDED.rights_basis,
              terms_version = EXCLUDED.terms_version,
              published_at = EXCLUDED.published_at,
              last_verified_at = EXCLUDED.last_verified_at,
              source_row_hash = EXCLUDED.source_row_hash,
              updated_at = CURRENT_TIMESTAMP
            """
        )

        # 最新観測がdeleted/private等なら即時に検索対象から外す。content自体はavailableでも
        # restaurant/category/rights gateを満たさなくなった行はineligibleとして止める。
        cursor.execute(
            """
            UPDATE dish_media_external_embeddings external
            SET
              availability_status = CASE
                WHEN state.availability_status = 'available'
                     AND media.dish_media_id IS NULL THEN 'ineligible'
                ELSE state.availability_status
              END,
              last_verified_at = state.last_verified_at,
              updated_at = CURRENT_TIMESTAMP
            FROM media_state_sync_staging state
            LEFT JOIN media_sync_staging media
              ON media.dish_media_id = state.dish_media_id
            WHERE external.provider = state.provider
              AND external.external_content_id = state.external_content_id
            """
        )


def make_temp_paths(count: int) -> list[Path]:
    paths: list[Path] = []
    for _ in range(count):
        with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as stream:
            paths.append(Path(stream.name))
    return paths


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()
    assert_quality_gate_passed(pipeline, run_id)
    sync_id = new_sync_id()
    started_at = utc_now()
    stats = SyncStats()
    connection = None
    dish_path, media_path, state_path = make_temp_paths(3)
    try:
        dish_count = export_query(
            pipeline,
            run_id,
            f"""
              SELECT google_place_id, category_id, name
              FROM `{pipeline.dataset_ref}.dish_catalog`
              WHERE run_id = @run_id
              ORDER BY google_place_id, category_id
            """,
            dish_path,
        )
        media_count = export_query(
            pipeline,
            run_id,
            f"""
              SELECT
                dish_media_id, google_place_id, category_id, provider,
                external_content_id, canonical_url, embed_html, thumbnail_url,
                media_type, published_at, availability_status, rights_basis,
                terms_version, last_verified_at, row_hash
              FROM `{pipeline.dataset_ref}.dish_media_catalog`
              WHERE run_id = @run_id
              ORDER BY dish_media_id
            """,
            media_path,
        )
        state_count = export_query(
            pipeline,
            run_id,
            f"""
              SELECT dish_media_id, provider, external_content_id,
                     availability_status, last_verified_at
              FROM `{pipeline.dataset_ref}.dish_media_external_state_catalog`
              WHERE run_id = @run_id
              ORDER BY dish_media_id
            """,
            state_path,
        )
        if media_count > 0 and dish_count == 0:
            raise RuntimeError(
                "dish_mediaは存在しますがdish catalogが0件です。4_2の生成結果を確認してください"
            )
        if media_count == 0 and state_count == 0:
            raise RuntimeError(
                "dish_media/state catalogがともに0件です。対象観測期間を確認してください"
            )
        if media_count == 0:
            LOGGER.warning(
                "公開可能mediaは0件です。既存媒体のdeleted/private/ineligible状態だけ同期します"
            )

        # 3本のCSV export中にcatalogが再生成されていないことを再確認する。
        assert_quality_gate_passed(pipeline, run_id)
        connection = connect_postgres(args.schema, allow_public=args.allow_public)
        if not args.dry_run and not args.skip_backup:
            for table in ("dishes", "dish_media", "dish_media_external_embeddings"):
                backup_table_to_gcs(connection, args.schema, table, run_id=run_id)
        create_staging(connection)
        copy_file(connection, "dish_sync_staging", dish_path)
        copy_file(connection, "media_sync_staging", media_path)
        if state_count:
            copy_file(connection, "media_state_sync_staging", state_path)
        validate_staging(connection)
        stats = calculate_stats(connection)
        LOGGER.info(
            "external media sync plan: insert=%d update=%d skip=%d",
            stats.inserted,
            stats.updated,
            stats.skipped,
        )
        # dry-runも本番と同じDMLを流し、FK/unique/check constraintまで確認して
        # transaction全体をrollbackする。
        apply_sync(connection)
        if args.dry_run:
            connection.rollback()
        else:
            connection.commit()
        write_sync_log(
            pipeline,
            run_id=run_id,
            sync_id=sync_id,
            schema=args.schema,
            target_table="dishes,dish_media,dish_media_external_embeddings",
            dry_run=args.dry_run,
            stats=stats,
            status="succeeded",
            started_at=started_at,
        )
    except Exception as error:
        if connection:
            connection.rollback()
        write_sync_log(
            pipeline,
            run_id=run_id,
            sync_id=sync_id,
            schema=args.schema,
            target_table="dishes,dish_media,dish_media_external_embeddings",
            dry_run=args.dry_run,
            stats=stats,
            status="failed",
            started_at=started_at,
            error_message=str(error),
        )
        raise
    finally:
        for path in (dish_path, media_path, state_path):
            path.unlink(missing_ok=True)
        if connection:
            connection.close()


if __name__ == "__main__":
    main()
