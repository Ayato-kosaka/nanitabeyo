#!/usr/bin/env python3
"""#1846 «1 つの投稿が 2 店以上に紐づく» を原因別に数え、人が見られるサンプルを書き出す。

配信カタログ `sns_dish_media_catalog` は «1 投稿 1 行» のはずだが、店を
`COALESCE(discovery_seed_place_id, resolve の店)` で raw 行ごとに決めていたため、
1 つの投稿が複数の店に紐づいていた（実測 sns-catalog-2026-09-05: 1,388 投稿 / 2,008 行）。
どちらが出るかは 9_2 の `google_place_id ASC` ＝ place_id の辞書順で決まっていた。

このスクリプトは «直したかどうか» ではなく «何が起きているか» を測る。
9_1 / 7_1 の店の決め方そのものは `common_sns.post_store_cte_sql` が正本で、ここには写経しない。

## 使い方（db-script-run.yml）
  script_path: scripts/20260808T0000_restaurant/9_9_audit_multi_place_posts.py
  args: --catalog-run-id sns-catalog-2026-09-05 --sample-out 1273_instagram_seed_poc/out/multi_place_post_sample.tsv
"""

from __future__ import annotations

import argparse
import csv
import logging
from pathlib import Path

from pipeline_common import BigQueryPipeline, configure_logging
from common_sns import (PROVIDER_INSTAGRAM, TABLE_POST_RAW, TABLE_DISH_MEDIA_CATALOG)

LOGGER = logging.getLogger(__name__)

# --- 原因の分類（この 1 箇所だけに置く）------------------------------------------
#
# 【設計】#1846: 収集経路が示すのは «どの店の看板の下で見つけたか» であって
# «どの店の投稿か» ではない。看板が複数店を指しているとき、その 2 つがずれる。
# 分類は «どの看板が何店を指していたか» で決まるので、判定はその 1 本だけにする。
CAUSE_CASE_SQL = """
    CASE
      WHEN n_seed_embed > 1 AND n_seed_acct > 1 THEN 'C0_埋め込みとアカウントの両方で衝突'
      WHEN n_seed_embed > 1 AND n_dom_embed = 1 THEN 'C1_ブランドサイト共有'
      WHEN n_seed_embed > 1                     THEN 'C2_複数ドメインに埋め込み'
      WHEN n_seed_acct  > 1 AND n_acct = 1      THEN 'C3_ブランドアカウント共有'
      WHEN n_seed_acct  > 1                     THEN 'C3b_複数アカウント'
      WHEN n_seed       > 1                     THEN 'C5_アカウントとサイトで食い違い'
      ELSE 'C4_seedとresolveの食い違い'
    END
"""

# www の有無でドメインが割れる（実測: `hachibei.com` と `www.hachibei.com` が別々に入っていた）
_DOM_SQL = r"REGEXP_REPLACE(LOWER(IFNULL(r.discovery_query, '')), r'^www\.', '')"


def _base_cte(pipeline: BigQueryPipeline) -> str:
    """曖昧な投稿と、その原因を判定する CTE 群。末尾の CTE 名は ``post_cause``。"""
    return f"""
      ambiguous AS (
        SELECT external_content_id AS post_id
        FROM `{pipeline.table(TABLE_DISH_MEDIA_CATALOG)}`
        WHERE run_id = @crid
        GROUP BY post_id
        HAVING COUNT(DISTINCT google_place_id) > 1
      ),
      rr AS (
        SELECT r.post_id, r.discovery_route AS route, r.account_id, r.caption,
               IFNULL(r.discovery_seed_place_id, '') AS seed, {_DOM_SQL} AS dom
        FROM `{pipeline.table(TABLE_POST_RAW)}` r
        JOIN ambiguous a USING (post_id)
        WHERE r.provider = '{PROVIDER_INSTAGRAM}'
      ),
      shape AS (
        SELECT post_id,
          COUNT(DISTINCT IF(seed != '', seed, NULL)) AS n_seed,
          COUNT(DISTINCT IF(route = 'store_site_embed' AND seed != '', seed, NULL)) AS n_seed_embed,
          COUNT(DISTINCT IF(route = 'store_site_embed' AND seed != '', dom, NULL)) AS n_dom_embed,
          COUNT(DISTINCT IF(route = 'store_account' AND seed != '', seed, NULL)) AS n_seed_acct,
          COUNT(DISTINCT IF(route = 'store_account', account_id, NULL)) AS n_acct,
          STRING_AGG(DISTINCT IF(route = 'store_site_embed' AND seed != '', dom, NULL), ',') AS doms,
          STRING_AGG(DISTINCT IF(route = 'store_account' AND seed != '', account_id, NULL), ',') AS accts,
          SUBSTR(REGEXP_REPLACE(ANY_VALUE(caption), r'\\s+', ' '), 1, 110) AS caption
        FROM rr GROUP BY post_id
      ),
      post_cause AS (
        -- ⚠️ CTE 名を列名と同じ `cause` にしない。BigQuery は `GROUP BY cause` を
        --    «テーブル別名（STRUCT 全体）» と解釈し、行ごとに 1 グループになる。
        SELECT post_id, doms, accts, caption, {CAUSE_CASE_SQL} AS cause FROM shape
      )"""


