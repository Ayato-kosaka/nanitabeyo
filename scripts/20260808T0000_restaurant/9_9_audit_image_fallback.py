#!/usr/bin/env python3
"""店の画像フォールバックが実際にどこで埋まっているかを数える（読み取り専用）。

## なぜ必要か

#1645 で `restaurants.image_url` / `image_path` を落とせるかを検討している。
その判断は「落としたときに何が表示されるか」に依存する。

app-expo の表示は 3 段で落ちる（`features/myDishes/components/myDishCard.tsx:50`）。

    dish.categoryImageUrl  →  restaurant.image_url  →  無地

1 段目の `dish_categories.image_url` は契約上 NOT NULL である
（`shared/api/v1/res/users.response.ts:90`）。**もし本当に全件が非空なら、
2 段目の `restaurants.image_url` はまず到達しない**ので、落としても表示は変わらない。

ところが `myDishCard.tsx:43` は「契約上 NOT NULL だが、空文字が来ても
`restaurant.image_url` へ落ちる」と書いている。つまり**空文字がありうる前提**で
書かれている。どちらが実態なのかを、数えずに決めてはいけない。

あわせて「店の画像は配下の dish_media のサムネイルで代用できるか」も測る。
代用が成り立つのは dish_media を持つ店だけなので、その割合が要る。

## 何をしないか

**1行も書き換えない。** SELECT だけである。
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="画像フォールバックの各段がどれだけ埋まるかを数えます（読み取り専用）"
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
            # ① 1段目: dish_categories.image_url は本当に全件非空か
            cursor.execute(
                """
                SELECT COUNT(*) AS total,
                       COUNT(*) FILTER (WHERE image_url IS NULL OR image_url = '') AS empty
                FROM dish_categories
                """
            )
            total_cat, empty_cat = cursor.fetchone()
            LOGGER.info(
                "dish_categories: %d件中 image_url が空なのは %d件", total_cat, empty_cat
            )
            if empty_cat == 0:
                LOGGER.info(
                    "  → 1段目が必ず埋まるので、2段目の restaurants.image_url へは到達しない"
                )
            else:
                LOGGER.info(
                    "  → 空があるので、その料理カテゴリでは restaurants.image_url へ落ちる"
                )

            # ② dish_media を持つ店の割合（«配下のサムネイルで代用» が成り立つ範囲）
            cursor.execute("SELECT COUNT(*) FROM restaurants")
            total_restaurants = cursor.fetchone()[0]

            cursor.execute(
                """
                SELECT COUNT(DISTINCT d.restaurant_id)
                FROM dish_media m
                JOIN dishes d ON d.id = m.dish_id
                WHERE m.deleted_at IS NULL
                """
            )
            with_media = cursor.fetchone()[0]
            pct = (100.0 * with_media / total_restaurants) if total_restaurants else 0.0
            LOGGER.info(
                "dish_media を持つ店: %d / %d 件（%.3f%%）",
                with_media,
                total_restaurants,
                pct,
            )
            LOGGER.info(
                "  → «配下の dish_media のサムネイルで代用» が成り立つのはこの範囲だけ"
            )

            # ③ dishes を持つ店（カテゴリ画像へ落ちられる範囲）
            cursor.execute("SELECT COUNT(DISTINCT restaurant_id) FROM dishes")
            with_dishes = cursor.fetchone()[0]
            LOGGER.info(
                "dishes を持つ店: %d / %d 件（%.3f%%）",
                with_dishes,
                total_restaurants,
                (100.0 * with_dishes / total_restaurants) if total_restaurants else 0.0,
            )
            LOGGER.info(
                "  → dishes が無い店は、そもそも myDishes の 3段フォールバックに載らない"
            )

            # ④ restaurants.image_url が «実際に表示に効きうる» 店の数
            #    = dish_media が無く、image_url が非空
            cursor.execute(
                """
                SELECT COUNT(*)
                FROM restaurants r
                WHERE r.image_url <> ''
                  AND NOT EXISTS (
                    SELECT 1 FROM dishes d
                    JOIN dish_media m ON m.dish_id = d.id AND m.deleted_at IS NULL
                    WHERE d.restaurant_id = r.id
                  )
                """
            )
            LOGGER.info(
                "image_url が非空かつ dish_media が無い店: %d件", cursor.fetchone()[0]
            )

            # ⑤ «実際に使われている» 料理カテゴリのうち、画像が空なのは何件か。
            #    カタログ全体の 36.8% が空でも、使われないカテゴリばかりなら実害は小さい。
            #    ユーザーが記録した料理が指すカテゴリだけに絞って数える。
            cursor.execute(
                """
                SELECT COUNT(DISTINCT d.category_id) AS used,
                       COUNT(DISTINCT d.category_id)
                         FILTER (WHERE c.image_url IS NULL OR c.image_url = '') AS used_empty
                FROM dishes d
                JOIN dish_categories c ON c.id = d.category_id
                """
            )
            used, used_empty = cursor.fetchone()
            LOGGER.info(
                "実際に使われている料理カテゴリ: %d種類 / うち画像が空: %d種類（%.1f%%）",
                used,
                used_empty,
                (100.0 * used_empty / used) if used else 0.0,
            )

            # ⑥ 記録（dishes）単位で見た影響。カテゴリ種類ではなく «何件の記録が
            #    プレースホルダーになるか» が、ユーザーから見た実害である。
            cursor.execute(
                """
                SELECT COUNT(*) AS dishes_total,
                       COUNT(*) FILTER (WHERE c.image_url IS NULL OR c.image_url = '') AS dishes_empty
                FROM dishes d
                JOIN dish_categories c ON c.id = d.category_id
                """
            )
            dishes_total, dishes_empty = cursor.fetchone()
            LOGGER.info(
                "記録(dishes): %d件 / うちカテゴリ画像が空: %d件（%.1f%%）",
                dishes_total,
                dishes_empty,
                (100.0 * dishes_empty / dishes_total) if dishes_total else 0.0,
            )
    finally:
        connection.rollback()
        connection.close()


if __name__ == "__main__":
    main()
