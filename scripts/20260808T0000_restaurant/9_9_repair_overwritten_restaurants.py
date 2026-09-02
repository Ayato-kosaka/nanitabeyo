#!/usr/bin/env python3
"""9_1 の同期が上書きしてしまった既存 restaurant を、同期前backupから復元する。

## なぜ必要か

`9_1` の表示値UPDATEには `AND s.existing_restaurant_id IS NULL` というガードが
あり、「既存PG由来の行は上書きしない」ことになっている。しかしこのガードが
見ているのは **catalog を作った時点のスナップショット**である。

  1_2 が dev.restaurants を BigQuery へ写す（= スナップショット取得）
  ... 2_1 〜 8_1 ... （実測で約40時間）
  9_1 が PostgreSQL へ書く

この間に作られた restaurant は、スナップショットに載っていないので
`existing_restaurant_id` が付かない。その店の google_place_id へ open data の
seed が当たると、ガードは「新規行だ」と判断して name / 座標 / image_url /
image_path / address_components / plus_code を open data 値で上書きする。
address_components は `[]`、image_url は `''` になるため、実質的にデータが消える。

2026-08-24 の dev 同期で、これが7行で起きた（staging 571,776行のうち既存行へ
当たったのが2,115行、catalog 側で existing_restaurant_id が付いているのは2,108行）。

## どう直すか

同期の直前に `backup_table_to_gcs` が dev.restaurants の全行を CSV で GCS へ
保存している。「backup に居る = 同期前から存在した」なので、backup と現在値を
突き合わせて表示列が変わっている行を探せば、被害を過不足なく特定できる。
スナップショットや seed を経由して推論する必要がない。

`--mode report` は読み取りだけで差分を出す。`--mode restore` は差分のあった行の
表示列を backup の値へ戻す。provenance列（source_seed_id / source_names /
source_row_hash / synced_at）は触らない。どの seed が当たったかの記録は
残しておきたいためである。
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any

from google.api_core.exceptions import Forbidden
from google.cloud import bigquery, storage

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pg_sync_common import connect_postgres  # noqa: E402
from pipeline_common import BigQueryPipeline, configure_logging  # noqa: E402

LOGGER = logging.getLogger(__name__)

# apply_sync の「表示値」UPDATE が触る列だけを比較・復元の対象にする。
# provenance列は 9_1 が意図して全一致行へ付けるものなので差分に数えない。
DISPLAY_COLUMNS = (
    "name",
    "name_language_code",
    "latitude",
    "longitude",
    "image_url",
    "image_path",
    "address_components",
    "plus_code",
)
JSON_COLUMNS = frozenset({"address_components", "plus_code"})
FLOAT_COLUMNS = frozenset({"latitude", "longitude"})
# restaurants 側で NOT NULL の列。COPY ... FORMAT CSV は NULL も空文字も同じ ""
# として書くため、書き戻すときに «空文字 → NULL» と読み替えると NOT NULL 違反で
# 落ちる（実際に image_url で落ちた）。この集合の列は空文字のまま戻す。
NOT_NULL_COLUMNS = frozenset(
    {"name", "name_language_code", "latitude", "longitude", "image_url", "address_components"}
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="9_1が上書きした既存restaurantをbackupから復元します"
    )
    parser.add_argument("--schema", choices=["dev", "public"], required=True)
    parser.add_argument(
        "--backup-uri",
        help="gs://... 形式の同期前backup。省略時はprefix配下の最新を自動選択",
    )
    parser.add_argument(
        "--mode",
        choices=["identify", "report", "restore"],
        default="identify",
        help=(
            "identify=GCSを使わず被害行を特定するだけ（既定）、"
            "report=backupと突き合わせて差分を出す、restore=backupの値へ戻す"
        ),
    )
    parser.add_argument("--allow-public", action="store_true")
    return parser.parse_args()


def resolve_backup_blob(client: storage.Client, schema: str, uri: str | None) -> Any:
    bucket_name = os.getenv("GCS_BACKUP_BUCKET", "nanitabeyo-private")
    prefix = os.getenv("GCS_BACKUP_PREFIX", "system/PostgreSQL/csv_export")
    if uri:
        if not uri.startswith("gs://"):
            raise ValueError("--backup-uri は gs:// で始めてください")
        bucket_name, _, object_name = uri[len("gs://") :].partition("/")
        blob = client.bucket(bucket_name).get_blob(object_name)
        if blob is None:
            raise ValueError(f"backupが見つかりません: {uri}")
        return blob

    # object名は {prefix}/{YYYYmmdd-HHMMSS}/{schema}/restaurants-{run_id}.csv なので、
    # 名前の辞書順が時刻順になる。最新＝直近の同期の直前状態である。
    #
    # 自動選択には storage.objects.list が要る。9_1 を動かしている WIF の SA は
    # backup の «書き込み» はできても «一覧» はできない（実測で 403）。その場合は
    # 9_1 のログが出している URI を --backup-uri で渡してもらう。
    try:
        candidates = [
            blob
            for blob in client.list_blobs(bucket_name, prefix=prefix)
            if f"/{schema}/restaurants-" in blob.name and blob.name.endswith(".csv")
        ]
    except Forbidden as error:
        # #1595 で backup prefix は managed folder になり、objectViewer が付いた。
        # ただし managed folder 経由の一覧には prefix / delimiter=/ /
        # includeFoldersAsPrefixes=true の3点が要る（README「同期前 backup の
        # 読み戻し権限」）。include_folders_as_prefixes は
        # google-cloud-storage 2.14 以降の引数で、requirements.txt は 2.10.0 を
        # 固定しているため、このクライアントからは一覧できない。
        #
        # 一覧できなくても «URI が分かっていれば» objects.get は通る（追加指定不要）。
        # よってここは «自動選択を諦めて URI を貰う» のが正しい出口である。
        raise RuntimeError(
            "backupの一覧取得が拒否されました。"
            "backup prefix は managed folder なので、一覧には delimiter と "
            "includeFoldersAsPrefixes が必要ですが、"
            "google-cloud-storage 2.10.0（requirements.txt で固定）は "
            "include_folders_as_prefixes を持ちません。"
            "9_1 の実行ログにある «同期前backupを保存しました: gs://...» の URI を "
            "--backup-uri で指定してください（URI が分かっていれば読み出しは通ります）。"
        ) from error
    if not candidates:
        raise ValueError(f"backupが1件も見つかりません: gs://{bucket_name}/{prefix}")
    latest = max(candidates, key=lambda blob: blob.name)
    LOGGER.info("backupを自動選択しました: gs://%s/%s", bucket_name, latest.name)
    return latest


def load_backup(blob: Any) -> dict[str, dict[str, str]]:
    text = blob.download_as_text(encoding="utf-8")
    reader = csv.DictReader(io.StringIO(text))
    missing = [c for c in ("id", *DISPLAY_COLUMNS) if c not in (reader.fieldnames or [])]
    if missing:
        raise ValueError(f"backupに必要な列がありません: {missing}")
    rows = {row["id"]: row for row in reader}
    LOGGER.info("backupを読み込みました: %d行", len(rows))
    return rows


def normalize(column: str, value: Any) -> Any:
    """CSV文字列とPGの値を同じ土俵に載せる。

    COPY ... FORMAT CSV は NULL を空文字として書く。空文字を入れている列
    （image_url）と区別できないが、比較したいのは「変わったかどうか」なので
    両側を同じ規則で潰せば足りる。
    """

    if value is None or value == "":
        return None
    if column in JSON_COLUMNS:
        try:
            # dict/list の順序差で誤検知しないよう、正準化してから比べる。
            parsed = json.loads(value) if isinstance(value, str) else value
            # jsonb の SQL NULL と、JSON リテラルの null を同じものとして扱う。
            # COPY ... FORMAT CSV は jsonb の JSON null を文字列 "null" として書くため、
            # ここを潰さないと «backup="null" / current=None» が全行で差分に見える。
            # 実際、2,462 行中 54 行がこの偽陽性で、本当に壊れた 7 行が埋もれていた。
            if parsed is None:
                return None
            return json.dumps(
                parsed,
                sort_keys=True,
                separators=(",", ":"),
                ensure_ascii=False,
            )
        except (TypeError, ValueError):
            return str(value)
    if column in FLOAT_COLUMNS:
        try:
            return round(float(value), 9)
        except (TypeError, ValueError):
            return str(value)
    return str(value)


def find_damaged(connection: Any, backup: dict[str, dict[str, str]]) -> list[dict]:
    """backupに居る行のうち、表示列が現在値と食い違うものを返す。"""

    columns = ", ".join(DISPLAY_COLUMNS)
    ids = list(backup.keys())
    damaged: list[dict] = []
    with connection.cursor() as cursor:
        # 全件を1文で引く。dev.restaurantsのbackupは数千行規模である。
        cursor.execute(
            f"SELECT id::text, {columns} FROM restaurants WHERE id::text = ANY(%s)",
            (ids,),
        )
        for row in cursor:
            record_id = row[0]
            before = backup[record_id]
            diffs = {}
            for index, column in enumerate(DISPLAY_COLUMNS, start=1):
                old = normalize(column, before[column])
                new = normalize(column, row[index])
                if old != new:
                    diffs[column] = {"backup": old, "current": new}
            if diffs:
                damaged.append({"id": record_id, "diffs": diffs})
    return damaged


def restore(connection: Any, backup: dict[str, dict[str, str]], damaged: list[dict]) -> int:
    assignments = ", ".join(
        f"{column} = %s" if column not in JSON_COLUMNS else f"{column} = %s::jsonb"
        for column in DISPLAY_COLUMNS
    )
    statement = f"UPDATE restaurants SET {assignments} WHERE id = %s::uuid"
    updated = 0
    with connection.cursor() as cursor:
        for entry in damaged:
            before = backup[entry["id"]]
            values = [
                # NOT NULL の列へ None を書くと落ちる。空文字は空文字のまま戻す。
                before[column]
                if (before[column] != "" or column in NOT_NULL_COLUMNS)
                else None
                for column in DISPLAY_COLUMNS
            ]
            cursor.execute(statement, [*values, entry["id"]])
            updated += cursor.rowcount
    return updated


def identify_without_backup(pipeline: BigQueryPipeline, connection: Any, schema: str) -> list[dict]:
    """GCSを使わずに «ガードをすり抜けて上書きされた行» を特定する。

    backup が読めない環境（同期SAはbucketへ書けるが読めない）でも、被害の
    範囲だけは確定させたい。次の3つが同時に成り立つ行がそれである。

      1. 同期に触られた（synced_at が入っている）
      2. 同期より前から存在した（created_at が同期開始より古い）
      3. 1_2 のスナップショットに居ない（＝ catalog 側で
         existing_restaurant_id が付かず、新規行として上書きされた）

    3 だけでは «同期で作られた行» と区別できないので 2 が要る。同期が
    INSERT した行の created_at は DEFAULT now() で同期中の時刻になる。
    """

    sync = next(
        iter(
            pipeline.execute(
                f"""
                SELECT started_at
                FROM `{pipeline.dataset_ref}.restaurant_pg_sync_logs`
                WHERE started_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
                  AND pg_schema = @schema
                  AND target_table = 'restaurants'
                  AND NOT dry_run
                  AND status = 'succeeded'
                ORDER BY started_at DESC
                LIMIT 1
                """,
                [bigquery.ScalarQueryParameter("schema", "STRING", schema)],
            )
        ),
        None,
    )
    if sync is None:
        raise RuntimeError("直近30日に成功した本番同期の記録がありません")
    LOGGER.info("対象の同期: started_at=%s", sync.started_at)

    snapshot_ids = [
        row.source_record_id
        for row in pipeline.execute(
            f"""
            SELECT DISTINCT source_record_id
            FROM `{pipeline.dataset_ref}.restaurant_existing_pg_raw`
            WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
            """
        )
    ]
    LOGGER.info("1_2 スナップショットの行数: %d", len(snapshot_ids))

    columns = ", ".join(DISPLAY_COLUMNS)
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            SELECT id::text, {columns}, created_at, synced_at
            FROM restaurants
            WHERE synced_at IS NOT NULL
              AND created_at < %s
              AND NOT (id::text = ANY(%s))
            ORDER BY created_at
            """,
            (sync.started_at, snapshot_ids),
        )
        rows = cursor.fetchall()

    found = []
    for row in rows:
        found.append(
            {
                "id": row[0],
                "current": {
                    column: row[index]
                    for index, column in enumerate(DISPLAY_COLUMNS, start=1)
                },
                "created_at": str(row[len(DISPLAY_COLUMNS) + 1]),
            }
        )
    return found


