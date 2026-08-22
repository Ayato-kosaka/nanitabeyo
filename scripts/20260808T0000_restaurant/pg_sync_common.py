"""restaurant_recommendation のBigQuery→PostgreSQL同期共通処理。"""

from __future__ import annotations

import logging
import os
import tempfile
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import psycopg2
from google.cloud import storage
from psycopg2 import sql
from psycopg2.extensions import connection as PgConnection

from pipeline_common import BigQueryPipeline, utc_now

LOGGER = logging.getLogger(__name__)
ALLOWED_SCHEMAS = {"dev", "public"}
# 8_1の現行ERROR check数。将来checkを追加することは許すが、部分insertでこれを
# 下回るvalidationは同期判定に使わない。
MIN_ERROR_CHECK_COUNT = 17


@dataclass
class SyncStats:
    inserted: int = 0
    updated: int = 0
    skipped: int = 0


def connect_postgres(schema: str, *, allow_public: bool) -> PgConnection:
    if schema not in ALLOWED_SCHEMAS:
        raise ValueError("PostgreSQL schemaはdev/publicだけです")
    if schema == "public" and not allow_public:
        raise ValueError("public同期には事故防止の --allow-public が必要です")
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise ValueError("DATABASE_URL が必要です")
    connection = psycopg2.connect(
        database_url,
        connect_timeout=15,
        keepalives=1,
        keepalives_idle=30,
        keepalives_interval=10,
        keepalives_count=5,
    )
    connection.autocommit = False
    with connection.cursor() as cursor:
        cursor.execute(
            sql.SQL("SET search_path TO {}, public").format(sql.Identifier(schema))
        )
        # 手動実行でも二つのterminalから同じschemaへ同時publishされ得る。
        # transaction advisory lockで9_1/9_2を直列化し、staging判定後の競合を防ぐ。
        cursor.execute(
            "SELECT pg_advisory_xact_lock(hashtext(%s))",
            (f"restaurant_recommendation_sync:{schema}",),
        )
    return connection


def assert_quality_gate_passed(
    pipeline: BigQueryPipeline, run_id: str, *, lookback_days: int = 30
) -> None:
    """最新8_1実行のERRORが全件PASSしたことを強制する。"""

    query = f"""
      WITH validation_candidates AS (
        SELECT validation_id, MAX(checked_at) AS checked_at
        FROM `{pipeline.dataset_ref}.restaurant_quality_results`
        WHERE DATE(checked_at) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL @lookback_days DAY)
                                   AND CURRENT_DATE()
          AND run_id = @run_id
          AND validation_id IS NOT NULL
        GROUP BY validation_id
      ),
      latest_validation AS (
        SELECT validation_id, checked_at
        FROM validation_candidates
        QUALIFY ROW_NUMBER() OVER (
          ORDER BY checked_at DESC, validation_id DESC
        ) = 1
      ),
      latest_results AS (
        SELECT q.*
        FROM `{pipeline.dataset_ref}.restaurant_quality_results` q
        INNER JOIN latest_validation USING (validation_id, checked_at)
        WHERE DATE(q.checked_at) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL @lookback_days DAY)
                                     AND CURRENT_DATE()
          AND q.run_id = @run_id
      ),
      catalog_state AS (
        SELECT MAX(built_at) AS built_at
        FROM (
          SELECT MAX(built_at) AS built_at
          FROM `{pipeline.dataset_ref}.restaurant_catalog` WHERE run_id = @run_id
          UNION ALL
          SELECT MAX(built_at)
          FROM `{pipeline.dataset_ref}.dish_catalog` WHERE run_id = @run_id
          UNION ALL
          SELECT MAX(built_at)
          FROM `{pipeline.dataset_ref}.dish_media_catalog` WHERE run_id = @run_id
          UNION ALL
          SELECT MAX(built_at)
          FROM `{pipeline.dataset_ref}.dish_media_external_state_catalog` WHERE run_id = @run_id
          UNION ALL
          SELECT MAX(calculated_at)
          FROM `{pipeline.dataset_ref}.dish_media_coverage_catalog` WHERE run_id = @run_id
        )
      )
      SELECT
        ANY_VALUE(latest_validation.validation_id) AS validation_id,
        ANY_VALUE(latest_validation.checked_at) AS checked_at,
        ANY_VALUE(catalog_state.built_at) AS catalog_built_at,
        COUNT(DISTINCT IF(
          latest_results.severity = 'ERROR', latest_results.check_name, NULL
        )) AS error_check_count,
        COUNTIF(latest_results.severity = 'ERROR' AND NOT latest_results.passed)
          AS failed_error_count
      FROM latest_validation
      CROSS JOIN catalog_state
      LEFT JOIN latest_results USING (validation_id, checked_at)
    """
    from google.cloud import bigquery

    row = next(
        iter(
            pipeline.execute(
                query,
                [
                    bigquery.ScalarQueryParameter("run_id", "STRING", run_id),
                    bigquery.ScalarQueryParameter(
                        "lookback_days", "INT64", lookback_days
                    ),
                ],
            )
        )
    )
    if row.validation_id is None or row.error_check_count < MIN_ERROR_CHECK_COUNT:
        raise RuntimeError("8_1_validate_catalogs.py の完全なERROR検証結果がありません")
    if row.failed_error_count:
        raise RuntimeError(
            f"品質ゲートに未解決ERRORが{row.failed_error_count}件あります"
        )
    if row.catalog_built_at is None or row.checked_at < row.catalog_built_at:
        raise RuntimeError(
            "品質ゲート後にcatalogが更新されています。8_1_validate_catalogs.pyを再実行してください"
        )


