#!/usr/bin/env python3
"""#1774 «価格帯を出せる料理» が何割あるかを測る（読み取り専用）。

## なぜ要るか

#1774 の完了条件に「#843 に coverage / 残課題を反映できる」がある。
価格帯は **`restaurant × dish_category`**（＝ `dishes` 1 行。
`@@unique([restaurant_id, category_id])`）ごとに出るので、母数は `dishes` である。

## ⚠️ 判定の出どころ（写経していることを明記する）

出せる / 出せないを決めているのは 2 箇所で、**この SQL はその両方を写している**。

1. 母数の絞り込み — `DishMediaRepository.findPriceBandsByDishIds`

       where: { dish_id: {in}, deleted_at: null, price_cents: { not: null },
                ...NOT_AUTHORED_BY_DELETED_USER }

   `NOT_AUTHORED_BY_DELETED_USER` は `OR: [{ user_id: null }, { users: { deleted_at: null } }]`
   （`api/src/v1/dish-media/deleted-user-filter.ts`）。

2. 帯の決定 — `shared/utils/priceBand.ts` の `computePriceBand` / `resolvePriceBand`

   - `currency_code` が NULL の行は除く（通貨バグの残骸。混ぜると中央値が最大 100 倍に壊れる）
   - 通貨が混ざるときは **件数最多の通貨だけ**を採用（同数なら通貨コード昇順）
   - 採用通貨の件数が `PRICE_BAND_MIN_REVIEW_COUNT`（= 3）未満なら null
   - **刻みが定義されていない通貨は null**（`PRICE_BAND_STEPS_CENTS` は JPY のみ）

**どちらかが変わったらこの SQL も直すこと。** このリポジトリは «検知 SQL が本番の判定を
写経していて、片方だけ直って緑のままだった» 事故を 2026-08-29 に起こしている。

⚠️ 中央値そのものは計算しない。**中央値がいくつでも «出せるか出せないか» は変わらない**
（刻みのどれかには必ず落ちる）ので、coverage には要らない。

## ⚠️ dev だけを見る

本番の DB はオーナーの指示があるまで触らない。`--schema` は `dev` のみ受ける。

実行:
    python3 scripts/db-checks/measure_price_band_coverage.py --schema dev
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "20260808T0000_restaurant"))

from pg_sync_common import connect_postgres  # noqa: E402
from pipeline_common import configure_logging  # noqa: E402

LOGGER = logging.getLogger(__name__)

# `PRICE_BAND_MIN_REVIEW_COUNT`（shared/utils/priceBand.ts）
MIN_REVIEW_COUNT = 3
# `PRICE_BAND_STEPS_CENTS` のキー（同上）。ここに無い通貨は帯を出せない
CURRENCIES_WITH_STEPS = ("JPY",)
# ⚠️ SQL の IN 句へ埋めるので **タプルの repr を使わない**。
#    要素 1 個のタプルは `('JPY',)` となり、末尾のカンマで PostgreSQL の構文エラーになる
#    （実際に 1 度書いてしまった）。
CURRENCIES_IN_SQL = "(" + ", ".join(f"'{c}'" for c in CURRENCIES_WITH_STEPS) + ")"

COVERAGE_SQL = f"""
  WITH eligible AS (
    SELECT r.dish_id, r.currency_code
    FROM dish_reviews r
    LEFT JOIN users u ON u.id = r.user_id
    WHERE r.deleted_at IS NULL
      AND r.price_cents IS NOT NULL
      AND (r.user_id IS NULL OR u.deleted_at IS NULL)
      AND r.currency_code IS NOT NULL
  ),
  per_currency AS (
    SELECT dish_id, currency_code, COUNT(*) AS n
    FROM eligible
    GROUP BY 1, 2
  ),
  top_currency AS (
    -- 件数最多の通貨。同数なら通貨コード昇順（computePriceBand と同じ決め方）
    SELECT DISTINCT ON (dish_id) dish_id, currency_code, n
    FROM per_currency
    ORDER BY dish_id, n DESC, currency_code ASC
  )
  SELECT
      (SELECT COUNT(*) FROM dishes)                                        AS dishes,
      (SELECT COUNT(*) FROM top_currency)                                  AS dishes_with_any_price,
      (SELECT COUNT(*) FROM top_currency WHERE n >= {MIN_REVIEW_COUNT})    AS dishes_with_enough_reviews,
      (SELECT COUNT(*) FROM top_currency
        WHERE n >= {MIN_REVIEW_COUNT}
          AND currency_code IN {CURRENCIES_IN_SQL})                   AS dishes_with_band,
      (SELECT COUNT(DISTINCT d.restaurant_id)
         FROM top_currency t JOIN dishes d ON d.id = t.dish_id
        WHERE t.n >= {MIN_REVIEW_COUNT}
          AND t.currency_code IN {CURRENCIES_IN_SQL})                 AS restaurants_with_band,
      (SELECT COUNT(*) FROM restaurants)                                    AS restaurants