def main() -> None:
    configure_logging()
    args = parse_args()

    if args.mode == "identify":
        pipeline = BigQueryPipeline()
        connection = connect_postgres(args.schema, allow_public=args.allow_public)
        try:
            found = identify_without_backup(pipeline, connection, args.schema)
            LOGGER.info("ガードをすり抜けて上書きされた行: %d件", len(found))
            for entry in found:
                LOGGER.info(
                    "%s created_at=%s current=%s",
                    entry["id"],
                    entry["created_at"],
                    json.dumps(entry["current"], ensure_ascii=False, default=str),
                )
        finally:
            connection.rollback()
            connection.close()
        return

    client = storage.Client(project=os.getenv("GCP_PROJECT", "food-scroll"))
    blob = resolve_backup_blob(client, args.schema, args.backup_uri)
    backup = load_backup(blob)

    connection = connect_postgres(args.schema, allow_public=args.allow_public)
    try:
        damaged = find_damaged(connection, backup)
        LOGGER.info(
            "同期前から存在した%d行のうち、表示値が変わったのは%d行です",
            len(backup),
            len(damaged),
        )
        for entry in damaged:
            LOGGER.info(
                "%s %s", entry["id"], json.dumps(entry["diffs"], ensure_ascii=False)
            )

        if args.mode == "restore" and damaged:
            updated = restore(connection, backup, damaged)
            connection.commit()
            LOGGER.info("%d行を同期前の値へ戻しました", updated)
        else:
            connection.rollback()
            if args.mode == "restore":
                LOGGER.info("差分が無いため何も変更していません")
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


if __name__ == "__main__":
    main()