def backup_table_to_gcs(
    connection: PgConnection,
    schema: str,
    table_name: str,
    *,
    run_id: str,
) -> str:
    """COPYを一時fileへstreamし、同期前snapshotをGCSへ保存する。

    fetchallは全国restaurantをメモリへ載せるため使わない。backupが失敗した場合は
    callerが同期を中止し、更新前データを復元できない状態で進めない。
    """

    bucket_name = os.getenv("GCS_BACKUP_BUCKET", "nanitabeyo-private")
    prefix = os.getenv("GCS_BACKUP_PREFIX", "system/PostgreSQL/csv_export")
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    object_name = f"{prefix}/{timestamp}/{schema}/{table_name}-{run_id}.csv"
    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as stream:
        path = Path(stream.name)
    try:
        copy_sql = sql.SQL(
            "COPY (SELECT * FROM {}.{}) TO STDOUT WITH (FORMAT CSV, HEADER TRUE)"
        ).format(sql.Identifier(schema), sql.Identifier(table_name))
        with (
            path.open("w", encoding="utf-8", newline="") as output,
            connection.cursor() as cursor,
        ):
            cursor.copy_expert(copy_sql.as_string(connection), output)
        client = storage.Client(project=os.getenv("GCP_PROJECT", "food-scroll"))
        blob = client.bucket(bucket_name).blob(object_name)
        blob.upload_from_filename(str(path), content_type="text/csv")
        uri = f"gs://{bucket_name}/{object_name}"
        LOGGER.info("同期前backupを保存しました: %s", uri)
        return uri
    finally:
        path.unlink(missing_ok=True)


def write_sync_log(
    pipeline: BigQueryPipeline,
    *,
    run_id: str,
    sync_id: str,
    schema: str,
    target_table: str,
    dry_run: bool,
    stats: SyncStats,
    status: str,
    started_at: datetime,
    error_message: str | None = None,
) -> None:
    row = {
        "run_id": run_id,
        "sync_id": sync_id,
        "pg_schema": schema,
        "target_table": target_table,
        "dry_run": dry_run,
        "inserted_count": stats.inserted,
        "updated_count": stats.updated,
        "skipped_count": stats.skipped,
        "status": status,
        "error_message": error_message[:16_000] if error_message else None,
        "started_at": started_at.isoformat(),
        "finished_at": utc_now().isoformat(),
    }
    errors = pipeline.client.insert_rows_json(
        pipeline.table("restaurant_pg_sync_logs"), [row], row_ids=[sync_id]
    )
    if errors:
        LOGGER.error("PG sync logの保存に失敗しました: %s", errors)


def new_sync_id() -> str:
    return str(uuid.uuid4())
