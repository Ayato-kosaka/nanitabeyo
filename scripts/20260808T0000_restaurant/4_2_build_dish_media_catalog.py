#!/usr/bin/env python3
"""SNS rawから料理・dish_media・全国area×134カテゴリcoverageをpublishする。"""

from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path

from google.cloud import bigquery

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id

REPO_ROOT = Path(__file__).resolve().parents[2]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="dish media publish catalogを生成します"
    )
    parser.add_argument("--run-id")
    parser.add_argument("--observed-from", type=date.fromisoformat, required=True)
    parser.add_argument("--observed-to", type=date.fromisoformat, required=True)
    parser.add_argument("--restaurant-confidence", type=float, default=0.95)
    parser.add_argument("--category-confidence", type=float, default=0.80)
    parser.add_argument("--target-per-cell-category", type=int, default=1)
    parser.add_argument("--expected-category-count", type=int, default=134)
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    if args.observed_from > args.observed_to:
        raise ValueError("--observed-from は --observed-to 以前にしてください")
    if (
        not 0 <= args.restaurant_confidence <= 1
        or not 0 <= args.category_confidence <= 1
    ):
        raise ValueError("confidence thresholdは0〜1です")
    if args.target_per_cell_category <= 0 or args.expected_category_count <= 0:
        raise ValueError("target/category countは1以上です")
    pipeline = BigQueryPipeline()
    dish_ref = pipeline.config.dish_dataset_ref

    parameters = [
        bigquery.ScalarQueryParameter("run_id", "STRING", run_id),
        bigquery.ScalarQueryParameter("observed_from", "DATE", args.observed_from),
        bigquery.ScalarQueryParameter("observed_to", "DATE", args.observed_to),
        bigquery.ScalarQueryParameter(
            "restaurant_confidence", "FLOAT64", args.restaurant_confidence
        ),
        bigquery.ScalarQueryParameter(
            "category_confidence", "FLOAT64", args.category_confidence
        ),
        bigquery.ScalarQueryParameter(
            "target_per_cell_category", "INT64", args.target_per_cell_category
        ),
        bigquery.ScalarQueryParameter(
            "expected_category_count", "INT64", args.expected_category_count
        ),
    ]

    # JP gateの134件を「料理カテゴリの分母」として固定する。catalog全件（約1万件）を
    # cross joinすると目標定義そのものが変わるため、feature gateを必ず通す。
    target_categories = f"""
      SELECT
        c.item_qid AS category_id,
        COALESCE(NULLIF(c.label_ja, ''), NULLIF(c.label_en, ''), c.item_qid) AS name
      FROM `{dish_ref}.dish_category_catalog` c
      INNER JOIN (
        SELECT DISTINCT item_qid
        FROM `{dish_ref}.dish_category_features_catalog`
        WHERE feature_type = 'gate'
          AND feature_key = 'region:country:JP'
          AND score > 0
      ) g USING (item_qid)
    """
    media_sql = f"""
      ASSERT (
        SELECT COUNT(*) = @expected_category_count FROM ({target_categories})
      ) AS 'JP gate category countが期待値と異なります。料理提案側の採用版を確認してください。';

      CREATE OR REPLACE TABLE `{pipeline.dataset_ref}.dish_media_catalog`
      CLUSTER BY category_id, google_place_id, provider
      OPTIONS (description = 'PostgreSQL dish_media と外部埋め込みテーブルへの同期元。')
      AS
      WITH observations AS (
        SELECT *
        FROM `{pipeline.dataset_ref}.dish_media_social_raw`
        WHERE observed_date BETWEEN @observed_from AND @observed_to
      ),
      latest_observation_time AS (
        SELECT provider, external_content_id, MAX(observed_at) AS observed_at
        FROM observations
        GROUP BY provider, external_content_id
      ),
      latest_observation AS (
        SELECT raw.*
        FROM observations raw
        INNER JOIN latest_observation_time latest
          USING (provider, external_content_id, observed_at)
      ),
      eligible AS (
        SELECT
          raw.*,
          ROW_NUMBER() OVER (
            PARTITION BY provider, external_content_id
            ORDER BY category_confidence DESC, category_id
          ) AS category_rank
        FROM latest_observation raw
        INNER JOIN `{pipeline.dataset_ref}.restaurant_catalog` restaurant
          ON restaurant.run_id = @run_id
         AND restaurant.google_place_id = raw.google_place_id
        INNER JOIN ({target_categories}) category
          ON category.category_id = raw.category_id
        INNER JOIN `{pipeline.dataset_ref}.dish_media_external_state_catalog` state
          ON state.run_id = @run_id
         AND state.provider = raw.provider
         AND state.external_content_id = raw.external_content_id
        WHERE raw.availability_status = 'available'
          -- 同一観測時刻に矛盾行があれば、state側が非公開を優先する。
          AND state.availability_status = 'available'
          AND raw.rights_basis IN (
            'official_api', 'official_oembed', 'partner_license', 'first_party_permission'
          )
          AND NULLIF(raw.embed_html, '') IS NOT NULL
          AND raw.restaurant_match_confidence >= @restaurant_confidence
          AND raw.category_confidence >= @category_confidence
      )
      SELECT
        @run_id AS run_id,
        dish_media_id,
        google_place_id,
        category_id,
        provider,
        external_content_id,
        canonical_url,
        embed_html,
        thumbnail_url,
        media_type,
        published_at,
        availability_status,
        restaurant_match_confidence,
        category_confidence,
        rights_basis,
        terms_version,
        observed_at AS last_verified_at,
        TO_HEX(SHA256(CONCAT(
          provider, '|', external_content_id, '|', google_place_id, '|', category_id, '|',
          canonical_url, '|', COALESCE(embed_html, ''), '|', COALESCE(thumbnail_url, ''), '|',
          media_type, '|', COALESCE(CAST(published_at AS STRING), ''), '|',
          availability_status, '|', CAST(restaurant_match_confidence AS STRING), '|',
          CAST(category_confidence AS STRING), '|', rights_basis, '|',
          COALESCE(terms_version, ''), '|', CAST(observed_at AS STRING)
        ))) AS row_hash,
        CURRENT_TIMESTAMP() AS built_at
      FROM eligible
      WHERE category_rank = 1
    """
    state_sql = f"""
      CREATE OR REPLACE TABLE `{pipeline.dataset_ref}.dish_media_external_state_catalog`
      CLUSTER BY availability_status, provider, dish_media_id
      OPTIONS (description = '最新観測の公開可否。unavailable/deleted/privateをPGへ伝えるtombstone catalog。')
      AS
      WITH observations AS (
        SELECT *
        FROM `{pipeline.dataset_ref}.dish_media_social_raw`
        WHERE observed_date BETWEEN @observed_from AND @observed_to
      ),
      latest_time AS (
        SELECT provider, external_content_id, MAX(observed_at) AS observed_at
        FROM observations
        GROUP BY provider, external_content_id
      )
      SELECT
        @run_id AS run_id,
        ANY_VALUE(raw.dish_media_id) AS dish_media_id,
        raw.provider,
        raw.external_content_id,
        -- category候補行どうしで状態が矛盾した場合、公開側へ倒さない。
        CASE
          WHEN COUNTIF(raw.availability_status = 'deleted') > 0 THEN 'deleted'
          WHEN COUNTIF(raw.availability_status = 'private') > 0 THEN 'private'
          WHEN COUNTIF(raw.availability_status = 'unavailable') > 0 THEN 'unavailable'
          ELSE 'available'
        END AS availability_status,
        MAX(raw.observed_at) AS last_verified_at,
        CURRENT_TIMESTAMP() AS built_at
      FROM observations raw
      INNER JOIN latest_time latest
        USING (provider, external_content_id, observed_at)
      GROUP BY raw.provider, raw.external_content_id
    """
    dish_sql = f"""
      CREATE OR REPLACE TABLE `{pipeline.dataset_ref}.dish_catalog`
      CLUSTER BY category_id, google_place_id
      OPTIONS (description = 'PostgreSQL dishes への同期元。媒体が採用された店舗×料理だけを持つ。')
      AS
      SELECT
        @run_id AS run_id,
        media.google_place_id,
        media.category_id,
        ANY_VALUE(category.name) AS name,
        CURRENT_TIMESTAMP() AS built_at
      FROM `{pipeline.dataset_ref}.dish_media_catalog` media
      INNER JOIN ({target_categories}) category USING (category_id)
      WHERE media.run_id = @run_id
      GROUP BY media.google_place_id, media.category_id
    """
    coverage_sql = f"""
      CREATE OR REPLACE TABLE `{pipeline.dataset_ref}.dish_media_coverage_catalog`
      CLUSTER BY category_id, service_cell_id
      OPTIONS (description = '対象エリア×134カテゴリの投入充足を観測する。クライアント挙動は変更しない。')
      AS
      WITH media_by_cell AS (
        SELECT
          S2_CELLIDFROMPOINT(r.location, cell.s2_level) AS service_cell_id,
          media.category_id,
          COUNT(DISTINCT media.google_place_id) AS restaurant_count,
          COUNT(DISTINCT media.dish_media_id) AS media_count
        FROM `{pipeline.dataset_ref}.dish_media_catalog` media
        INNER JOIN `{pipeline.dataset_ref}.restaurant_catalog` r
          ON r.run_id = @run_id
         AND r.google_place_id = media.google_place_id
        CROSS JOIN (
          SELECT ANY_VALUE(s2_level) AS s2_level
          FROM `{pipeline.dataset_ref}.restaurant_service_cell_catalog`
          WHERE run_id = @run_id
        ) cell
        WHERE media.run_id = @run_id
        GROUP BY service_cell_id, media.category_id
      )
      SELECT
        @run_id AS run_id,
        cell.service_cell_id,
        category.category_id,
        COALESCE(media.restaurant_count, 0) AS available_restaurant_count,
        COALESCE(media.media_count, 0) AS available_media_count,
        @target_per_cell_category AS target_restaurant_count,
        GREATEST(
          @target_per_cell_category - COALESCE(media.restaurant_count, 0), 0
        ) AS shortage_count,
        CASE
          WHEN COALESCE(media.restaurant_count, 0) = 0 THEN 'no_media'
          WHEN media.restaurant_count < @target_per_cell_category THEN 'below_target'
          ELSE NULL
        END AS shortage_reason,
        CURRENT_TIMESTAMP() AS calculated_at
      FROM `{pipeline.dataset_ref}.restaurant_service_cell_catalog` cell
      CROSS JOIN ({target_categories}) category
      LEFT JOIN media_by_cell media
        ON media.service_cell_id = cell.service_cell_id
       AND media.category_id = category.category_id
      WHERE cell.run_id = @run_id
    """
    step_parameters = {
        "observed_from": args.observed_from,
        "observed_to": args.observed_to,
        "restaurant_confidence": args.restaurant_confidence,
        "category_confidence": args.category_confidence,
        "target_per_cell_category": args.target_per_cell_category,
        "expected_category_count": args.expected_category_count,
    }
    with pipeline.step(
        run_id,
        "4_2_build_dish_media_catalog",
        parameters=step_parameters,
        repo_root=REPO_ROOT,
    ) as step:
        pipeline.execute(state_sql, parameters)
        pipeline.execute(media_sql, parameters)
        pipeline.execute(dish_sql, parameters)
        pipeline.execute(coverage_sql, parameters)
        step["row_count"] = next(
            iter(
                pipeline.execute(
                    f"SELECT COUNT(*) AS c FROM `{pipeline.dataset_ref}.dish_media_catalog`"
                )
            )
        ).c


if __name__ == "__main__":
    main()
