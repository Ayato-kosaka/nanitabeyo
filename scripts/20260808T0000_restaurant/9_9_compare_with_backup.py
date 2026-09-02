#!/usr/bin/env python3
"""同期«直前»のバックアップと現在の PG を突き合わせる（読み取り専用）。#1706

## なぜ要るか

同期後の検査で «アプリ製の行 N 件で画像が丸ごと消えている» が出たとき、
`created_at` を見れば «今夜作られた行ではない» までは言える。しかしそれは
**«同期が触っていない» の証明にはなっていない**（古い行を触った可能性が残る）。

`9_1` は本適用の直前に GCS へ `restaurants` をそのまま書き出している。
**それが «触る前» の姿である。** 突き合わせれば推論ではなく事実で言える。

## 何を比べるか

`created_by_source <> 'pipeline'` の行について、**同期が絶対に変えてはいけない
表示値**が backup と一致するかを数える。

    name / image_url / image_path / latitude / longitude

`address` と `country_code` は **意図的に穴埋めしている**ので比較から外す
（#1706 の 1-a。NULL だった行にだけ入る）。

**1 行も書き換えない。**

    9_9_compare_with_backup.py --schema public --allow-public \\
      --backup-uri gs://.../restaurants-....csv
"""

from __future__ import annotations

import argparse
import csv
import io
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from google.cloud import storage  # noqa: E402

from pg_sync_common import connect_postgres  # noqa: E402
from pipeline_common import configure_logging  # noqa: E402

LOGGER = logging.getLogger(__name__)

# 同期が «アプリ製の行では» 絶対に変えてはいけない列。
GUARDED = ["name", "image_url", "image_path", "latitude", "longitude"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="同期直前の backup と現在を突き合わせます（読み取り専用）"
    )
    parser.add_argument("--schema", choices=["dev", "public"], required=True)
    parser.add_argument("--backup-uri", required=True, help="gs://... の CSV")
    parser.add_argument("--examples", type=int, default=10)
    parser.add_argument("--allow-public", action="store_true")
    return parser.parse_args()


def load_backup(uri: str) -> dict[str, dict[str, str]]:
    if not uri.startswith("gs://"):
        raise ValueError("--backup-uri は gs:// で始まる必要があります")
    bucket_name, _, blob_name = uri[len("gs://"):].partition("/")
    blob = storage.Client().bucket(bucket_name).blob(blob_name)
    text = blob.download_as_bytes().decode("utf-8")
    rows: dict[str, dict[str, str]] = {}
    for row in csv.DictReader(io.StringIO(text)):
        key = row.get("google_place_id")
        if key:
            rows[key] = row
    LOGGER.info("backup を読みました: %s 行 (%s)", f"{len(rows):,}", uri)
    return rows


def norm(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def main() -> None:
    configure_logging()
    args = parse_args()
    backup = load_backup(args.backup_uri)

    connection = connect_postgres(args.schema, allow_public=args.allow_public)
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT google_place_id, {', '.join(GUARDED)}
                FROM restaurants WHERE created_by_source <> 'pipeline'
                """
            )
            current = cursor.fetchall()
        connection.rollback()
    finally:
        connection.close()

    checked = missing_in_backup = 0
    changed: dict[str, int] = {c: 0 for c in GUARDED}
    examples: list[str] = []
    for row in current:
        place_id, *values = row
        before = backup.get(place_id)
        if before is None:
            missing_in_backup += 1
            continue
        checked += 1
        for column, now in zip(GUARDED, values):
            if norm(before.get(column)) != norm(now):
                changed[column] += 1
                if len(examples) < args.examples:
                    examples.append(
                        f"{place_id} {column}: {norm(before.get(column))!r} → {norm(now)!r}"
                    )

    LOGGER.info("突き合わせたアプリ製の行: %s", f"{checked:,}")
    LOGGER.info("backup に居なかった行（同期後に作られた行）: %s", f"{missing_in_backup:,}")
    total = sum(changed.values())
    for column, count in changed.items():
        LOGGER.info("  %-12s 変化 %s 件", column, f"{count:,}")
    for line in examples:
        LOGGER.info("    %s", line)

    if total:
        raise RuntimeError(
            f"アプリ製の行の表示値が {total} 件変化しています。同期が既存行を"
            "書き換えた可能性があります（#1706）"
        )
    LOGGER.info("✅ アプリ製の行の表示値は同期の前後で 1 件も変わっていない")


if __name__ == "__main__":
    main()
