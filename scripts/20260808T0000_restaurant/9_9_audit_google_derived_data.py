#!/usr/bin/env python3
"""`restaurants` に Google 由来の値がどれだけ入っているかを数える（読み取り専用）。

## なぜ必要か

オーナーの方針は「Google Place のデータは保存しない」である。ところが実際には
`POST /v1/restaurants`（地図の POI 押下）と `dishes.service.ts` の Google 一括
取り込みが、`address_components` / `plus_code` / 写真を保存し続けている。

ToS 3.2.3 が無期限の保存を許すのは `place_id` **だけ**で、緯度経度は 30 日、
それ以外（住所・店名・写真）は保存できない。

「規約に反している」ことは分かっているが、**それが何行あるのか**を誰も数えて
いなかった。列設計の見直し（#1645）でも、上書きされた 7 行を復元するかの判断でも、
規模が分からないと決められない。だから数える。

## 何をしないか

**このスクリプトは1行も書き換えない。** SELECT だけである。
消す・直すのは、規模を見てオーナーが決めてからにする。

## 数え方の注意

`address_components` は `jsonb NOT NULL` だが、jsonb の NOT NULL は JSON の
`null` リテラルも `{}` も `[]` も防がない。「入っている」を件数で数えるときは
**中身が空でないこと**まで見る必要がある。`jsonb_array_length` は配列以外へ
渡すと落ちるので、型を確かめてから使う。
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pg_sync_common import connect_postgres  # noqa: E402
from pipeline_common import configure_logging  # noqa: E402

LOGGER = logging.getLogger(__name__)

# 「Google 由来の値が入っている」の判定。列ごとに «空でない» の意味が違う。
CHECKS: list[tuple[str, str]] = [
    (
        "address_components（住所の構造化データ）",
        "jsonb_typeof(address_components) = 'array' "
        "AND jsonb_array_length(address_components) > 0",
    ),
    (
        "plus_code（Open Location Code）",
        "plus_code IS NOT NULL AND jsonb_typeof(plus_code) = 'object' "
        "AND plus_code <> '{}'::jsonb",
    ),
    (
        "image_url（Google の写真 URI）",
        "image_url <> '' AND image_url LIKE '%googleusercontent%'",
    ),
    (
        "image_url（Google 以外の URL）",
        "image_url <> '' AND image_url NOT LIKE '%googleusercontent%'",
    ),
    (
        "image_path（自社 Storage へ複製した Google 写真）",
        "image_path IS NOT NULL AND image_path <> ''",
    ),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="restaurants の Google 由来データを数えます（読み取り専用）"
    )
    parser.add_argument("--schema", choices=["dev", "public"], required=True)
    parser.add_argument("--allow-public", action="store_true")
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()

    connection = connect_postgres(args.schema, allow_public=args.allow_public)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM restaurants")
            total = cursor.fetchone()[0]
            LOGGER.info("restaurants 総数: %d行", total)
            LOGGER.info("")

            for label, predicate in CHECKS:
                cursor.execute(f"SELECT COUNT(*) FROM restaurants WHERE {predicate}")
                count = cursor.fetchone()[0]
                pct = (100.0 * count / total) if total else 0.0
                LOGGER.info("%-46s %8d行 (%5.2f%%)", label, count, pct)

            LOGGER.info("")
            # パイプライン製かアプリ製かで切って見る。同期が入れた行は
            # address_components が空なので、Google 由来はアプリ製に偏るはず。
            # source_seed_id を持たない行 = 一度も同期に触られていない行。
            cursor.execute(
                """
                SELECT
                  COUNT(*) FILTER (WHERE source_seed_id IS NULL) AS never_synced,
                  COUNT(*) FILTER (WHERE source_seed_id IS NOT NULL) AS synced
                FROM restaurants
                """
            )
            never_synced, synced = cursor.fetchone()
            LOGGER.info("同期に触られていない行: %d / 触られた行: %d", never_synced, synced)

            cursor.execute(
                """
                SELECT COUNT(*) FROM restaurants
                WHERE jsonb_typeof(address_components) = 'array'
                  AND jsonb_array_length(address_components) > 0
                  AND image_path IS NOT NULL
                """
            )
            LOGGER.info(
                "住所と写真の両方を持つ行（規約上いちばん重い）: %d行", cursor.fetchone()[0]
            )
    finally:
        # 読み取りしかしていないが、明示的に閉じる。
        connection.rollback()
        connection.close()


if __name__ == "__main__":
    main()
