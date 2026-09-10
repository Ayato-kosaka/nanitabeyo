#!/usr/bin/env python3
"""#1774 の最初のタスク「現行 `dish_reviews.price_cents` のデータ量・充足率を実測する」
（読み取り専用）。

## なぜ要るか

#1774 は「`restaurant × dish_category` の価格帯をどう作るか」を決めるチケットだが、
**自社のレビュー由来価格データが今どれだけあるのかを誰も測っていない**。それが分からないと
«自社レビューだけで足りるのか / cold-start の取得経路が必須なのか» を決められない。

このスクリプトは集計ルールも UI も決めない。**測るだけ**である。

## 「価格付きレビュー」の判定は 1 箇所にだけ書く

生きている（論理削除されていない）レビューのうち `price_cents` が入っているもの。
`PRICED_REVIEW_PREDICATE` にだけ書き、全 Stage がそこを参照する
（`measure_review_coverage.py` の `REVIEW_ORIGIN_PREDICATES` と同じ作り。写経すると
数字が静かにズレ始める）。

## 出すもの

1. `dish_reviews` の総数（生きている行）と、うち price_cents 有りの件数・割合
2. 価格付きレビューの `currency_code` 内訳（NULL も 1 バケットとして含む）
3. `restaurant × dish_category` 単位で、価格付きレビューを 1 件以上 / 3 件以上 持つ
   組み合わせの件数（価格帯を «出せる» 組み合わせがどれだけあるか）
4. 価格付きレビューを持つ店舗数と、`restaurants` 総数に対する割合
5. 通貨ごとの価格分布（min / p25 / median / p75 / max）。丸めない生の `price_cents`
6. 価格付きレビューの新しさの分布（直近90日 / 直近1年（90日超）/ それ以前）。
   基準は `created_at`（レビューを記録した日時。`eaten_at` は「食べた日」でありレビューが
   いつ書かれたかとは別物なので、鮮度の判断には使わない）

## 読み取り専用である

一時テーブルを含め、一切の書き込み・DDL を行わない。接続直後に
`SET default_transaction_read_only = on` を実行してから集計する
（`measure_review_coverage.py` と同じ）。一時テーブルは必要ない
（すべて単純な集計クエリで、`measure_dish_media_coverage.py` のような空間結合を伴わない）。

## 使い方（db-script-run.yml から）

    script_path: scripts/db-checks/measure_price_coverage.py
    args: --schema dev
    requirements_path: scripts/20251213T0000_wikidata_food_graph/requirements.txt

ローカルでの単体テスト（DB 接続なし、SQL の組み立てだけを検査）:

    python3 -m unittest scripts/db-checks/test_measure_price_coverage.py -v

環境変数:
    DATABASE_URL … PostgreSQL 接続文字列（必須。db-script-run.yml が secrets から渡す）
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

# psycopg2 はモジュール読み込み時ではなく main() の中で import する。
# SQL 組み立ての純関数だけを DB 無しの環境（unittest / CI）から検査したいため。

# ---------------------------------------------------------------------------
# 「価格付きレビュー」の判定。**ここだけに書く。**
# ---------------------------------------------------------------------------
ALIVE_PREDICATE = "dr.deleted_at IS NULL"
PRICE_PRESENT_PREDICATE = "dr.price_cents IS NOT NULL"
PRICED_REVIEW_PREDICATE = f"{ALIVE_PREDICATE} AND {PRICE_PRESENT_PREDICATE}"


def build_totals_sql() -> str:
    """dish_reviews の総数（生きている行）と、うち価格付きの件数。"""
    return (
        "SELECT\n"
        "  count(*) AS total,\n"
        f"  count(*) FILTER (WHERE {PRICE_PRESENT_PREDICATE}) AS priced\n"
        "FROM dish_reviews dr\n"
        f"WHERE {ALIVE_PREDICATE}"
    )


def build_currency_breakdown_sql() -> str:
    """価格付きレビューの currency_code 内訳（NULL も 1 グループとして含む）。"""
    return (
        "SELECT dr.currency_code, count(*) AS n\n"
        "FROM dish_reviews dr\n"
        f"WHERE {PRICED_REVIEW_PREDICATE}\n"
        "GROUP BY dr.currency_code\n"
        "ORDER BY n DESC"
    )


def build_pair_coverage_sql() -> str:
    """`restaurant × dish_category` 単位で、価格帯を «出せる» 組み合わせの件数。

    価格付きレビューを 1 件以上 / 3 件以上 持つ組み合わせをそれぞれ数える。
    """
    return (
        "WITH pair_counts AS (\n"
        "  SELECT d.restaurant_id, d.category_id, count(*) AS priced_count\n"
        "  FROM dish_reviews dr\n"
        "  JOIN dishes d ON d.id = dr.dish_id\n"
        f"  WHERE {PRICED_REVIEW_PREDICATE}\n"
        "  GROUP BY d.restaurant_id, d.category_id\n"
        ")\n"
        "SELECT\n"
        "  count(*) AS pairs_with_1_or_more,\n"
        "  count(*) FILTER (WHERE priced_count >= 3) AS pairs_with_3_or_more\n"
        "FROM pair_counts"
    )


def build_restaurants_with_priced_reviews_sql() -> str:
    """価格付きレビューを持つ «店舗» の数。

    `dish_reviews` は dish（= restaurant × dish_category）にぶら下がるので、
    店舗単位にするには dishes を経由して数え直す必要がある
    （`measure_review_coverage.py` の `build_restaurants_with_reviews_sql` と同じ理由）。
    """
    return (
        "SELECT count(DISTINCT d.restaurant_id)\n"
        "FROM dish_reviews dr\n"
        "JOIN dishes d ON d.id = dr.dish_id\n"
        f"WHERE {PRICED_REVIEW_PREDICATE}"
    )


def build_total_restaurants_sql() -> str:
    return "SELECT count(*) FROM restaurants"


def build_price_distribution_sql() -> str:
    """通貨ごとの価格分布（min / p25 / median / p75 / max）。丸めない生の price_cents。

    外れ値・複数通貨の扱いを決めるための材料であり、このスクリプトでは判断しない。
    """
    return (
        "SELECT\n"
        "  dr.currency_code,\n"
        "  count(*) AS n,\n"
        "  min(dr.price_cents) AS min_price_cents,\n"
        "  percentile_cont(0.25) WITHIN GROUP (ORDER BY dr.price_cents) AS p25_price_cents,\n"
        "  percentile_cont(0.5) WITHIN GROUP (ORDER BY dr.price_cents) AS median_price_cents,\n"
        "  percentile_cont(0.75) WITHIN GROUP (ORDER BY dr.price_cents) AS p75_price_cents,\n"
        "  max(dr.price_cents) AS max_price_cents\n"
        "FROM dish_reviews dr\n"
        f"WHERE {PRICED_REVIEW_PREDICATE}\n"
        "GROUP BY dr.currency_code\n"
        "ORDER BY n DESC"
    )


def build_recency_buckets_sql() -> str:
    """価格付きレビューの新しさの分布。基準は created_at（記録した日時）。

    `eaten_at` は「食べた日」であり、いつ価格情報として記録されたかとは別物なので
    鮮度判定には使わない（レビュー本文の docstring 「なぜ要るか」参照）。
    """
    return (
        "SELECT\n"
        "  count(*) FILTER (WHERE dr.created_at >= now() - interval '90 days')"
        " AS within_90_days,\n"
        "  count(*) FILTER (WHERE dr.created_at < now() - interval '90 days'"
        " AND dr.created_at >= now() - interval '365 days') AS within_1_year,\n"
        "  count(*) FILTER (WHERE dr.created_at < now() - interval '365 days')"
        " AS older_than_1_year\n"
        "FROM dish_reviews dr\n"
        f"WHERE {PRICED_REVIEW_PREDICATE}"
    )


def _scalar(cur, sql: str):
    cur.execute(sql)
    return cur.fetchone()[0]


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--schema", default="dev", help="測定対象スキーマ（dev / public）")
    parser.add_argument(
        "--database-url",
        default=None,
        help="接続文字列。省略時は環境変数 DATABASE_URL",
    )
    args = parser.parse_args()

    import psycopg2

    database_url = args.database_url or os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL が無い", file=sys.stderr)
        return 1

    conn = psycopg2.connect(database_url)
    conn.autocommit = True
    result: dict = {
        "schema": args.schema,
        "measured_at": datetime.now(timezone.utc).isoformat(),
        "assumptions": {
            "priced_review_definition": (
                "生きている（deleted_at IS NULL）dish_reviews のうち "
                "price_cents IS NOT NULL の行"
            ),
            "recency_basis": (
                "created_at（レビューを記録した日時）。eaten_at（食べた日）は使っていない"
            ),
        },
    }

    with conn.cursor() as cur:
        cur.execute(f'SET search_path TO "{args.schema}", public')
        # 書き込みは一切しない。読み取り専用へ落としてから数える。
        cur.execute("SET default_transaction_read_only = on")

        print("=" * 72)
        print("# 1. dish_reviews の総数と price_cents 充足率")
        print("=" * 72)
        cur.execute(build_totals_sql())
        total, priced = cur.fetchone()
        result["reviews"] = {"total": total, "priced": priced}
        share = f"（{priced / total:.1%}）" if total else ""
        print(f"{'dish_reviews 総数（生きている行）':<40} {total:>10,}")
        print(f"{'  うち price_cents 有り':<40} {priced:>10,} {share}")

        print()
        print("=" * 72)
        print("# 2. 価格付きレビューの currency_code 内訳")
        print("=" * 72)
        cur.execute(build_currency_breakdown_sql())
        currency_rows = cur.fetchall()
        result["currency_breakdown"] = [
            {"currency_code": code, "n": n} for code, n in currency_rows
        ]
        for code, n in currency_rows:
            label = code if code is not None else "(NULL)"
            share = f"（{n / priced:.1%}）" if priced else ""
            print(f"{label:<40} {n:>10,} {share}")

        print()
        print("=" * 72)
        print("# 3. restaurant × dish_category 単位の価格帯カバレッジ")
        print("=" * 72)
        cur.execute(build_pair_coverage_sql())
        pairs_1_or_more, pairs_3_or_more = cur.fetchone()
        result["pair_coverage"] = {
            "pairs_with_1_or_more_priced_reviews": pairs_1_or_more,
            "pairs_with_3_or_more_priced_reviews": pairs_3_or_more,
        }
        print(f"{'価格付きレビューが1件以上ある組み合わせ':<40} {pairs_1_or_more:>10,}")
        print(f"{'価格付きレビューが3件以上ある組み合わせ':<40} {pairs_3_or_more:>10,}")

        print()
        print("=" * 72)
        print("# 4. 価格付きレビューを持つ店舗数")
        print("=" * 72)
        total_restaurants = _scalar(cur, build_total_restaurants_sql())
        restaurants_with_priced = _scalar(cur, build_restaurants_with_priced_reviews_sql())
        result["restaurants"] = {
            "total": total_restaurants,
            "with_priced_review": restaurants_with_priced,
        }
        share = (
            f"（{restaurants_with_priced / total_restaurants:.3%}）"
            if total_restaurants
            else ""
        )
        print(f"{'restaurants 総数':<40} {total_restaurants:>10,}")
        print(f"{'  価格付きレビューが1件でもある店':<40} {restaurants_with_priced:>10,} {share}")

        print()
        print("=" * 72)
        print("# 5. 通貨ごとの価格分布（price_cents、生の値）")
        print("=" * 72)
        cur.execute(build_price_distribution_sql())
        distribution_rows = cur.fetchall()
        result["price_distribution"] = [
            {
                "currency_code": code,
                "n": n,
                "min_price_cents": min_v,
                "p25_price_cents": float(p25) if p25 is not None else None,
                "median_price_cents": float(median) if median is not None else None,
                "p75_price_cents": float(p75) if p75 is not None else None,
                "max_price_cents": max_v,
            }
            for code, n, min_v, p25, median, p75, max_v in distribution_rows
        ]
        for row in result["price_distribution"]:
            label = row["currency_code"] if row["currency_code"] is not None else "(NULL)"
            print(
                f"{label:<8} n={row['n']:>8,} "
                f"min={row['min_price_cents']:>10} "
                f"p25={row['p25_price_cents']:>10} "
                f"median={row['median_price_cents']:>10} "
                f"p75={row['p75_price_cents']:>10} "
                f"max={row['max_price_cents']:>10}"
            )

        print()
        print("=" * 72)
        print("# 6. 価格付きレビューの新しさ（created_at 基準）")
        print("=" * 72)
        cur.execute(build_recency_buckets_sql())
        within_90_days, within_1_year, older_than_1_year = cur.fetchone()
        result["recency"] = {
            "within_90_days": within_90_days,
            "within_1_year": within_1_year,
            "older_than_1_year": older_than_1_year,
        }
        for label, value in (
            ("直近90日", within_90_days),
            ("90日超〜1年以内", within_1_year),
            ("1年超", older_than_1_year),
        ):
            share = f"（{value / priced:.1%}）" if priced else ""
            print(f"{label:<40} {value:>10,} {share}")

    conn.close()
    print()
    print("=" * 72)
    print("# JSON（機械可読）")
    print("=" * 72)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
