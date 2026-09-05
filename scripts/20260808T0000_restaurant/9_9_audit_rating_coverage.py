#!/usr/bin/env python3
"""#1667 平均評価の coverage を数える。**自前レビューだけで何割の店に星を出せるか。**

## なぜ必要か

#1667 の設計調査（issue コメント 5508832410）は「本番の `dish_reviews.rating` 充足率と
新規店舗の評価 0 件率は **BigQuery 認証が無く未計測**」と書いて終わっている。
**#1667 の完了条件「coverage が計測され、#843 に反映されている」がそこで止まっている。**

表示の規則そのものは既にオーナーが確定して実装済み（2026-09-03、
`SelectedRestaurantDetails.tsx`: **レビュー 0 件のときは何も出さない**。「未評価」という
ラベルも出さない）。したがって残っているのは «その «何も出さない» が何割の店で起きるか»
という数字だけである。

## ⚠️ この数字の読み方

**「星が出ない店の割合」であって「壊れている割合」ではない。** 0 件のときに何も出さないのは
オーナーが決めた仕様であって不具合ではない。この数字が答えるのは次の 1 問だけ:

> 自前レビューだけで、ユーザーが星を見られる店はどれくらいあるか。

Google の rating をライブ表示で補うか（#1667 の選択肢 b）を判断するための分母になる。

## 出所で分けて数える

`created_by_source` で分ける。**混ぜると数字の意味が消える。**

| 行の種類 | 期待 |
| --- | --- |
| パイプライン製（62 万件） | ほぼ全部 0 件。誰も投稿していないので当たり前 |
| アプリ製（ユーザーが作った店） | ここが «実際に使われている店» に近い。**ここの充足率が本命** |

全体の充足率だけ出すと、62 万件のパイプライン行に薄められて **常に 0% 近く**になり、
「Google の rating が要るか」の判断材料にならない。

## 何をしないか

**1 行も書き換えない。** SELECT だけ。

実行:
    python3 scripts/20260808T0000_restaurant/9_9_audit_rating_coverage.py --schema dev
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

# 生きているレビューを持つ店。
#
# ⚠️ **本番の集計と同じ条件にすること。** restaurants.repository.ts の LATERAL は
#    `dr.dish_id = d.id AND dr.deleted_at IS NULL`（#1513 で削除済みを除外）で数えている。
#    ここで `deleted_at` を落とすと、**画面に星が出ない店を «出る» と数えて**しまう。
HAS_REVIEW = """
  EXISTS (
    SELECT 1 FROM dishes d
    JOIN dish_reviews dr ON dr.dish_id = d.id AND dr.deleted_at IS NULL
    WHERE d.restaurant_id = r.id
  )
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="平均評価の coverage を数えます（読み取り専用）")
    parser.add_argument("--schema", choices=["dev", "public"], required=True)
    parser.add_argument("--allow-public", action="store_true")
    return parser.parse_args()


def pct(n: int, d: int) -> str:
    return f"{n / d * 100:.2f}%" if d else "—"


def main() -> None:
    configure_logging()
    args = parse_args()

    connection = connect_postgres(args.schema, allow_public=args.allow_public)
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT
                  COALESCE(created_by_source, '(不明)') AS src,
                  COUNT(*) AS total,
                  COUNT(*) FILTER (WHERE {HAS_REVIEW}) AS with_review
                FROM restaurants r
                GROUP BY 1
                ORDER BY 2 DESC
                """
            )
            rows = cursor.fetchall()

            LOGGER.info("店の出所ごとの «星を出せる割合»（自前レビューのみ）")
            grand_total = grand_with = 0
            for src, total, with_review in rows:
                grand_total += total
                grand_with += with_review
                LOGGER.info(
                    "  %-12s 全 %7d 件 / レビューあり %6d 件  (%s)",
                    src,
                    total,
                    with_review,
                    pct(with_review, total),
                )
            LOGGER.info(
                "  %-12s 全 %7d 件 / レビューあり %6d 件  (%s)  ← 出所を混ぜた数字。判断には使わない",
                "合計",
                grand_total,
                grand_with,
                pct(grand_with, grand_total),
            )

            # レビュー件数の分布。«1 件だけの店» が多いなら、★1 件の平均が
            # そのまま星になる（#1667 の «何件貯まったら数字を出すか» の材料）。
            cursor.execute(
                """
                SELECT c.n, COUNT(*)
                FROM (
                  SELECT d.restaurant_id, COUNT(dr.id) AS n
                  FROM dishes d
                  JOIN dish_reviews dr ON dr.dish_id = d.id AND dr.deleted_at IS NULL
                  GROUP BY d.restaurant_id
                ) c
                GROUP BY c.n
                ORDER BY c.n
                LIMIT 20
                """
            )
            LOGGER.info("レビューを持つ店の «件数» の分布（上位 20 段）")
            for n, count in cursor.fetchall():
                LOGGER.info("  %3d 件のレビューを持つ店: %d 件", n, count)

            # ⚠️ 平均が 0.0 になる店。**仕様どおり非表示になる 0 件とは別物**で、
            #    «実際に ★0 が付いている» なら星 0 個が正しく出る。混同しないための番人。
            cursor.execute(
                """
                SELECT COUNT(*) FROM (
                  SELECT d.restaurant_id, AVG(dr.rating) AS avg_rating
                  FROM dishes d
                  JOIN dish_reviews dr ON dr.dish_id = d.id AND dr.deleted_at IS NULL
                  GROUP BY d.restaurant_id
                ) c WHERE c.avg_rating = 0
                """
            )
            LOGGER.info(
                "レビューはあるが平均が 0.0 の店: %d 件  ← 0 件（非表示）とは別物",
                cursor.fetchone()[0],
            )
    finally:
        connection.rollback()
        connection.close()


if __name__ == "__main__":
    main()
