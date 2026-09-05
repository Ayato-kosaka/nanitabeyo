#!/usr/bin/env python3
"""#1671 / #1779 subterritory_code のバックフィルが «何行に効くのか» を先に測る（読み取り専用）。

## なぜ要るか

#1779 で `restaurants.address_components` を落とす前に、そこにしか無い «州» を
`subterritory_code` 列へ移しておく必要がある。移さずに落とすと、州で言語が変わる国
（スイス・スペイン・ベルギー）で料理の命名が静かに劣化する。

移す対象は «address_components に country がある 2,476 店» だが、**そのうち何店が
実際に州まで持っているか**は測っていない。admin1 が無ければ移すものが無い。
**承認を求める前に、効果の大きさを数字で出す。**

## ⚠️ ここで組み立てる値を、そのまま本番へ書いてはいけない

この SQL は `locations.service.ts` の `extractLocationCodes` と同じ規則
（`${countryCode}-${administrative_area_level_1.shortText}`）を **測定のために**
再現している。**これは写経であり、本番のバックフィルにこの SQL を使ってはいけない。**

CLAUDE.md「本番のロジックをテストへ写経しない。ソースから抜き出すか、共通化して
両方から呼ぶ」に従い、**実際のバックフィルは api の `LocationsService` を import する
Node スクリプトで行う**（そうすれば shortText 欠損の扱い #677 が片方だけ直る事故を防げる）。
ここで出すのは «何行に効くか» の見積もりだけである。

## 使い方

    script_path: scripts/db-checks/measure_subterritory_backfill.py
    args: --schema dev
"""

from __future__ import annotations

import argparse
import logging
import os

LOGGER = logging.getLogger(__name__)

# ⚠️ 測定専用の写し。本番のバックフィルには使わないこと（冒頭の注意を参照）。
SQL = """
WITH comps AS (
  SELECT
    r.id,
    r.subterritory_code,
    (SELECT c FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(r.address_components) = 'array'
             THEN r.address_components ELSE '[]'::jsonb END) AS c
     WHERE c -> 'types' @> '["country"]' LIMIT 1) AS country_c,
    (SELECT c FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(r.address_components) = 'array'
             THEN r.address_components ELSE '[]'::jsonb END) AS c
     WHERE c -> 'types' @> '["administrative_area_level_1"]' LIMIT 1) AS admin1_c
  FROM restaurants r
),
derived AS (
  SELECT
    id,
    subterritory_code,
    COALESCE(NULLIF(country_c ->> 'shortText', ''),
             NULLIF(country_c ->> 'longText',  '')) AS country_code,
    NULLIF(admin1_c ->> 'shortText', '')            AS admin1_short
  FROM comps
)
SELECT
  count(*)                                                          AS restaurants_total,
  count(*) FILTER (WHERE country_code IS NOT NULL)                  AS has_country,
  count(*) FILTER (WHERE country_code IS NOT NULL AND admin1_short IS NOT NULL)
                                                                    AS can_derive_subterritory,
  -- 🔴 実際に埋まる行（いま NULL で、かつ組み立てられる）
  count(*) FILTER (
    WHERE NULLIF(subterritory_code, '') IS NULL
      AND country_code IS NOT NULL AND admin1_short IS NOT NULL
  )                                                                 AS would_fill,
  -- 州の材料が無く、落としたら情報が消える行（= 失っても元から無い）
  count(*) FILTER (WHERE country_code IS NOT NULL AND admin1_short IS NULL)
                                                                    AS country_only
FROM derived
"""

SAMPLES_SQL = """
WITH comps AS (
  SELECT
    (SELECT c FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(r.address_components) = 'array'
             THEN r.address_components ELSE '[]'::jsonb END) AS c
     WHERE c -> 'types' @> '["country"]' LIMIT 1) AS country_c,
    (SELECT c FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(r.address_components) = 'array'
             THEN r.address_components ELSE '[]'::jsonb END) AS c
     WHERE c -> 'types' @> '["administrative_area_level_1"]' LIMIT 1) AS admin1_c
  FROM restaurants r
)
SELECT
  COALESCE(NULLIF(country_c ->> 'shortText', ''), NULLIF(country_c ->> 'longText', ''))
    || '-' || NULLIF(admin1_c ->> 'shortText', '') AS value,
  count(*) AS n
FROM comps
WHERE NULLIF(admin1_c ->> 'shortText', '') IS NOT NULL
GROUP BY 1 ORDER BY n DESC LIMIT 15
"""


def _report(label: str, value: int, total: int) -> None:
    pct = (value / total * 100) if total else 0.0
    LOGGER.info("%-52s: %12s 件 (%6.2f%%)", label, f"{value:,}", pct)


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

            cur.execute(SQL)
            total, has_country, can_derive, would_fill, country_only = cur.fetchone()

            LOGGER.info("=" * 78)
            LOGGER.info(
                "# #1671 subterritory_code のバックフィルは何行に効くか（schema=%s）",
                args.schema,
            )
            LOGGER.info("=" * 78)
            _report("restaurants の総数", total, total)
            _report("address_components に country がある", has_country, total)
            _report("州（admin1.shortText）まで持っている", can_derive, total)
            _report("🔴 実際に埋まる行（いま NULL で組み立てられる）", would_fill, total)
            _report("国だけで州の材料が無い（落としても失わない）", country_only, total)

            LOGGER.info("")
            LOGGER.info("## 入る値の内訳（上位 15）")
            cur.execute(SAMPLES_SQL)
            rows = cur.fetchall()
            if rows:
                for value, n in rows:
                    LOGGER.info("    %-20s : %s 行", value, f"{n:,}")
            else:
                LOGGER.info("    （該当なし）")

            LOGGER.info("")
            if would_fill == 0:
                LOGGER.info(
                    "✅ **バックフィルは不要。** address_components に州を持つ行が無いので、"
                    "列を落としても失う情報は無い。#1779 の前提が 1 つ消える。"
                )
            else:
                LOGGER.info(
                    "🔴 **%s 行が対象。** address_components を落とす前に移すこと。"
                    "⚠️ 実際の書き込みは api の LocationsService を import する "
                    "Node スクリプトで行う（この SQL は測定専用の写しなので使わない）。",
                    f"{would_fill:,}",
                )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
