#!/usr/bin/env python3
"""#1264 レビューの «自社UGC / Google取り込み» の内訳を測る（読み取り専用）。

## なぜ要るか

#1264 の最初のタスクが「現在の自社レビュー充足率を計測する」である。
Google のレビュー本文を保存するのをやめられるかどうかは、**やめた瞬間に
何が画面から消えるか**で決まる。その量を数字で出すのがこのスクリプト。

`dish_reviews` の 1 行がどちらの出所かは、次で見分ける（`dishes.service.ts`
の Google 一括取り込みが `imported_user_name` / `imported_user_avatar` を
埋めており、自社UGCはそこが NULL で `user_id` が入る）。

| 出所 | 見分け方 |
| --- | --- |
| 自社UGC | `user_id IS NOT NULL AND imported_user_name IS NULL` |
| Google 取り込み | `imported_user_name IS NOT NULL` |

この判定は 1 箇所（`REVIEW_ORIGIN_PREDICATES`）だけに置き、全 Stage が
そこから引く。同じ条件を 2 箇所に書いた時点でズレ始めるため。

## 使い方（db-script-run.yml）

```
script_path: scripts/db-checks/measure_review_coverage.py
args: --schema dev
requirements_path: scripts/20251213T0000_wikidata_food_graph/requirements.txt
```

読み取り専用。`SET default_transaction_read_only = on` を最初に流し、
一時テーブルも作らない（このスクリプトは素の集計だけで足りる）。
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
# 出所の判定。**ここだけに書く。**
# ---------------------------------------------------------------------------
# 生きているレビューだけを数える（論理削除は除外）。
ALIVE_PREDICATE = "dr.deleted_at IS NULL"

REVIEW_ORIGIN_PREDICATES = {
    # 自社UGC: アプリのユーザーが書いたもの。
    "own_ugc": "dr.user_id IS NOT NULL AND dr.imported_user_name IS NULL",
    # Google 一括取り込み: dishes.service.ts の bulkImportFromGoogle が入れたもの。
    "google_import": "dr.imported_user_name IS NOT NULL",
}


def build_totals_sql() -> str:
    """全体の内訳（件数）。"""
    cases = ",\n".join(
        f"  count(*) FILTER (WHERE {pred}) AS {key}"
        for key, pred in REVIEW_ORIGIN_PREDICATES.items()
    )
    return (
        "SELECT\n"
        "  count(*) AS total,\n"
        f"{cases},\n"
        "  count(*) FILTER (WHERE dr.user_id IS NULL AND dr.imported_user_name IS NULL)"
        " AS unattributed\n"
        "FROM dish_reviews dr\n"
        f"WHERE {ALIVE_PREDICATE}"
    )


def build_restaurants_with_reviews_sql(origin_key: str | None) -> str:
    """レビューを持つ «店舗» の数。origin_key を指定するとその出所だけで数える。

    `dish_reviews` は dish（= restaurant × dish_category）にぶら下がるので、
    店舗単位にするには dishes を経由して数え直す必要がある。
    """
    where = [ALIVE_PREDICATE]
    if origin_key is not None:
        where.append(f"({REVIEW_ORIGIN_PREDICATES[origin_key]})")
    return (
        "SELECT count(DISTINCT d.restaurant_id)\n"
        "FROM dish_reviews dr\n"
        "JOIN dishes d ON d.id = dr.dish_id\n"
        f"WHERE {' AND '.join(where)}"
    )


def build_reviewers_sql() -> str:
    """自社UGC を書いた «人» の数。cold-start の分母。"""
    return (
        "SELECT count(DISTINCT dr.user_id)\n"
        "FROM dish_reviews dr\n"
        f"WHERE {ALIVE_PREDICATE} AND ({REVIEW_ORIGIN_PREDICATES['own_ugc']})"
    )


def build_google_only_restaurants_sql() -> str:
    """**Google のレビューしか無い店**の数。

    Google の保存をやめた瞬間に «レビューが 1 件も無い店» へ落ちるのがここ。
    #1264 の判断材料そのもの。
    """
    return (
        "WITH per_restaurant AS (\n"
        "  SELECT\n"
        "    d.restaurant_id,\n"
        f"    count(*) FILTER (WHERE {REVIEW_ORIGIN_PREDICATES['own_ugc']}) AS own_ugc,\n"
        f"    count(*) FILTER (WHERE {REVIEW_ORIGIN_PREDICATES['google_import']})"
        " AS google_import\n"
        "  FROM dish_reviews dr\n"
        "  JOIN dishes d ON d.id = dr.dish_id\n"
        f"  WHERE {ALIVE_PREDICATE}\n"
        "  GROUP BY d.restaurant_id\n"
        ")\n"
        "SELECT\n"
        "  count(*) FILTER (WHERE google_import > 0 AND own_ugc = 0) AS google_only,\n"
        "  count(*) FILTER (WHERE own_ugc > 0) AS has_own_ugc,\n"
        "  count(*) AS restaurants_with_any_review\n"
        "FROM per_restaurant"
    )


def build_total_restaurants_sql() -> str:
    return "SELECT count(*) FROM restaurants"


def _scalar(cur, sql: str):
    cur.execute(sql)
    return cur.fetchone()[0]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
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
    }

    with conn.cursor() as cur:
        cur.execute(f'SET search_path TO "{args.schema}", public')
        # 書き込みは一切しない。読み取り専用へ落としてから数える。
        cur.execute("SET default_transaction_read_only = on")

        print("=" * 72)
        print("# レビューの出所ごとの件数")
        print("=" * 72)
        cur.execute(build_totals_sql())
        total, own_ugc, google_import, unattributed = cur.fetchone()
        result["reviews"] = {
            "total": total,
            "own_ugc": own_ugc,
            "google_import": google_import,
            "unattributed": unattributed,
        }
        for label, value in (
            ("レビュー総数（生きている行）", total),
            ("  うち 自社UGC", own_ugc),
            ("  うち Google 取り込み", google_import),
            ("  うち どちらでもない（退会ユーザー等）", unattributed),
        ):
            share = f"（{value / total:.1%}）" if total else ""
            print(f"{label:<40} {value:>10,} {share}")

        print()
        print("=" * 72)
        print("# レビューを持つ店舗数")
        print("=" * 72)
        total_restaurants = _scalar(cur, build_total_restaurants_sql())
        cur.execute(build_google_only_restaurants_sql())
        google_only, has_own_ugc, with_any = cur.fetchone()
        result["restaurants"] = {
            "total": total_restaurants,
            "with_any_review": with_any,
            "with_own_ugc": has_own_ugc,
            "google_review_only": google_only,
        }
        for label, value in (
            ("restaurants 総数", total_restaurants),
            ("  レビューが1件でもある店", with_any),
            ("  自社UGCが1件でもある店", has_own_ugc),
            ("  Googleのレビューしか無い店", google_only),
        ):
            share = f"（{value / total_restaurants:.3%}）" if total_restaurants else ""
            print(f"{label:<40} {value:>10,} {share}")

        print()
        print("=" * 72)
        print("# 自社UGCを書いた人の数")
        print("=" * 72)
        reviewers = _scalar(cur, build_reviewers_sql())
        result["reviewers"] = reviewers
        print(f"{'レビューを書いたユーザー数':<40} {reviewers:>10,}")

        print()
        print("『Googleのレビューしか無い店』が、Google の保存をやめた瞬間に")
        print("「レビュー0件」へ落ちる店である（#1264 の判断材料）。")

    conn.close()
    print()
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
