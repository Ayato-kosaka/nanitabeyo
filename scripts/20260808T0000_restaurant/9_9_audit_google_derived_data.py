#!/usr/bin/env python3
"""`restaurants` に Google 由来の値がどれだけ入っているかを数える（読み取り専用）。

## なぜ必要か

オーナーの方針は「Google Place のデータは保存しない」である。

⚠️ **2026-09-21 時点の «保存している経路» は当初より減っている。** コードを当たり直した結果:

- 地図の POI 押下（`POST /v1/restaurants`）は **もう保存していない**（#1780 / PR #1870 で停止）
- `plus_code` は **どの経路も新しく書かない**（#1779。`dishes.service.ts` は `null` を入れる）
- 写真の `image_url` も **新しく作らない**（#1779 / #1680。表示は自社側の `image_path` 由来）
- **残っているのは Google 一括取り込み（`dishes.service.ts` の `address_components`）だけ**で、
  これは «投稿が貯まるまでの繋ぎ» として現状維持と決まっている（#1780 2026-09-02 判断ログ）

したがってこのスクリプトが数えるのは、**過去に積み上がった行**と、
**一括取り込みが今も足している `address_components`** である。

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

            # #1779 「address が空 かつ address_components あり」の 1,675 行を、
            # **誰が作った行か**で割る。ここで打ち手が変わる。
            #
            #   pipeline 製 … catalog 側に address が無い。9_1 を流しても埋まらないので、
            #                 埋めるなら address_components から組み立てるしかない
            #   app 製      … 確認ページ（#1671）を通れば fillMissingAddress が埋める。
            #                 放っておいても «ユーザーが触ったときに» 解消しうる
            #
            # 割らずに «1,675 行を埋める» と決めると、片方に効かない打ち手を選ぶ。
            cursor.execute(
                """
                SELECT created_by_source, COUNT(*)
                FROM restaurants
                WHERE (address IS NULL OR address = '')
                  AND jsonb_typeof(address_components) = 'array'
                  AND jsonb_array_length(address_components) > 0
                GROUP BY created_by_source
                ORDER BY 2 DESC
                """
            )
            LOGGER.info("")
            LOGGER.info("#1779 address が空 かつ address_components あり — 作成元の内訳")
            for source, count in cursor.fetchall():
                LOGGER.info("  %-12s %8d行", source, count)
    finally:
        # 読み取りしかしていないが、明示的に閉じる。
        connection.rollback()
        connection.close()


if __name__ == "__main__":
    main()
