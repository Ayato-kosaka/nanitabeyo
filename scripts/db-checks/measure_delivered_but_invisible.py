#!/usr/bin/env python3
"""#1273 «配信したのに見えない» を数える（読み取り専用）。

## なぜ要るのか

dev へ dish_media を 14 万行配信したが、E2E で «実際に目に触れうるのは 1/4 だけ» と
報告された。その «1/4» が何を分母・分子にした数なのか、KPI（area × カテゴリのセルに
**異なり店** が 5 店）に効くのか、どちらもコードを読むだけでは決まらない。**数える。**

## 何を測るか

| # | 問い | 出す数 |
| --- | --- | --- |
| 1 | 配信した行のうち «使える» のは何行か | `usable-dish-media-filter.ts` の 4 条件を当てた件数 |
| 2 | そのうちユーザーが到達できるのは何行か | 店舗詳細（`findDishMediaByRestaurant`）が返す «1 dish 1 件» の件数 |
| 3 | 見えない行は KPI に効くか | usable 集合と可視集合で «(店, カテゴリ)» と «店» の異なり数を比べる |
| 4 | 真っ黒（絵が 1 枚も出ない）は何行か | assembler のフォールバック 3 段を同じ順で当てて数える |
| 5 | 真っ黒を配信段階で落としたら KPI をいくつ失うか | 落とした後に «そのカテゴリの唯一の可視行» を失う (店, カテゴリ) 数 |

判定の写経を避けるため、usable の 4 条件は `dish_media_coverage_sql.usable_dish_media_conditions_sql()`
経由で **本番 TS から書き出したファイル**を読む（`sql/usable_dish_media_conditions.sql`）。

## 可視集合の定義（コードから写した «形» ではなく «出典» を書く）

- **店舗詳細**: `api/src/v1/dish-media/dish-media.repository.ts` `findDishMediaByRestaurant`。
  `ROW_NUMBER() OVER (PARTITION BY dish_id ORDER BY like_count DESC, dish_media_id DESC)` の
  `rn = 1` だけを返す。**1 dish につき永久に 1 件**。
- **店提案フィード**: 同ファイル `findDishMediaIds` の `unique_per_restaurant`。
  bucket ごとに `PARTITION BY bucket, restaurant_id` の 1 位だけを残す。
  つまり **1 店につき高々 1 件**で、店舗詳細より狭い。ただし並べ替えの鍵が違う
  （base_score / dish_media_id 昇順）ので、店舗詳細の代表とは別の行を選びうる。
  そこで «フィードが増やしうる上限» を «usable が 2 件以上ある店の数» として別に出す。

## 真っ黒の判定（出典）

`api/src/v1/dish-media/dish-media.assembler.ts` の `thumbnailImageUrl`:

    getThumbnailImageUrl(dm)            -- thumbnail_path が空なら null
      ?? externalEmbed.thumbnailUrl     -- provider の URL。9_1 は常に NULL を入れる
      ?? dish.categoryImageUrl          -- dish_categories.image_url（NOT NULL なので空文字あり）

`dish_categories.image_url` は **NOT NULL の TEXT** なので «無い» は空文字で来る。
空文字は `??` を通り抜けるため、3 段目が空文字なら `thumbnailImageUrl` は空文字になり、
`getDishMediaBackgroundImageUri` の結果が falsy → 背景画像を 1 枚も描かない = 真っ黒。

## 読むだけ

一時テーブルを作る区間を除いて `default_transaction_read_only = on`。
永続テーブルへの DDL/DML は 1 つも実行しない（`measure_dish_media_coverage.py` と同じ作法）。

## 使い方

    python3 scripts/db-checks/measure_delivered_but_invisible.py --schema dev

環境変数:
    DATABASE_URL … PostgreSQL 接続文字列（必須）
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import psycopg2

sys.path.insert(0, str(Path(__file__).resolve().parent))

import dish_media_coverage_sql as coverage_sql  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stdout)
logger = logging.getLogger(__name__)


def section(title: str) -> None:
    logger.info("\n%s\n%s", title, "=" * len(title))


def pct(part: int, whole: int) -> str:
    return f"{(100.0 * part / whole):.2f}%" if whole else "n/a"


# ---------------------------------------------------------------------------
# 一時テーブル
# ---------------------------------------------------------------------------

# usable な行を、可視判定・真っ黒判定に要る列ごと materialize する。
# ⚠️ WHERE の 4 条件は書き下さない。coverage_sql が本番 TS の書き出しを読む。
# ⚠️ dish_media_external_embeddings は PK = dish_media_id（1:1）なので LEFT JOIN で増えない
#    （20260824T0200_create_dish_media_external_embeddings.sql）。
def build_usable_sql() -> str:
    return (
        "CREATE TEMP TABLE usable_rows AS\n"
        "SELECT\n"
        "  dm.id            AS dish_media_id,\n"
        "  dm.dish_id       AS dish_id,\n"
        "  d.restaurant_id  AS restaurant_id,\n"
        "  d.category_id    AS category_id,\n"
        "  dm.render_type   AS render_type,\n"
        "  (dm.thumbnail_path IS NOT NULL AND dm.thumbnail_path <> '') AS has_stored_thumbnail,\n"
        "  (e.thumbnail_url IS NOT NULL AND e.thumbnail_url <> '')     AS has_provider_thumbnail,\n"
        "  (c.image_url IS NOT NULL AND c.image_url <> '')             AS has_category_image,\n"
        "  (e.dish_media_id IS NOT NULL)                               AS has_embed_row,\n"
        "  e.embed_status   AS embed_status,\n"
        "  e.playback_status AS playback_status,\n"
        "  COALESCE(a.like_total, 0) AS like_total\n"
        "FROM dish_media dm\n"
        "JOIN dishes d ON d.id = dm.dish_id\n"
        "JOIN dish_categories c ON c.id = d.category_id\n"
        "LEFT JOIN dish_media_external_embeddings e ON e.dish_media_id = dm.id\n"
        "LEFT JOIN dish_media_analysis_results a ON a.dish_media_id = dm.id\n"
        "WHERE 1=1\n  " + coverage_sql.usable_dish_media_conditions_sql()
    )


# 店舗詳細（findDishMediaByRestaurant）が返す代表 1 件。並べ替えの鍵も本番と同じ。
VISIBLE_SQL = """
CREATE TEMP TABLE visible_rows AS
SELECT * FROM (
  SELECT u.*,
         ROW_NUMBER() OVER (
           PARTITION BY u.dish_id
           ORDER BY u.like_total DESC, u.dish_media_id DESC
         ) AS rn
  FROM usable_rows u
) t
WHERE t.rn = 1
"""

# 真っ黒 = assembler の 3 段が全部空。external_embed 以外は 3 段目に到達しないので、
# 「絵が無いのに external_embed でない」行も別に数える（別の状態＝加工中なので分けて出す）。
BLACK_EXPR = (
    "(NOT has_stored_thumbnail AND NOT has_provider_thumbnail "
    "AND has_embed_row AND NOT has_category_image)"
)


def run(cur, schema: str) -> None:
    measured_at = datetime.now(timezone.utc).isoformat()
    cur.execute(f'SET search_path TO "{schema}", extensions')
    cur.execute("SET statement_timeout = '600s'")
    cur.execute("SELECT current_user, current_database()")
    user, db = cur.fetchone()
    logger.info("接続先: user=%s db=%s schema=%s / 測定(UTC)=%s", user, db, schema, measured_at)

    # ---- 一時テーブル（この区間だけ read-only を外す）
    cur.execute(build_usable_sql())
    cur.execute("CREATE INDEX ON usable_rows (dish_id)")
    cur.execute("CREATE INDEX ON usable_rows (restaurant_id)")
    cur.execute(VISIBLE_SQL)
    cur.execute("SET default_transaction_read_only = on")

    # ---------------------------------------------------------------- §1
    section("1. 配信した行 / 使える行 / 見える行")
    cur.execute(
        """
        SELECT count(*),
               count(*) FILTER (WHERE render_type = 'external_embed'),
               count(*) FILTER (WHERE deleted_at IS NOT NULL)
        FROM dish_media
        """
    )
    total, total_embed, total_deleted = cur.fetchone()
    cur.execute("SELECT count(*) FROM dishes")
    (dishes_total,) = cur.fetchone()
    cur.execute("SELECT count(*), count(*) FILTER (WHERE render_type='external_embed') FROM usable_rows")
    usable, usable_embed = cur.fetchone()
    cur.execute("SELECT count(*), count(*) FILTER (WHERE render_type='external_embed') FROM visible_rows")
    visible, visible_embed = cur.fetchone()

    logger.info("dish_media 総数            : %s（うち external_embed %s / 論理削除済み %s）",
                f"{total:,}", f"{total_embed:,}", f"{total_deleted:,}")
    logger.info("dishes 総数                : %s", f"{dishes_total:,}")
    logger.info("usable（4 条件通過）        : %s  = 総数の %s", f"{usable:,}", pct(usable, total))
    logger.info("可視（店舗詳細の 1 dish 1 件）: %s  = 総数の %s / usable の %s",
                f"{visible:,}", pct(visible, total), pct(visible, usable))
    logger.info("  うち external_embed       : usable %s → 可視 %s", f"{usable_embed:,}", f"{visible_embed:,}")
    logger.info("見えない行                 : %s（= usable − 可視）", f"{usable - visible:,}")

    cur.execute(
        """
        SELECT n, count(*) FROM (
          SELECT dish_id, count(*) AS n FROM usable_rows GROUP BY dish_id
        ) t GROUP BY n ORDER BY n
        """
    )
    rows = cur.fetchall()
    logger.info("\n1 dish あたりの usable 件数の分布（件数: dish 数）")
    shown = 0
    for n, cnt in rows:
        if n <= 10 or shown < 3:
            logger.info("  %3d 件: %s dish", n, f"{cnt:,}")
            shown += 1
    tail = sum(c for n, c in rows if n > 10)
    if tail:
        logger.info("  11 件以上: %s dish（最大 %d 件）", f"{tail:,}", max(n for n, _ in rows))

    cur.execute("SELECT count(*) FROM (SELECT restaurant_id FROM usable_rows GROUP BY restaurant_id HAVING count(*) >= 2) t")
    (rest_multi,) = cur.fetchone()
    logger.info(
        "\n店提案フィードは 1 店 1 件（unique_per_restaurant）。並べ替えの鍵が店舗詳細と違うので、\n"
        "  フィードが «店舗詳細では見えない行» を拾いうる上限 = usable が 2 件以上ある店 = %s 店。\n"
        "  つまり到達可能行の上限は %s 行（可視 %s + %s）。",
        f"{rest_multi:,}", f"{visible + rest_multi:,}", f"{visible:,}", f"{rest_multi:,}",
    )

    # ---------------------------------------------------------------- §2
    section("2. 見えない行は KPI（セルに異なり店 5 店）に効くか")
    cur.execute("SELECT count(DISTINCT (restaurant_id, category_id)), count(DISTINCT restaurant_id) FROM usable_rows")
    u_pairs, u_rests = cur.fetchone()
    cur.execute("SELECT count(DISTINCT (restaurant_id, category_id)), count(DISTINCT restaurant_id) FROM visible_rows")
    v_pairs, v_rests = cur.fetchone()
    logger.info("(店, カテゴリ) の異なり数 : usable %s / 可視 %s  差 %s",
                f"{u_pairs:,}", f"{v_pairs:,}", f"{u_pairs - v_pairs:,}")
    logger.info("店の異なり数              : usable %s / 可視 %s  差 %s",
                f"{u_rests:,}", f"{v_rests:,}", f"{u_rests - v_rests:,}")
    logger.info(
        "→ KPI は (area, カテゴリ) ごとの **異なり店** を数える"
        "（dish_media_coverage_sql.py `_stage5_matched_sql` の count(DISTINCT restaurant_id)）。\n"
        "  差が 0 なら «見えない行» は KPI に 1 セルも効いていない。"
    )

    # ---------------------------------------------------------------- §3
    section("3. 真っ黒（絵が 1 枚も出ない）行の分類")
    for label, table in (("usable 全体", "usable_rows"), ("可視（実際に人が見る）", "visible_rows")):
        cur.execute(
            f"""
            SELECT count(*),
                   count(*) FILTER (WHERE has_stored_thumbnail),
                   count(*) FILTER (WHERE NOT has_stored_thumbnail AND has_provider_thumbnail),
                   count(*) FILTER (WHERE NOT has_stored_thumbnail AND NOT has_provider_thumbnail
                                      AND has_embed_row AND has_category_image),
                   count(*) FILTER (WHERE {BLACK_EXPR}),
                   count(*) FILTER (WHERE NOT has_stored_thumbnail AND NOT has_provider_thumbnail
                                      AND NOT has_embed_row)
            FROM {table}
            """
        )
        tot, s1, s2, s3, black, no_embed = cur.fetchone()
        logger.info("\n[%s] %s 行", label, f"{tot:,}")
        logger.info("  1段目 自ストレージのサムネイル  : %s (%s)", f"{s1:,}", pct(s1, tot))
        logger.info("  2段目 provider のサムネイル URL : %s (%s)", f"{s2:,}", pct(s2, tot))
        logger.info("  3段目 料理カテゴリの絵          : %s (%s)", f"{s3:,}", pct(s3, tot))
        logger.info("  ❌ 真っ黒（3 段とも空）         : %s (%s)", f"{black:,}", pct(black, tot))
        logger.info("  （参考）絵も埋め込みも無い行    : %s (%s)", f"{no_embed:,}", pct(no_embed, tot))

    cur.execute(
        f"""
        SELECT category_id, count(*) AS n
        FROM usable_rows WHERE {BLACK_EXPR}
        GROUP BY category_id ORDER BY n DESC LIMIT 15
        """
    )
    logger.info("\n真っ黒を生んでいる料理カテゴリ 上位 15（= dish_categories.image_url が空のカテゴリ）")
    for cat, n in cur.fetchall():
        logger.info("  %-12s %s 行", cat, f"{n:,}")

    cur.execute(
        f"""
        SELECT count(DISTINCT category_id) FROM usable_rows WHERE {BLACK_EXPR}
        """
    )
    (black_cats,) = cur.fetchone()
    cur.execute(
        f"""
        WITH jp AS ({coverage_sql.jp_gate_category_select_sql()})
        SELECT count(DISTINCT u.category_id),
               count(*) FILTER (WHERE 1=1)
        FROM usable_rows u JOIN jp ON jp.category_id = u.category_id
        WHERE {BLACK_EXPR}
        """
    )
    jp_black_cats, jp_black_rows = cur.fetchone()
    logger.info("\n真っ黒のカテゴリ数: %s（うち JP gate 通過 %s カテゴリ / %s 行）",
                f"{black_cats:,}", f"{jp_black_cats:,}", f"{jp_black_rows:,}")

    # ---------------------------------------------------------------- §4
    section("4. 真っ黒を配信段階で «出さない» と、KPI をいくつ失うか")
    cur.execute(
        f"""
        SELECT count(*) FROM (
          SELECT restaurant_id, category_id
          FROM usable_rows
          GROUP BY restaurant_id, category_id
          HAVING bool_and({BLACK_EXPR})
        ) t
        """
    )
    (pairs_all_black,) = cur.fetchone()
    logger.info(
        "«その (店, カテゴリ) の usable が全部 真っ黒» な組: %s / %s 組（%s）",
        f"{pairs_all_black:,}", f"{u_pairs:,}", pct(pairs_all_black, u_pairs),
    )
    logger.info("  → 真っ黒を落とすと、この組ぶんだけ KPI の分子（異なり店）から消える。")
    cur.execute(
        f"""
        WITH jp AS ({coverage_sql.jp_gate_category_select_sql()})
        SELECT count(*) FROM (
          SELECT u.restaurant_id, u.category_id
          FROM usable_rows u JOIN jp ON jp.category_id = u.category_id
          GROUP BY u.restaurant_id, u.category_id
          HAVING bool_and({BLACK_EXPR})
        ) t
        """
    )
    (jp_pairs_all_black,) = cur.fetchone()
    logger.info("  うち JP gate カテゴリ（KPI が数える 134 カテゴリ）: %s 組", f"{jp_pairs_all_black:,}")

    # ---------------------------------------------------------------- §5
    section("5. 水平展開の候補（«作ったのに消費側で出ない» が他にもあるか）")
    cur.execute(
        """
        SELECT embed_status, count(*) FROM usable_rows
        WHERE has_embed_row GROUP BY embed_status ORDER BY 2 DESC
        """
    )
    logger.info("[a] embed_status 別の usable 行数（usable フィルタは playback_status しか見ていない）")
    for status, n in cur.fetchall():
        logger.info("    %-14s %s 行", status, f"{n:,}")

    cur.execute(
        """
        SELECT count(*) FROM dish_media dm
        WHERE dm.render_type = 'external_embed'
          AND NOT EXISTS (SELECT 1 FROM dish_media_external_embeddings e WHERE e.dish_media_id = dm.id)
        """
    )
    (orphan,) = cur.fetchone()
    logger.info("\n[b] render_type='external_embed' なのに埋め込み行が無い dish_media: %s 行", f"{orphan:,}")
    logger.info("    （assembler は externalEmbed が null だとカテゴリの絵にも落ちない = 必ず真っ黒）")

    cur.execute(
        """
        SELECT count(*) FROM restaurants r
        WHERE EXISTS (
          SELECT 1 FROM dishes d JOIN dish_media m ON m.dish_id = d.id
          WHERE d.restaurant_id = r.id AND m.deleted_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM dishes d JOIN dish_media m ON m.dish_id = d.id
          WHERE d.restaurant_id = r.id AND m.deleted_at IS NULL
            AND m.thumbnail_path <> ''
        )
        """
    )
    (no_face,) = cur.fetchone()
    logger.info(
        "\n[c] dish_media を持つのに «店の顔» が空になる店: %s 店\n"
        "    findFallbackThumbnailsByRestaurantIds が thumbnail_path <> '' を要求するため、\n"
        "    external_embed しか持たない店は店詳細・店名検索・地図ピンで絵が出ない。",
        f"{no_face:,}",
    )

    cur.execute(
        """
        SELECT count(*) FROM dish_media dm
        WHERE dm.render_type = 'external_embed' AND dm.media_processing_status <> 'completed'
          AND dm.deleted_at IS NULL
        """
    )
    (not_completed,) = cur.fetchone()
    logger.info("\n[d] external_embed で media_processing_status が completed でない行: %s 行", f"{not_completed:,}")

    logger.info("\n✅ 読み取りのみ完了（永続テーブルへの DDL / DML は 1 つも実行していない）")


def main() -> int:
    parser = argparse.ArgumentParser(description="配信したのに見えない行を数える（読み取り専用）")
    parser.add_argument("--schema", choices=["dev", "public"], default="dev")
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    with psycopg2.connect(database_url) as conn:
        # 一時テーブルの DDL があるので readonly=True は付けられない（PostgreSQL の
        # read-only トランザクションは一時テーブルの DDL も禁じる。measure_dish_media_coverage.py
        # の同じ判断を参照）。作り終えた直後に default_transaction_read_only へ切り替える。
        conn.set_session(autocommit=True)
        with conn.cursor() as cur:
            run(cur, args.schema)
    return 0


if __name__ == "__main__":
    sys.exit(main())
