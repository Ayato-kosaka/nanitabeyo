#!/usr/bin/env python3
"""#1774 `currency_code` が NULL のまま `price_cents` を持つレビュー行を訂正する。

## 何の話か

レビューの料金欄の話。`price_cents` は最小単位の整数（円は 0 桁、ドルは 2 桁）だが、
**通貨が未確定のまま既定 2 桁で換算していた時期があり**、¥500 が 50,000 として
保存された行が残っている。原因と経緯は `app-expo/lib/googlePlaces.ts` の
`toMinorAmountInteger()` のコメントにある（#843 で throw するよう塞ぎ、
API 側も #1816 で塞いだので、**これ以上は増えない**）。

## 実害

集計（`shared/utils/priceBand.ts` の `computePriceBand`）は通貨 NULL を除外済み。
表示（`formatReviewPrice`）も通貨が無ければ null を返す。**放置しても数字は汚れない。**
それでも直すのは、«誰にも見えない値» がデータに残り続けるのが気持ち悪いからである。

## ⚠️ 何を «正しい値» とみなすか

`price_cents / 100` を円とみなし、`currency_code` を店の国から決める。
**店が日本でない行は自動で直さない**（100 で割ってよい根拠が無いため）。
どの行をどう直すかは `--dry-run`（既定）で必ず先に確認すること。

## 使い方（db-script-run.yml から）

    # 1. まず中身を見る（読み取り専用）
    script_path: scripts/db-checks/fix_null_currency_reviews.py
    args: --schema dev

    # 2. 確認できたら直す
    args: --schema dev --apply

⚠️ `--apply` は書き込む。**`--schema public` で実行してよいのはオーナーの明示的な指示があるときだけ。**

環境変数:
    DATABASE_URL … PostgreSQL 接続文字列（必須）
"""

from __future__ import annotations

import argparse
import logging
import os
import sys

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

# 通貨が分からないまま既定 2 桁で換算していたときの倍率
WRONG_MINOR_UNIT_FACTOR = 100

SELECT_SQL = """
  SELECT
    dr.id,
    dr.price_cents,
    dr.created_at,
    r.name        AS restaurant_name,
    r.country_code
  FROM dish_reviews dr
  JOIN dishes d      ON d.id = dr.dish_id
  JOIN restaurants r ON r.id = d.restaurant_id
  WHERE dr.deleted_at IS NULL
    AND dr.price_cents IS NOT NULL
    AND dr.currency_code IS NULL
  ORDER BY dr.created_at
"""

UPDATE_SQL = """
  UPDATE dish_reviews
  SET price_cents   = %s,
      currency_code = %s
  WHERE id = %s
    AND currency_code IS NULL
    AND price_cents = %s
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="実際に書き込む（付けなければ読み取り専用で内容を表示するだけ）",
    )
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    if args.schema == "public" and args.apply:
        logger.error(
            "❌ public への書き込みはこのスクリプトからは行わない。"
            "オーナーの明示的な指示がある場合だけ、この guard を外して実行すること"
        )
        return 1

    import psycopg2

    with psycopg2.connect(database_url) as conn:
        with conn.cursor() as cur:
            if not args.apply:
                cur.execute("SET default_transaction_read_only = on")
            cur.execute(f'SET search_path TO "{args.schema}", extensions')
            cur.execute("SELECT current_user, current_database()")
            user, db = cur.fetchone()
            logger.info("接続先: user=%s db=%s schema=%s", user, db, args.schema)
            logger.info("モード: %s", "APPLY（書き込む）" if args.apply else "dry-run（読むだけ）")

            cur.execute(SELECT_SQL)
            rows = cur.fetchall()

            logger.info("")
            logger.info("=" * 78)
            logger.info("# currency_code が NULL のまま price_cents を持つレビュー: %s 行", len(rows))
            logger.info("=" * 78)
            if not rows:
                logger.info("対象なし。直すものはありません。")
                return 0

            planned = []
            for review_id, price_cents, created_at, name, country in rows:
                jp = (country or "").upper() == "JP"
                fixed = price_cents // WRONG_MINOR_UNIT_FACTOR if jp else None
                logger.info("")
                logger.info("review_id      : %s", review_id)
                logger.info("店             : %s（country_code=%s）", name, country)
                logger.info("作成日時       : %s", created_at)
                logger.info("いまの値       : price_cents=%s / currency_code=NULL", f"{price_cents:,}")
                if jp:
                    logger.info("直したあと     : price_cents=%s / currency_code=JPY  (= ¥%s)",
                                f"{fixed:,}", f"{fixed:,}")
                    planned.append((fixed, "JPY", review_id, price_cents))
                else:
                    logger.info("直したあと     : ⚠️ **直さない**（店が日本ではないので 100 で割る根拠が無い）")

            logger.info("")
            logger.info("直す対象: %s 行 / 直さない: %s 行", len(planned), len(rows) - len(planned))

            if not args.apply:
                logger.info("")
                logger.info("dry-run のため書き込んでいません。--apply を付けると実行します。")
                return 0

            updated = 0
            for fixed, currency, review_id, original in planned:
                cur.execute(UPDATE_SQL, (fixed, currency, review_id, original))
                updated += cur.rowcount
            conn.commit()
            logger.info("")
            logger.info("✅ %s 行を更新しました。", updated)

            # 直した結果をそのまま読み返す（«直したつもり» を残さない）
            cur.execute(SELECT_SQL)
            remaining = cur.fetchall()
            logger.info("残っている NULL 通貨の行: %s 行", len(remaining))
            return 0


if __name__ == "__main__":
    sys.exit(main())
