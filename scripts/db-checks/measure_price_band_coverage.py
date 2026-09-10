#!/usr/bin/env python3
"""#1774 価格帯（priceBand）が実際に何件の料理で出せるのかを dev の実 DB で数える（読み取り専用）。

## なぜ要るか

#1774 の完了条件は「`restaurant × dish_category` 単位で価格帯を返せる」「店提案または
店舗詳細で表示できる」だが、**API は既に返しているのに画面がどこも描いていない**
（`priceBand` を読む component が 1 つも無い。あるのはモックの `priceBand: null` だけ）。

これは #1375 でオーナーが踏んだ「作成側だけあって消費側が無い」形そのものである。
**ただし、UI を作る前に «そもそも出せるデータがあるのか» を数える。**
0 件なら、作るのは «常に何も出ない枠» であり、優先順位が変わる。

## 何を数えるか

`shared/utils/priceBand.ts` の規則:

    PRICE_BAND_MIN_REVIEW_COUNT = 3
    （1 件で「この店のカレーは 3000 円」と出すのは誤情報なので、3 件未満は返さない）

⚠️ **判定条件を写経しない。** API（`findPriceBandsByDishIds`）と同じ where で数える。
ずれると「画面には出ないのにスクリプトだけ緑」という嘘になる。

    deleted_at IS NULL
    AND price_cents IS NOT NULL
    AND NOT_AUTHORED_BY_DELETED_USER（作者が居ないか、居るなら退会していない）

⚠️ さらに `computePriceBand` は **通貨が混ざっている料理を捨てる**。ここでも同じく
「通貨が 1 種類に定まるか」を見る（`currency_code` が NULL の行があると定まらない）。

## 使い方

    script_path: scripts/db-checks/measure_price_band_coverage.py
    args: --schema dev

環境変数: DATABASE_URL（必須）
"""

from __future__ import annotations

import argparse
import logging
import os
import sys

LOGGER = logging.getLogger(__name__)

# ⚠️ shared/utils/priceBand.ts の PRICE_BAND_MIN_REVIEW_COUNT と同じ値であること。
#    ここだけ動かすと、画面に出る条件と数える条件がずれる。
MIN_REVIEW_COUNT = 3

# API（dish-media.repository.ts findPriceBandsByDishIds）と同じ where。
# 退会ユーザーの扱いは deleted-user-filter.ts の NOT_AUTHORED_BY_DELETED_USER に合わせる
# （作者が居ない取り込みレビューは残し、作者が退会したものだけ外す）。
PRICED_REVIEW_SQL = """
  dr.deleted_at IS NULL
  AND dr.price_cents IS NOT NULL
  AND (
    dr.user_id IS NULL
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = dr.user_id AND u.deleted_at IS NULL)
  )
"""

COVERAGE_SQL = f"""
WITH priced AS (
  SELECT
    dr.dish_id,
    count(*)                          AS n_priced,
    count(DISTINCT dr.currency_code)  AS n_currencies,
    count(*) FILTER (WHERE dr.currency_code IS NULL) AS n_null_currency
  FROM dish_reviews dr
  WHERE {PRICED_REVIEW_SQL}
  GROUP BY dr.dish_id
)
SELECT
  (SELECT count(*) FROM dishes)                                              AS dishes_total,
  (SELECT count(*) FROM priced)                                              AS dishes_with_any_price,
  (SELECT count(*) FROM priced WHERE n_priced >= {MIN_REVIEW_COUNT})          AS dishes_reaching_min,
  (SELECT count(*) FROM priced
     WHERE n_priced >= {MIN_REVIEW_COUNT} AND n_null_currency = 0 AND n_currencies = 1)
                                                                             AS dishes_band_showable,
  (SELECT count(*) FROM priced
     WHERE n_priced >= {MIN_REVIEW_COUNT} AND (n_null_currency > 0 OR n_currencies > 1))
                                                                             AS dishes_blocked_by_currency,
  (SELECT count(*) FROM dish_reviews dr WHERE {PRICED_REVIEW_SQL})           AS priced_reviews_total
"""

# 何件のレビューが付いている料理が多いのか（3 件の壁がどれだけ効いているか）
DISTRIBUTION_SQL = f"""
WITH priced AS (
  SELECT dr.dish_id, count(*) AS n
  FROM dish_reviews dr
  WHERE {PRICED_REVIEW_SQL}
  GROUP BY dr.dish_id
)
SELECT n, count(*) AS dishes
FROM priced
WHERE n < {MIN_REVIEW_COUNT}
GROUP BY n
ORDER BY n
"""


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s"
    )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev")
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        LOGGER.error("❌ DATABASE_URL environment variable is required")
        return 1

    import psycopg2

    with psycopg2.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SET default_transaction_read_only = on")
            cur.execute(f'SET search_path TO "{args.schema}", extensions')

            cur.execute(COVERAGE_SQL)
            (
                dishes_total,
                with_any_price,
                reaching_min,
                showable,
                blocked_by_currency,
                priced_reviews,
            ) = cur.fetchone()

            LOGGER.info("=" * 70)
            LOGGER.info("# #1774 価格帯を出せる料理はどれだけあるか（schema=%s）", args.schema)
            LOGGER.info("=" * 70)
            LOGGER.info("価格つきレビューの総数            : %s 件", f"{priced_reviews:,}")
            LOGGER.info("")
            _report("料理（dishes）の総数", dishes_total, dishes_total)
            _report("価格つきレビューが 1 件以上ある料理", with_any_price, dishes_total)
            _report(
                f"価格つきレビューが {MIN_REVIEW_COUNT} 件以上ある料理",
                reaching_min,
                dishes_total,
            )
            _report("⭐ 価格帯を実際に出せる料理", showable, dishes_total)
            LOGGER.info("")
            LOGGER.info(
                "うち通貨が定まらず出せないもの    : %s 件（通貨が NULL / 複数混在）",
                f"{blocked_by_currency:,}",
            )

            LOGGER.info("")
            LOGGER.info("## %s 件の壁の手前にいる料理", MIN_REVIEW_COUNT)
            cur.execute(DISTRIBUTION_SQL)
            rows = cur.fetchall()
            if rows:
                for n, dishes in rows:
                    LOGGER.info("    価格つきレビュー %s 件 : %s 料理", n, f"{dishes:,}")
            else:
                LOGGER.info("    （該当なし）")

            LOGGER.info("")
            if showable == 0:
                LOGGER.info(
                    "⚠️ **1 件も出せない。** いま価格帯の UI を作っても、常に何も出ない枠になる。"
                )
            else:
                LOGGER.info(
                    "⚠️ API は既にこの値を返しているが、**画面はどこも描いていない**"
                    "（priceBand を読む component が無い）。"
                )
    return 0


def _report(label: str, n: int, total: int) -> None:
    pct = (n / total * 100) if total else 0.0
    LOGGER.info("%-34s: %s / %s （%.2f%%）", label, f"{n:,}", f"{total:,}", pct)


if __name__ == "__main__":
    sys.exit(main())