"""

# «惜しい» の内訳。どこを直せば増えるのかを推測しないために出す
SHORTFALL_SQL = f"""
  WITH eligible AS (
    SELECT r.dish_id, r.currency_code
    FROM dish_reviews r
    LEFT JOIN users u ON u.id = r.user_id
    WHERE r.deleted_at IS NULL
      AND r.price_cents IS NOT NULL
      AND (r.user_id IS NULL OR u.deleted_at IS NULL)
      AND r.currency_code IS NOT NULL
  ),
  per_currency AS (
    SELECT dish_id, currency_code, COUNT(*) AS n FROM eligible GROUP BY 1, 2
  ),
  top_currency AS (
    SELECT DISTINCT ON (dish_id) dish_id, currency_code, n
    FROM per_currency ORDER BY dish_id, n DESC, currency_code ASC
  )
  SELECT
      CASE
        WHEN n < {MIN_REVIEW_COUNT} THEN '件数不足（' || n || ' 件）'
        WHEN currency_code NOT IN {CURRENCIES_IN_SQL} THEN '刻み未定義の通貨（' || currency_code || '）'
        ELSE '出せる'
      END AS reason,
      COUNT(*) AS dishes
  FROM top_currency
  GROUP BY 1
  ORDER BY 2 DESC
"""

# 通貨バグの残骸がどれだけ残っているか（価格はあるのに通貨が無い行は母数から落ちる）
CURRENCY_NULL_SQL = """
  SELECT COUNT(*) FROM dish_reviews
  WHERE deleted_at IS NULL AND price_cents IS NOT NULL AND currency_code IS NULL
"""


def main() -> int:
    configure_logging()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev", choices=["dev"])
    args = parser.parse_args()

    connection = connect_postgres(args.schema, allow_public=False)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET default_transaction_read_only = on")

            cursor.execute(COVERAGE_SQL)
            (dishes, any_price, enough, with_band, r_with_band, restaurants) = cursor.fetchone()
            pct = (with_band / dishes * 100) if dishes else 0.0
            r_pct = (r_with_band / restaurants * 100) if restaurants else 0.0

            LOGGER.info("===== #1774 «価格帯を出せる料理» の coverage（%s）=====", args.schema)
            LOGGER.info("料理（restaurant × category）        : %8d", dishes)
            LOGGER.info("  価格レビューが 1 件でもある        : %8d", any_price)
            LOGGER.info("  採用通貨で %d 件以上               : %8d", MIN_REVIEW_COUNT, enough)
            LOGGER.info("  **価格帯を出せる**                 : %8d  (%.4f%%)", with_band, pct)
            LOGGER.info("店舗                                 : %8d", restaurants)
            LOGGER.info("  価格帯を出せる料理を持つ店         : %8d  (%.4f%%)", r_with_band, r_pct)

            LOGGER.info("")
            LOGGER.info("出せない理由の内訳（価格レビューがある料理のみ）")
            cursor.execute(SHORTFALL_SQL)
            for reason, count in cursor.fetchall():
                LOGGER.info("  %-28s %8d", reason, count)

            cursor.execute(CURRENCY_NULL_SQL)
            (currency_null,) = cursor.fetchone()
            LOGGER.info("")
            LOGGER.info("価格はあるが通貨が無いレビュー（母数から落ちる）: %d 件", currency_null)
            if currency_null:
                LOGGER.warning("⚠️ #1774 の通貨バグの残骸が残っている。中央値が最大 100 倍に壊れるため除外されている")
    finally:
        connection.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