def breakdown_sql(pipeline: BigQueryPipeline) -> str:
    """原因ごとの投稿数。"""
    return f"""
      WITH {_base_cte(pipeline)}
      SELECT cause, COUNT(*) AS posts FROM post_cause GROUP BY cause ORDER BY posts DESC
    """


def sample_sql(pipeline: BigQueryPipeline) -> str:
    """原因ごとに層化した «人が見て正解を決められるか» のサンプル。

    ``★`` が付いているのが **現行の配信で勝っていた店**（9_2 の place_id 辞書順）。
    ``km`` は候補どうしの最大距離で、これが大きいほど «別の市の店に付けた» ことになる。
    """
    return f"""
      WITH {_base_cte(pipeline)},
      amb_rows AS (
        SELECT external_content_id AS post_id, google_place_id AS pid, canonical_url
        FROM `{pipeline.table(TABLE_DISH_MEDIA_CATALOG)}`
        WHERE run_id = @crid AND external_content_id IN (SELECT post_id FROM ambiguous)
      ),
      cat AS (
        SELECT google_place_id, ANY_VALUE(name) AS name, ANY_VALUE(address) AS address,
               ANY_VALUE(latitude) AS lat, ANY_VALUE(longitude) AS lng
        FROM `{pipeline.table('restaurant_catalog')}`
        WHERE run_id = @catalog_rid GROUP BY google_place_id
      ),
      win AS (
        -- 9_2 は built_at 同着なら google_place_id の昇順で勝者を決める（＝ MIN）
        SELECT post_id, MIN(pid) AS cur_pid, ANY_VALUE(canonical_url) AS url
        FROM amb_rows GROUP BY post_id
      ),
      j AS (
        SELECT a.post_id, a.pid, w.cur_pid, c.name, c.address, c.lat, c.lng
        FROM amb_rows a JOIN win w USING (post_id)
        LEFT JOIN cat c ON c.google_place_id = a.pid
      ),
      win_xy AS (
        SELECT post_id, ANY_VALUE(lat) AS wlat, ANY_VALUE(lng) AS wlng
        FROM j WHERE pid = cur_pid GROUP BY post_id
      ),
      agg AS (
        SELECT j.post_id,
          STRING_AGG(CONCAT(IF(j.pid = j.cur_pid, '★', ''), IFNULL(j.name, '?'),
                            '（', IFNULL(j.address, '?'), '）'), ' / ' ORDER BY j.pid) AS candidates,
          ROUND(MAX(ST_DISTANCE(ST_GEOGPOINT(j.lng, j.lat),
                                ST_GEOGPOINT(w.wlng, w.wlat))) / 1000, 1) AS km
        FROM j LEFT JOIN win_xy w USING (post_id) GROUP BY j.post_id
      )
      SELECT c.cause, w.url, a.km, IFNULL(c.doms, IFNULL(c.accts, '')) AS source_key,
             a.candidates, c.caption,
             ROW_NUMBER() OVER (PARTITION BY c.cause ORDER BY FARM_FINGERPRINT(a.post_id)) AS rn
      FROM agg a JOIN post_cause c USING (post_id) JOIN win w USING (post_id)
      QUALIFY rn <= @per_cause
      ORDER BY c.cause, rn
    """


SAMPLE_HEADER = ["cause", "post_url", "km", "source_key", "candidates(★=現行の勝者)", "caption"]


def _params(catalog_run_id: str, restaurant_run_id: str, per_cause: int):
    from google.cloud import bigquery
    return [
        bigquery.ScalarQueryParameter("crid", "STRING", catalog_run_id),
        bigquery.ScalarQueryParameter("catalog_rid", "STRING", restaurant_run_id),
        bigquery.ScalarQueryParameter("per_cause", "INT64", per_cause),
    ]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="1 投稿が複数店に紐づく原因を数える")
    p.add_argument("--catalog-run-id", required=True, help="見る sns_dish_media_catalog の run_id")
    p.add_argument("--restaurant-run-id", default="restaurant-2026-08-23",
                   help="店名・住所を引く restaurant_catalog の run_id")
    p.add_argument("--sample-out", default=None, help="サンプルを書き出す TSV のパス")
    p.add_argument("--per-cause", type=int, default=25, help="原因ごとのサンプル件数")
    return p.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    pipeline = BigQueryPipeline()
    params = _params(args.catalog_run_id, args.restaurant_run_id, args.per_cause)

    total = 0
    for row in pipeline.execute(breakdown_sql(pipeline), params):
        LOGGER.info("%-40s %6d", row["cause"], row["posts"])
        total += int(row["posts"])
    LOGGER.info("%-40s %6d", "合計（2 店以上に紐づいた投稿）", total)

    if args.sample_out:
        path = Path(args.sample_out)
        if not path.is_absolute():
            path = Path(__file__).resolve().parent / path
        path.parent.mkdir(parents=True, exist_ok=True)
        n = 0
        with path.open("w", encoding="utf-8", newline="") as f:
            w = csv.writer(f, delimiter="\t", quoting=csv.QUOTE_MINIMAL)
            w.writerow(SAMPLE_HEADER)
            for r in pipeline.execute(sample_sql(pipeline), params):
                w.writerow([r["cause"], r["url"], r["km"], r["source_key"],
                            r["candidates"], (r["caption"] or "").replace("\t", " ")])
                n += 1
        LOGGER.info("サンプルを %d 件書き出しました: %s", n, path)


if __name__ == "__main__":
    main()
