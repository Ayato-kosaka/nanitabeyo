#!/usr/bin/env python3
"""#1273 フェーズB: 店が判明している ready 部分集合を sns_dish_media_catalog に組む（BQ→BQ）。

sns_post_resolved と sns_post_raw(canonical_url) を突き合わせ、
pg へ配信できる «確定行» を row_hash 付きで作る。pg には触れない（9_2 が触る）。

#1846: **出力は 1 投稿 1 行**（店もカテゴリも 1 つに確定したものだけ）。
店を 1 つに絞れなかった投稿は配信しない。判定は `common_sns.post_store_cte_sql`。

#1815: **日本以外の店は配信しない。** 判定は `common_sns.foreign_restaurant_sql`
（写経しないこと）。ここは配信経路の入口なので、ここで落とせば 9_2 まで届かない。
"""

from __future__ import annotations

import argparse
import logging

from pipeline_common import (
    BigQueryPipeline, configure_logging, require_run_id, utc_now, stable_record_hash,
)
from common_sns import (
    PROVIDER_INSTAGRAM, TABLE_POST_RAW, TABLE_POST_RESOLVED, TABLE_DISH_MEDIA_CATALOG,
    LATEST_RESOLVED_QUALIFY, TABLE_RESTAURANT_CATALOG, foreign_store_sql,
    post_store_cte_sql,
)

LOGGER = logging.getLogger(__name__)

