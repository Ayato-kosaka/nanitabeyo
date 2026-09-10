#!/usr/bin/env python3
"""#1667 «レビュー 0 件の料理» が実際にどれだけ画面へ出るかを dev の実 DB で数える（読み取り専用）。

## なぜ要るか

オーナー確定（2026-09-03）:

> 未評価の場合は何も出さないのが標準かと。

店舗詳細（`SelectedRestaurantDetails.tsx`）はこの規則に従っているが、**料理の評価を
出す画面が他に 2 つある**。

| 画面 | 出しているもの |
| --- | --- |
| `features/profile/tabs/LikeTab.tsx` | いいねした料理の ★ と (件数) |
| `features/map/components/tabs/RestaurantReviewsTab.tsx` | 店の料理タイルの ★ と (件数) |

どちらも `<Stars rating={entry.dish.averageRating} />` を**無条件で**描く。
API 側（`dish-media.repository.ts`）は

    reviewCount: dishStats?.reviewCount ?? 0,
    averageRating: dishStats?.averageRating ?? 0,

としているので、**0 は «取れなかったとき» の既定値として実際に返る**。
そのとき画面は ★ 5 つ空 + (0) を描き、«最低評価の料理» と見分けが付かない。

⚠️ **「コード上あり得る」と「実際に出ている」は別である。** どれだけ出るのかを
ここで数えてから直す（数えずに «直した» と言わない → CLAUDE.md「完了の定義」§1）。

## 何を数えるか

`dish_reviews` が 0 件になる `dishes` と、それにぶら下がる `dish_media` の数。
削除済みレビュー・削除済みユーザーのレビューは API と同じ条件で除外する。

⚠️ **判定条件を写経しない。** API 側の除外条件（`deleted_at IS NULL` と
削除ユーザー除外）とずれると、緑のまま古い数字を守り続ける。ここでは
条件を 1 箇所（`REVIEW_VISIBLE_SQL`）に置き、全部の集計から参照する。

## 使い方

    script_path: scripts/db-checks/measure_unrated_dishes.py
    args: --schema dev

環境変数: DATABASE_URL（必須）
"""

from __future__ import annotations

import argparse
import logging
import os
import sys

LOGGER = logging.getLogger(__name__)

# API（dish-media.repository.ts）が «見えるレビュー» とみなす条件。
# ここを 1 箇所に置き、下の集計は全部これを参照する。
# ⚠️ 退会ユーザーの扱いは `api/src/v1/dish-media/deleted-user-filter.ts` の
#    NOT_AUTHORED_BY_DELETED_USER と同じにすること。あちらは
#      OR: [{ user_id: null }, { users: { is: { deleted_at: null } } }]
#    で、「作者が居ない（取り込み由来）」と「作者が退会した」を**区別する**。
#    ここを `user_id` の有無だけで書くと、取り込みレビューを丸ごと落として
#    未評価の数を過大に見積もる。
REVIEW_VISIBLE_SQL = """
  dr.deleted_at IS NULL
  AND (
    dr.user_id IS NULL
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = dr.user_id AND u.deleted_at IS NULL
    )
  )
"""

COUNT_SQL = f"""
WITH visible_reviews AS (
  SELECT dr.dish_id, count(*) AS n
  FROM dish_reviews dr
  WHERE {REVIEW_VISIBLE_SQL}
  GROUP BY dr.dish_id
)
SELECT
  (SELECT count(*) FROM dishes)                                        AS dishes_total,
  (SELECT count(*) FROM dishes d
     WHERE NOT EXISTS (SELECT 1 FROM visible_reviews v WHERE v.dish_id = d.id))
                                                                       AS dishes_unrated,
  (SELECT count(*) FROM dish_media dm WHERE dm.deleted_at IS NULL)      AS media_total,
  (SELECT count(*) FROM dish_media dm
     WHERE dm.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM visible_reviews v WHERE v.dish_id = dm.dish_id))
                                                                       AS media_unrated
"""

# «いいねした料理» の画面に実際に出る行のうち、未評価のもの
LIKE_TAB_SQL = f"""
WITH visible_reviews AS (
  SELECT dr.dish_id FROM dish_reviews dr WHERE {REVIEW_VISIBLE_SQL} GROUP BY dr.dish_id
),
liked AS (
  -- dish_media_likes には削除列が無い（いいねは物理削除）
  SELECT DISTINCT dm.id, dm.dish_id
  FROM dish_media_likes l
  JOIN dish_media dm ON dm.id = l.dish_media_id AND dm.deleted_at IS NULL
)
SELECT
  count(*) AS liked_total,
  count(*) FILTER (
    WHERE NOT EXISTS (SELECT 1 FROM visible_reviews v WHERE v.dish_id = liked.dish_id)
  ) AS liked_unrated
FROM liked
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
            # 読むだけ。書き込みは接続レベルで禁止する
            cur.execute("SET default_transaction_read_only = on")
            cur.execute(f'SET search_path TO "{args.schema}", extensions')

            cur.execute(COUNT_SQL)
            dishes_total, dishes_unrated, media_total, media_unrated = cur.fetchone()

            LOGGER.info("=" * 68)
            LOGGER.info("# #1667 レビュー 0 件の料理（schema=%s）", args.schema)
            LOGGER.info("=" * 68)
            _report("dishes", dishes_unrated, dishes_total)
            _report("dish_media", media_unrated, media_total)

            try:
                cur.execute(LIKE_TAB_SQL)
                liked_total, liked_unrated = cur.fetchone()
                LOGGER.info("")
                LOGGER.info("## いいねした料理（LikeTab に実際に出る行）")
                _report("liked dish_media", liked_unrated, liked_total)
            except Exception as error:  # noqa: BLE001
                # いいねのテーブル名が違う環境でも、上の主要な数字は出し切る
                conn.rollback()
                LOGGER.warning("いいねの集計は取れなかった: %s", error)

            LOGGER.info("")
            LOGGER.info(
                "⚠️ 未評価の行は ★5 つ空 + (0) で描かれ、«最低評価» と見分けが付かない。"
            )
    return 0


def _report(label: str, unrated: int, total: int) -> None:
    pct = (unrated / total * 100) if total else 0.0
    LOGGER.info(
        "%-18s 未評価 %s / %s （%.2f%%）",
        label,
        f"{unrated:,}",
        f"{total:,}",
        pct,
    )


if __name__ == "__main__":
    sys.exit(main())
