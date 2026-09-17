#!/usr/bin/env python3
"""#1671 / #843 料理の «現地語での命名» が、実際に何件で English へ落ちているのかを数える（読み取り専用）。

## なぜ要るか

料理名は `dishes.service.createOrGetDish` がこう決めている。

    const languageCode = this.locationsService.resolveLocalLanguageCode(
      restaurant.address_components as ...
    );
    const dishNameFromLabels =
      (dishCategory.labels && dishCategory.labels[languageCode]) || dishCategory.label_en;

`resolveLocalLanguageCode` は `address_components` から国を引けなければ
**warn を出して 'en' を返す**（locations.service.ts）。つまり料理名が英語になる。

ところが #1846 の計測で、**dev の 621,974 店のうち 619,498 店（99.60%）は
`address_components` に country を持っていない**ことが分かった。
パイプライン（catalog 同期）が入れる行は `address_components_json` が '[]' だからである。

一方で `country_code` **列**は 621,964 店（100.00%）が埋まっている。
つまり «国は分かっているのに、料理の命名だけが国を知らない» 状態になっている疑いがある。

**その疑いが実データで何件なのかを数える。** 直し方はそのあとで決める。

## 何を数えるか

- 料理（dishes）を店へ join し、店の `address_components` に country があるか
- 無ければ現状は 'en' に落ちている（= 英語名が付いている）
- その店が `country_code` 列を持っているか（= 列から読めば直せるのか）

⚠️ **判定を写経しない。** locations.service.ts と同じく
«types に 'country' を含む要素があるか» だけを見る。

## 使い方

    script_path: scripts/db-checks/measure_dish_language_fallback.py
    args: --schema dev

環境変数: DATABASE_URL（必須）
"""

from __future__ import annotations

import argparse
import logging
import os

LOGGER = logging.getLogger(__name__)

# locations.service.ts の extractLocationCodes と同じ判定を SQL で再現する。
# address_components は jsonb NOT NULL だが配列とは限らないので jsonb_typeof で守る。
HAS_COUNTRY = """
  EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(r.address_components) = 'array'
                THEN r.address_components
                ELSE '[]'::jsonb END
         ) AS c
    WHERE c -> 'types' @> '["country"]'
  )
"""

DISHES_SQL = f"""
SELECT
  count(*)                                                          AS dishes_total,
  count(*) FILTER (WHERE {HAS_COUNTRY})                             AS dishes_country_known,
  -- 🔴 いま 'en' へ落ちている料理
  count(*) FILTER (WHERE NOT ({HAS_COUNTRY}))                       AS dishes_falling_back,
  -- そのうち、country_code 列から読めば直せるもの
  count(*) FILTER (
    WHERE NOT ({HAS_COUNTRY})
      AND NULLIF(r.country_code, '') IS NOT NULL
  )                                                                 AS fixable_by_column,
  -- 列も無いので、どうやっても国が分からないもの
  count(*) FILTER (
    WHERE NOT ({HAS_COUNTRY})
      AND NULLIF(r.country_code, '') IS NULL
  )                                                                 AS unfixable
FROM dishes d
JOIN restaurants r ON r.id = d.restaurant_id
"""

# 店の側でも同じ内訳を見る（料理がまだ無い店も含めた «これから効く範囲»）
RESTAURANTS_SQL = f"""
SELECT
  count(*)                                                          AS restaurants_total,
  count(*) FILTER (WHERE {HAS_COUNTRY})                             AS country_in_components,
  count(*) FILTER (
    WHERE NOT ({HAS_COUNTRY}) AND NULLIF(r.country_code, '') IS NOT NULL
  )                                                                 AS only_in_column
FROM restaurants r
"""


def _report(label: str, value: int, total: int) -> None:
    pct = (value / total * 100) if total else 0.0
    LOGGER.info("%-50s: %12s 件 (%6.2f%%)", label, f"{value:,}", pct)


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

            LOGGER.info("=" * 78)
            LOGGER.info(
                "# #1671 料理の命名が English へ落ちている件数（schema=%s）", args.schema
            )
            LOGGER.info("=" * 78)

            cur.execute(DISHES_SQL)
            (
                dishes_total,
                country_known,
                falling_back,
                fixable,
                unfixable,
            ) = cur.fetchone()

            LOGGER.info("## 既にある料理")
            _report("料理（dishes）の総数", dishes_total, dishes_total)
            _report("店の国が address_components から引けた", country_known, dishes_total)
            _report("🔴 引けず 'en' へ落ちた", falling_back, dishes_total)
            _report("  └ うち country_code 列から読めば直せる", fixable, dishes_total)
            _report("  └ 列も無く、どうやっても分からない", unfixable, dishes_total)

            LOGGER.info("")
            cur.execute(RESTAURANTS_SQL)
            r_total, r_components, r_column_only = cur.fetchone()
            LOGGER.info("## これから効く範囲（料理がまだ無い店も含む）")
            _report("restaurants の総数", r_total, r_total)
            _report("国が address_components にある（今の実装で引ける）", r_components, r_total)
            _report("国が country_code 列にしかない（今は引けない）", r_column_only, r_total)

            LOGGER.info("")
            if falling_back == 0:
                LOGGER.info("✅ 現時点で English へ落ちている料理は無い。")
            else:
                LOGGER.info(
                    "🔴 **%s 件の料理が英語名で作られている**（全体の %.2f%%）。"
                    "うち %s 件は country_code 列を読むだけで直る。",
                    f"{falling_back:,}",
                    falling_back / dishes_total * 100 if dishes_total else 0.0,
                    f"{fixable:,}",
                )
            LOGGER.info(
                "⚠️ この数字は «これから作られる料理» には効かない。"
                "店の側の内訳（上の 2 つ目の表）が、直したときに効く範囲である。"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