# #1815 «日本以外の店» の判定は common_sns が唯一の正。ここへ写経しない。
FOREIGN_STORE_SQL = foreign_store_sql("rc")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="matched の ready 行を sns_dish_media_catalog に組む")
    p.add_argument("--run-id", default=None)
    p.add_argument("--resolved-run-id", default=None, help="読む resolved/raw の run_id（省略時 --run-id）")
    # #1273 収集は run_id ごとに分かれており、配信は «全 run の union» で組む（7_1 と同じ形）。
    p.add_argument("--resolved-run-ids", default=None,
                   help="union する run_id をカンマ区切りで（--resolved-run-id より優先）")
    # #1815 店の国は sns_post_resolved も sns_post_raw も持っていない。9_1_sync_restaurants が
    # PG へ配る `restaurant_catalog` だけが持っているので、その run_id を要求する。
    p.add_argument("--restaurant-catalog-run-id", required=True,
                   help="日本以外の店を落とすために突き合わせる restaurant_catalog の run_id"
                        "（例: restaurant-2026-08-23）。SNS の run_id とは別なので必須にしている")
    return p.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    src_run_ids = ([x.strip() for x in args.resolved_run_ids.split(",") if x.strip()]
                   if args.resolved_run_ids else [args.resolved_run_id or run_id])
    pipeline = BigQueryPipeline()
    now_iso = utc_now().isoformat()

    from google.cloud import bigquery
    # ⚠️ raw の結合に run_id 条件を付けない。raw と resolved が別の run に分かれている投稿を
    #    落としてしまう（7_1 は union で引くので、付けると 7_1 と数が合わなくなる）。
    # ⚠️ 店は `post_store`（common_sns.post_store_cte_sql）が唯一の正。ここで
    #    `COALESCE(seed, resolve)` を書き直すと «1 投稿が 2 店に紐づく» が戻る（#1846）。
    sql = f"""
      WITH v AS (
        SELECT * FROM `{pipeline.table(TABLE_POST_RESOLVED)}`
        WHERE run_id IN UNNEST(@srcs)
        {LATEST_RESOLVED_QUALIFY}
      ),
      {post_store_cte_sql(pipeline.table(TABLE_POST_RAW), latest_cte="v", runs_param="srcs")}
      SELECT v.post_id, ps.google_place_id, v.dish_category_id,
             ANY_VALUE(r.canonical_url) AS canonical_url
      FROM v
      JOIN post_store ps ON ps.post_id = v.post_id
      JOIN `{pipeline.table(TABLE_POST_RAW)}` r
        ON r.run_id IN UNNEST(@srcs) AND r.provider = v.provider AND r.post_id = v.post_id
      -- #1815 店の国はここでしか分からない。LEFT JOIN なのは «catalog に居ない店» を
      -- ここで落とさないため（落とす／落とさないは 9_2 が PG の実在で決めており、
      -- ここで先に落とすと «PG に居ない店» の件数が二重に減って追えなくなる）。
      LEFT JOIN `{pipeline.table(TABLE_RESTAURANT_CATALOG)}` rc
        ON rc.run_id = @rc_run AND rc.google_place_id = ps.google_place_id
      WHERE v.dish_category_id IS NOT NULL
        AND NOT IFNULL({FOREIGN_STORE_SQL}, FALSE)
      GROUP BY v.post_id, google_place_id, v.dish_category_id
    """
    # 落とした投稿は «黙って消える» のが一番まずい（次に誰かが «なぜ減った» を調べ直す）。
    # 店を 1 つに絞れずに配信しなかった投稿を、理由ごとに数えて run のログへ残す。
    dropped_sql = f"""
      WITH v AS (
        SELECT * FROM `{pipeline.table(TABLE_POST_RESOLVED)}`
        WHERE run_id IN UNNEST(@srcs)
        {LATEST_RESOLVED_QUALIFY}
      ),
      {post_store_cte_sql(pipeline.table(TABLE_POST_RAW), latest_cte="v", runs_param="srcs")},
      -- カテゴリが付いていない投稿はそもそも配信対象外なので、数えるのは «カテゴリはあるのに
      -- 店が決まらなかったせいで落ちた» ぶんだけにする（そうしないと «落とした数» が水増しになる）
      with_category AS (SELECT post_id FROM v WHERE dish_category_id IS NOT NULL),
      cand_posts AS (
        SELECT DISTINCT post_id FROM store_candidate
        WHERE post_id IN (SELECT post_id FROM with_category)
      ),
      store_country AS (
        SELECT ps.post_id
        FROM v
        JOIN post_store ps ON ps.post_id = v.post_id
        JOIN `{pipeline.table(TABLE_RESTAURANT_CATALOG)}` rc
          ON rc.run_id = @rc_run AND rc.google_place_id = ps.google_place_id
        WHERE v.dish_category_id IS NOT NULL
          AND {FOREIGN_STORE_SQL}
      ),
      seeded AS (
        SELECT DISTINCT r.post_id FROM `{pipeline.table(TABLE_POST_RAW)}` r
        WHERE r.provider = '{PROVIDER_INSTAGRAM}' AND r.run_id IN UNNEST(@srcs)
          AND r.discovery_seed_place_id IS NOT NULL AND r.discovery_seed_place_id != ''
          AND r.post_id IN (SELECT post_id FROM with_category)
      )
      SELECT
        (SELECT COUNT(*) FROM cand_posts c
          WHERE c.post_id NOT IN (SELECT post_id FROM post_store)) AS ambiguous_posts,
        (SELECT COUNT(*) FROM seeded s
          WHERE s.post_id NOT IN (SELECT post_id FROM cand_posts)) AS shared_identity_only_posts,
        (SELECT COUNT(DISTINCT post_id) FROM store_country) AS foreign_store_posts
    """

    params = [
        bigquery.ArrayQueryParameter("srcs", "STRING", src_run_ids),
        bigquery.ScalarQueryParameter("rc_run", "STRING", args.restaurant_catalog_run_id),
    ]

    # `pipeline.step` は parameters を **ブロックの終わりに** JSON 化するので、
    # 中で足した値もそのまま run ログ（parameters_json）へ残る。落とした数はここに置く。
    step_params: dict[str, object] = {
        "resolved_run_ids": ",".join(src_run_ids),
        "restaurant_catalog_run_id": args.restaurant_catalog_run_id,
    }

    with pipeline.step(run_id, "9_1_build_sns_dish_media_catalog",
                       parameters=step_params, repo_root=None) as result:
        rows = []
        for r in pipeline.execute(sql, params):
            payload = {
                "provider": PROVIDER_INSTAGRAM,
                "external_content_id": r["post_id"],
                "google_place_id": r["google_place_id"],
                "dish_category_id": r["dish_category_id"],
            }
            rows.append({
                **payload,
                "canonical_url": r["canonical_url"],
                "thumbnail_url": None,  # IG はサムネイル複製不可。dmee は参照 URL を持つが取込時に解決
                "row_hash": stable_record_hash(payload),
                "built_at": now_iso, "run_id": run_id,
            })
        pipeline.delete_run_rows(TABLE_DISH_MEDIA_CATALOG, run_id)
        count = pipeline.load_json_rows(TABLE_DISH_MEDIA_CATALOG, rows) if rows else 0
        result["row_count"] = count
        drop = next(iter(pipeline.execute(dropped_sql, params)), None)
        if drop is not None:
            step_params["dropped_ambiguous_posts"] = int(drop["ambiguous_posts"] or 0)
            step_params["dropped_shared_identity_posts"] = int(drop["shared_identity_only_posts"] or 0)
            step_params["dropped_foreign_store_posts"] = int(drop["foreign_store_posts"] or 0)
            LOGGER.info("配信しなかった投稿: 店を絞れず %d / 看板が複数店を指すのみ %d "
                        "/ 日本以外の店 %d",
                        step_params["dropped_ambiguous_posts"],
                        step_params["dropped_shared_identity_posts"],
                        step_params["dropped_foreign_store_posts"])
        LOGGER.info("sns_dish_media_catalog に %d 件（配信可 ready・1 投稿 1 行）を組みました", count)


if __name__ == "__main__":
    main()
