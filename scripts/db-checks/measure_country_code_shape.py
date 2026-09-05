#!/usr/bin/env python3
"""#1846 `country_code` に «国名» が入り得る経路が、実データでどれだけ効くのかを数える（読み取り専用）。

## なぜ要るか

`extractCountryCode`（api/src/v1/locations/locations.service.ts）は

    countryComponent?.shortText || countryComponent?.longText || null

で落ちる。shortText 欠損は「Google API で実際に発生」とテストに明記されており
（locations.service.spec.ts の「should accept components with only longText」）、
そのとき戻り値は `"Japan"` になる。

ところが DB 側には形の制約がある（migration 20260828T0000）。

    CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$')

`"Japan"` は 5 文字なので違反し、`23514 check_violation` で **500 になる**。
クライアント入力には `@Length(2, 2)` があるが、`dto.countryCode` 未指定のとき使われる
`baseline.countryCode` は **サーバが組み立てた値**で、DTO の検証を通っていない。

**直し方を決める前に、その経路が実データでどれだけあるのかを数える。**
0 件なら優先度は下がる。多いなら急ぐ。推測で直さない。

## 何を数えるか

`restaurants.address_components`（jsonb）を直接見て、`types` に 'country' を含む
要素の `shortText` / `longText` の有無を数える。

⚠️ **判定を写経しない。** 上の TS と同じ «shortText を優先し、無ければ longText» を
そのまま SQL にする。ずれると「スクリプトだけ緑」という嘘になる。

⚠️ `address_components` は jsonb NOT NULL だが、JSON の null も {} も入るので
配列とは限らない（locations.service.ts のコメント参照）。`jsonb_typeof` で守る。

## 使い方

    script_path: scripts/db-checks/measure_country_code_shape.py
    args: --schema dev

環境変数: DATABASE_URL（必須）
"""

from __future__ import annotations

import argparse
import logging
import os

LOGGER = logging.getLogger(__name__)

# ⚠️ migration 20260828T0000 の restaurants_country_code_check と同じ形であること。
COUNTRY_CODE_REGEX = "^[A-Z]{2}$"

# extractLocationCodes と同じ «shortText を優先し、無ければ longText» を SQL で再現する。
# 配列でない address_components は空配列として扱う（TS 側の Array.isArray ガードと同じ）。
SHAPE_SQL = f"""
WITH comps AS (
  SELECT
    r.id,
    r.country_code AS stored_country_code,
    (
      SELECT c
      FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(r.address_components) = 'array'
                  THEN r.address_components
                  ELSE '[]'::jsonb END
           ) AS c
      WHERE c -> 'types' @> '["country"]'
      LIMIT 1
    ) AS country_component
  FROM restaurants r
),
derived AS (
  SELECT
    id,
    stored_country_code,
    country_component,
    NULLIF(country_component ->> 'shortText', '') AS short_text,
    NULLIF(country_component ->> 'longText', '')  AS long_text,
    COALESCE(
      NULLIF(country_component ->> 'shortText', ''),
      NULLIF(country_component ->> 'longText', '')
    ) AS derived_code
  FROM comps
)
SELECT
  count(*)                                                        AS restaurants_total,
  count(*) FILTER (WHERE country_component IS NULL)               AS no_country_component,
  count(*) FILTER (WHERE short_text IS NOT NULL)                  AS has_short_text,
  -- ⚠️ これが問題の経路。shortText が無く longText へ落ちる行
  count(*) FILTER (WHERE short_text IS NULL AND long_text IS NOT NULL)
                                                                  AS falls_back_to_long_text,
  -- そのうち、実際に CHECK へ違反する形になるもの（= 保存しようとすると 500）
  count(*) FILTER (
    WHERE short_text IS NULL
      AND long_text IS NOT NULL
      AND long_text !~ '{COUNTRY_CODE_REGEX}'
  )                                                               AS would_violate_check,
  -- 既に列へ入っている値のうち、形が壊れているもの（過去に入ってしまった分の確認）
  count(*) FILTER (
    WHERE stored_country_code IS NOT NULL
      AND stored_country_code !~ '{COUNTRY_CODE_REGEX}'
  )                                                               AS stored_malformed,
  count(*) FILTER (WHERE stored_country_code IS NOT NULL)          AS stored_present
FROM derived
"""

# 実際にどんな値が入ろうとしているのかを見る（«Japan» なのか別の形なのか）
SAMPLES_SQL = """
WITH comps AS (
  SELECT
    (
      SELECT c
      FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(r.address_components) = 'array'
                  THEN r.address_components
                  ELSE '[]'::jsonb END
           ) AS c
      WHERE c -> 'types' @> '["country"]'
      LIMIT 1
    ) AS country_component
  FROM restaurants r
)
SELECT
  NULLIF(country_component ->> 'longText', '') AS long_text,
  count(*) AS n
FROM comps
WHERE NULLIF(country_component ->> 'shortText', '') IS NULL
  AND NULLIF(country_component ->> 'longText', '') IS NOT NULL
GROUP BY 1
ORDER BY n DESC
LIMIT 20
"""


def _report(label: str, value: int, total: int) -> None:
    pct = (value / total * 100) if total else 0.0
    LOGGER.info("%-46s: %12s 件 (%6.2f%%)", label, f"{value:,}", pct)


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

            cur.execute(SHAPE_SQL)
            (
                total,
                no_component,
                has_short,
                falls_back,
                would_violate,
                stored_malformed,
                stored_present,
            ) = cur.fetchone()

            LOGGER.info("=" * 78)
            LOGGER.info(
                "# #1846 country_code に国名が入る経路は実データでどれだけあるか（schema=%s）",
                args.schema,
            )
            LOGGER.info("=" * 78)
            _report("restaurants の総数", total, total)
            _report("address_components に country が無い", no_component, total)
            _report("country の shortText がある（正常）", has_short, total)
            _report(
                "⚠️ shortText が無く longText へ落ちる", falls_back, total
            )
            _report(
                "🔴 うち CHECK 違反になる形（= 保存で 500）", would_violate, total
            )
            LOGGER.info("")
            _report("country_code が既に入っている行", stored_present, total)
            _report("🔴 うち形が壊れている行", stored_malformed, total)

            LOGGER.info("")
            LOGGER.info("## longText へ落ちるとき、実際に入ろうとする値")
            cur.execute(SAMPLES_SQL)
            rows = cur.fetchall()
            if rows:
                for long_text, n in rows:
                    LOGGER.info("    %-30s : %s 行", long_text, f"{n:,}")
            else:
                LOGGER.info("    （該当なし）")

            LOGGER.info("")
            if would_violate == 0:
                LOGGER.info(
                    "✅ **この経路は dev の実データでは 1 件も踏まない。** "
                    "テストに «実際に発生する» と書かれている以上、直す価値はあるが、"
                    "いま急いで直す理由は無い。優先度を下げてよい。"
                )
            else:
                LOGGER.info(
                    "🔴 **%s 行がこの経路を踏む。** その店を確認ページから保存しようとすると "
                    "23514 check_violation で 500 になる。#1846 の案 A "
                    "（ISO 2 文字でなければ null を返す）で直すこと。",
                    f"{would_violate:,}",
                )
            if stored_malformed > 0:
                LOGGER.info(
                    "🔴 さらに **%s 行は既に壊れた値が入っている**。"
                    "CHECK をすり抜けた経路があるということなので、そちらも追うこと。",
                    f"{stored_malformed:,}",
                )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
