#!/usr/bin/env python3
"""既存 PostgreSQL restaurants を BigQuery raw へsnapshotする。

## 何を取り込むのか

**パイプラインが作った行（created_by_source = 'pipeline'）は読まない。**
9_1 が入れた行を読み戻すと、自分の出力を入力に戻す循環になる。読むのは
アプリ・オーナー・手動で作られた行だけである。

## 何のために取り込むのか（2 つだけ）

1. **Google Text Search の課金を避ける** — 既に place_id を知っている店を
   もう一度検索しない（3_1 → 3_2）
2. **どの seed が同じ店かを判定する** — 名前と座標が要る（2_2 の名寄せ）

**表示値（画像・住所・plus_code）は運ばない。** 運ぶと catalog の中身が
«1_2 がどのスキーマを読んだか» に依存し、dev で作った catalog を public へ
流すと dev の値が本番へ入る（実測 2,108 行 / #1706）。既存行を上書きから守る
役目は 9_1 の created_by_source ガードが持っているので、値の carry-forward は
不要である。
"""

from __future__ import annotations

import argparse
import os
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import psycopg2

from pipeline_common import (
    BigQueryPipeline,
    configure_logging,
    require_run_id,
    stable_record_hash,
)

REPO_ROOT = Path(__file__).resolve().parents[2]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="既存 restaurants を BigQueryへsnapshotします"
    )
    parser.add_argument("--run-id")
    parser.add_argument(
        "--snapshot-date",
        type=date.fromisoformat,
        default=datetime.now(timezone.utc).date(),
    )
    parser.add_argument("--schema", choices=("dev", "public"), required=True)
    return parser.parse_args()


def iter_restaurants(connection: Any, schema: str, run_id: str, snapshot_date: date):
    # named cursorにより、将来100万件を超えても全件をPython listへ載せない。
    with connection.cursor(name="restaurant_bq_snapshot") as cursor:
        cursor.itersize = 5_000
        cursor.execute(
            f"""
            SELECT
              id::text,
              google_place_id,
              name,
              latitude,
              longitude
            FROM {schema}.restaurants
            -- #1706 **パイプラインが作った行は読まない。**
            --
            -- 9_1 が入れた行を 1_2 が読み戻すと、パイプラインが自分の出力を
            -- 入力に戻す循環になる（dev 実測で 2,446 行 → 621,965 行に膨張する）。
            -- 既存 PG を読む目的は «アプリ／オーナーが作った店を落とさない» ことなので、
            -- 自分が作った行を食べ直す意味は無い。
            --
            -- 'user' だけでなく 'owner' / 'manual' も読む。«パイプライン製でない»
            -- が条件であって «ユーザー製» が条件ではない。
            --
            -- ⚠️ public へ向けるときは、先に created_by_source の migration
            -- （20260827T0000）を public へ適用しておくこと。列が無ければここで落ちる。
            -- 落ちるだけでデータは変わらないので、安全側の失敗である。
            WHERE created_by_source <> 'pipeline'
            ORDER BY id
            """
        )
        for row in cursor:
            # #843 **表示値は運ばない。** 運ぶのは «この店の place_id はもう知っている»
            # という事実と、それをオープンデータの seed へ結び付けるための最小限だけ。
            #
            #   ・source_record_id / google_place_id … 3_1 が Text Search を省くため
            #   ・name / latitude / longitude        … 2_2 がどの seed と同じ店かを判定するため
            #
            # 以前は image_url / image_path / address_components / plus_code /
            # name_language_code も運び、3_4 が COALESCE で catalog へ焼き込んでいた。
            # そのせいで **catalog の中身が «1_2 がどのスキーマを読んだか» に依存**し、
            # dev で作った catalog には dev の値（Google 由来の住所を含む）が入っていた。
            # 実測 2,108 行（#1706）。上書きから既存行を守る役目は 9_1 の
            # created_by_source ガードが持っているので、carry-forward はもう要らない。
            #
            # BigQuery 側の列は NULLABLE のままにしてある（DDL 変更なしで戻せる）。
            payload = {
                "source_record_id": row[0],
                "google_place_id": row[1],
                "name": row[2],
                "name_language_code": None,
                "latitude": row[3],
                "longitude": row[4],
                "image_url": None,
                "image_path": None,
                "address_components_json": None,
                "plus_code_json": None,
                "created_at": None,
            }
            yield {
                "run_id": run_id,
                "snapshot_date": snapshot_date.isoformat(),
                **payload,
                "record_hash": stable_record_hash(payload),
                "ingested_at": datetime.now(timezone.utc).isoformat(),
            }


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise ValueError("DATABASE_URL が必要です")

    pipeline = BigQueryPipeline()
    parameters = {"snapshot_date": args.snapshot_date, "pg_schema": args.schema}
    with pipeline.step(
        run_id,
        "1_2_import_existing_pg_restaurants",
        parameters=parameters,
        repo_root=REPO_ROOT,
    ) as step:
        pipeline.delete_run_rows(
            "restaurant_existing_pg_raw",
            run_id,
            partition_field="snapshot_date",
            partition_date=args.snapshot_date,
        )
        with psycopg2.connect(database_url, connect_timeout=15) as connection:
            row_count = pipeline.load_json_rows(
                "restaurant_existing_pg_raw",
                iter_restaurants(connection, args.schema, run_id, args.snapshot_date),
            )
        step["row_count"] = row_count
        pipeline.append_manifest(
            {
                "run_id": run_id,
                "source": "existing_pg",
                "snapshot_date": args.snapshot_date.isoformat(),
                "source_release": args.schema,
                "source_uri": None,
                "local_file_name": None,
                "sha256": None,
                "license_id": "first_party",
                "terms_version": None,
                "attribution_text": None,
                "row_count": row_count,
                "loaded_at": datetime.now(timezone.utc).isoformat(),
            }
        )


if __name__ == "__main__":
    main()
