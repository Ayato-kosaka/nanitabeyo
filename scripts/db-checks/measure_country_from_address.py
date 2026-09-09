#!/usr/bin/env python3
"""#1881 「住所から国コードを割り出す」が実データで成立するかを測る（読み取り専用）。

## なぜ要るか

オーナー確定（#1881）:

> B で。住所から割り出して欲しいよ。あとちゃんとテストしてください。

いまの `country_code` は **緯度経度の矩形**（20.0〜46.5N / 122.0〜154.0E）で決めており、
朝鮮半島もウラジオストクも丸ごと 'JP' になっている（dev で 86,043 行以上）。

住所から割り出す実装へ移す前に、**その住所に国が判る材料が入っているのか**を数える。
「住所を見れば分かるはず」で実装を始めると、住所が空・国名が入っていない行で
また矩形へ落ちるだけになる。

## 出すもの

1. 誤ラベル群（日本の陸地が無い矩形にいる `country_code='JP'` の行）の **住所の実物**
2. その住所に **どの国が判る手掛かりが何行あるか**（空 / ハングル / 韓国の行政区画名 / キリル文字 / 日本の行政区画名）
3. 日本の行にも同じ手掛かりが効くか（**誤爆しないか**）

## 読み取り専用である

SELECT しか実行しない。接続直後に `SET default_transaction_read_only = on` を実行する。

## 使い方（db-script-run.yml から）

    script_path: scripts/db-checks/measure_country_from_address.py
    args: --schema dev
    requirements_path: scripts/20251213T0000_wikidata_food_graph/requirements.txt
    concurrency_group_suffix: readonly-audit
"""

from __future__ import annotations

import argparse
import json
import logging
import os

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

# #1881 で «日本の陸地が無い» と確認済みの矩形（issue 本文の実測と同じ定義）。
# ここは «誤ラベルであることが確実な部分集合» を切り出すためだけに使う。
# 直し方（本番のロジック）へこの矩形を持ち込まないこと。
NOT_JAPAN_BOXES = """
  (r.latitude BETWEEN 33.0 AND 38.6 AND r.longitude BETWEEN 124.6 AND 129.3)
  OR (r.latitude BETWEEN 42.5 AND 46.5 AND r.longitude BETWEEN 130.0 AND 132.0)
"""

# 住所に «どの国か» の手掛かりが入っているかを、文字種と行政区画名で数える。
# ⚠️ ここは «割り出せるか» を測るための当たりであって、本番の判定ではない。
SIGNALS_SQL = f"""
  WITH target AS (
    SELECT r.id, r.address, r.latitude, r.longitude,
           ({NOT_JAPAN_BOXES}) AS in_not_japan_box
    FROM restaurants r
    WHERE r.country_code = 'JP'
  )
  SELECT
    in_not_japan_box,
    count(*)                                                    AS rows,
    count(*) FILTER (WHERE address IS NULL OR address = '')      AS address_empty,
    count(*) FILTER (WHERE address ~ '[\\uAC00-\\uD7A3]')          AS has_hangul,
    count(*) FILTER (WHERE address ~ '[\\u0400-\\u04FF]')          AS has_cyrillic,
    count(*) FILTER (WHERE address ~ '[\\u3040-\\u30FF]')          AS has_kana,
    count(*) FILTER (WHERE address ~ '(도|광역시|특별시|시 |군 |구 )') AS has_kr_admin,
    count(*) FILTER (WHERE address ~ '(都|道|府|県|市|区|町|村)')     AS has_jp_admin
  FROM target
  GROUP BY in_not_japan_box
  ORDER BY in_not_japan_box
"""

SAMPLE_SQL = f"""
  SELECT r.name, r.address, r.latitude, r.longitude
  FROM restaurants r
  WHERE r.country_code = 'JP' AND ({NOT_JAPAN_BOXES})
  ORDER BY r.id
  LIMIT 25
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev")
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    import psycopg2

    with psycopg2.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SET default_transaction_read_only = on")
            cur.execute(f'SET search_path TO "{args.schema}", extensions')
            cur.execute("SELECT current_user, current_database()")
            user, db = cur.fetchone()
            logger.info("接続先: user=%s db=%s schema=%s", user, db, args.schema)

            cur.execute(SIGNALS_SQL)
            groups = cur.fetchall()

            cur.execute(SAMPLE_SQL)
            samples = cur.fetchall()

    logger.info("")
    logger.info("=" * 78)
    logger.info("# #1881 country_code='JP' の行の住所に、国の手掛かりが入っているか")
    logger.info("=" * 78)

    result = {"schema": args.schema, "groups": [], "samples": []}
    for (
        in_box,
        rows,
        empty,
        hangul,
        cyrillic,
        kana,
        kr_admin,
        jp_admin,
    ) in groups:
        label = "日本の陸地が無い矩形（＝誤ラベル確実）" if in_box else "それ以外"
        logger.info("")
        logger.info("## %s : %s 行", label, f"{rows:,}")

        def pct(n: int) -> str:
            return f"{100.0 * n / rows:.2f}%" if rows else "n/a"

        logger.info("  住所が空                 : %10s (%s)", f"{empty:,}", pct(empty))
        logger.info("  ハングルを含む           : %10s (%s)", f"{hangul:,}", pct(hangul))
        logger.info("  キリル文字を含む         : %10s (%s)", f"{cyrillic:,}", pct(cyrillic))
        logger.info("  かな・カナを含む         : %10s (%s)", f"{kana:,}", pct(kana))
        logger.info("  韓国の行政区画名を含む   : %10s (%s)", f"{kr_admin:,}", pct(kr_admin))
        logger.info("  日本の行政区画名を含む   : %10s (%s)", f"{jp_admin:,}", pct(jp_admin))

        result["groups"].append(
            {
                "in_not_japan_box": bool(in_box),
                "rows": rows,
                "address_empty": empty,
                "has_hangul": hangul,
                "has_cyrillic": cyrillic,
                "has_kana": kana,
                "has_kr_admin": kr_admin,
                "has_jp_admin": jp_admin,
            }
        )

    logger.info("")
    logger.info("## 誤ラベル群の住所の実物（25 件）")
    for name, address, lat, lng in samples:
        logger.info("  (%.4f, %.4f) %s | %s", lat, lng, name, address)
        result["samples"].append(
            {"name": name, "address": address, "latitude": lat, "longitude": lng}
        )

    logger.info("")
    logger.info("=" * 78)
    logger.info("# JSON（機械可読）")
    logger.info("=" * 78)
    logger.info(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
