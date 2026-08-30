#!/usr/bin/env python3
"""PostgreSQLへ同期する前に、restaurant/dish_media catalogの不変条件を検証する。

BigQueryのPRIMARY KEYは強制制約ではないため、この品質ゲートを通さず9_*を実行しては
ならない。構造破壊はERRORで同期を停止し、充足率は投入初期でも観測を続けられるよう
WARNINGとして記録する。
"""

from __future__ import annotations

import argparse
import json
import logging
import uuid
from pathlib import Path
from typing import Any

from google.cloud import bigquery

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now

LOGGER = logging.getLogger(__name__)
REPO_ROOT = Path(__file__).resolve().parents[2]

# dish_media 経路（4_1/4_2）を流していない run では意味を成さない検査。
# 空の catalog に対して «S2セル×134カテゴリの全直積が未充足» と出るだけで、
# restaurants 側の健全性とは無関係である。
DISH_MEDIA_CHECKS = frozenset({
    "dish_media_id_unique",
    "dish_media_publish_rules",
    "dish_media_references_exist",
    "coverage_cross_product_complete",
    "coverage_pair_unique",
    "all_area_category_pairs_filled",
})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="BQ publish catalogsの品質ゲートを実行します"
    )
    parser.add_argument("--run-id")
    parser.add_argument("--expected-category-count", type=int, default=134)
    parser.add_argument(
        "--skip-dish-media-checks",
        action="store_true",
        help="dish_media 経路（4_1/4_2）を実行していない run で、media/coverage の"
        "チェックを外す。restaurants だけを先に公開する納品では 4_2 を流さないため、"
        "coverage_cross_product_complete が «S2セル×134カテゴリの全直積が未充足» と"
        "して必ず ERROR になる。restaurant 側の検査だけで 9_1 の可否を判断したいときに使う",
    )
    parser.add_argument(
        "--fail-on-warning",
        action="store_true",
        help="coverage不足のWARNINGでも終了codeを非0にする場合だけ指定",
    )
    return parser.parse_args()


def validation_sql(pipeline: BigQueryPipeline) -> str:
    dataset = pipeline.dataset_ref
    dish_dataset = pipeline.config.dish_dataset_ref
    # 全checkを1 Query Jobへまとめ、各checkごとに巨大catalogを何度も読み直さない。
    return f"""
      WITH
      source_stats AS (
        SELECT
          COUNT(*) AS row_count,
          COUNT(DISTINCT CONCAT(source, ':', source_record_id)) AS distinct_count
        FROM `{dataset}.restaurant_source_records`
        WHERE run_id = @run_id
      ),
      seed_stats AS (
        SELECT
          COUNT(*) AS row_count,
          COUNT(DISTINCT seed_id) AS distinct_count,
          COUNTIF(existing_google_place_id IS NOT NULL) AS existing_count
        FROM `{dataset}.restaurant_seed_catalog`
        WHERE run_id = @run_id
      ),
      link_stats AS (
        SELECT
          COUNT(*) AS row_count,
          COUNT(DISTINCT CONCAT(source, ':', source_record_id)) AS distinct_count
        FROM `{dataset}.restaurant_seed_source_links`
        WHERE run_id = @run_id
      ),
      match_stats AS (
        SELECT
          COUNT(*) AS row_count,
          COUNT(DISTINCT seed_id) AS distinct_seed_count,
          COUNTIF(
            google_place_id IS NOT NULL
            AND match_status IN ('existing_pg_matched', 'box_unique_strict', 'manual_matched')
          ) AS accepted_count
        FROM `{dataset}.restaurant_google_place_match_catalog`
        WHERE run_id = @run_id
      ),
      accepted_place_duplicates AS (
        SELECT COUNT(*) AS duplicate_count
        FROM (
          SELECT google_place_id
          FROM `{dataset}.restaurant_google_place_match_catalog`
          WHERE run_id = @run_id
            AND google_place_id IS NOT NULL
            AND match_status IN ('existing_pg_matched', 'box_unique_strict', 'manual_matched')
          GROUP BY google_place_id
          HAVING COUNT(*) > 1
        )
      ),
      restaurant_stats AS (
        SELECT
          COUNT(*) AS row_count,
          COUNT(DISTINCT google_place_id) AS distinct_place_count,
          -- #843 座標の «成立» と «日本かどうか» を分ける。
          --
          -- 2_1 は既存 PG の海外店（実測 338 行）を require_japan=False で通す。
          -- ここで日本の矩形を必須にしていると、**その 338 行が catalog に載った
          -- 瞬間にこの ERROR check が落ち、9_1 が二度と流れなくなる**。
          -- 矩形の検査は下の restaurant_overseas_only_from_existing_pg が持つ。
          COUNTIF(
            google_place_id = '' OR name = '' OR image_url IS NULL
            OR SAFE.PARSE_JSON(address_components_json) IS NULL
            OR latitude NOT BETWEEN -90.0 AND 90.0
            OR longitude NOT BETWEEN -180.0 AND 180.0
          ) AS invalid_count
        FROM `{dataset}.restaurant_catalog`
        WHERE run_id = @run_id
      ),
      -- #843 «日本の外に居てよいのは、既に PG に在った店だけ» を守る。
      --
      -- オープンデータは日本の矩形で絞って取り込んでいるので、open data 由来の
      -- 行が矩形の外に出ることは無い。出たなら座標か取り込み範囲が壊れている。
      -- 一方、既存 PG 由来（seed に existing_restaurant_id がある）の海外店は
      -- 正当なので通す。矩形を «全行必須» にせず、この形で残す。
      overseas_not_existing AS (
        SELECT COUNT(*) AS invalid_count
        FROM `{dataset}.restaurant_catalog` c
        JOIN `{dataset}.restaurant_seed_catalog` s
          ON s.run_id = @run_id AND s.seed_id = c.seed_id
        WHERE c.run_id = @run_id
          AND s.existing_restaurant_id IS NULL
          AND (c.latitude NOT BETWEEN 20.0 AND 46.5
               OR c.longitude NOT BETWEEN 122.0 AND 154.0)
      ),
      -- #843 «合併したら元より減った» を捕まえる。
      --
      -- 3_4 は同じ place_id へ当たった負けた seed の連絡先を合併する。この合併で
      -- **自分の値まで消える**事故が実際に起きた（BigQuery の ARRAY_CONCAT は
      -- 引数に NULL が 1 つでもあると NULL を返すので、LEFT JOIN が外れた行で
      -- 配列が空になった。social 492,247 → 19,306 / source_names 621,616 → 50,513）。
      --
      -- 件数だけを見るゲートでは 621,616 行のまま通ってしまい、素通りした。
      -- **自分の seed が持っていた値を、catalog が持っていないこと**を直接数える。
      restaurant_merge_loss AS (
        SELECT
          COUNTIF(ARRAY_LENGTH(c.source_names) = 0) AS lost_name_rows,
          COUNTIF(
            (SELECT COUNT(1) FROM UNNEST(s.social_urls) u WHERE u IS NOT NULL AND u != '') > 0
            AND ARRAY_LENGTH(c.social_urls) = 0
          ) AS lost_social_rows,
          COUNTIF(NULLIF(s.phone, '') IS NOT NULL AND c.phone IS NULL) AS lost_phone_rows,
          COUNTIF(NULLIF(s.website, '') IS NOT NULL AND c.website IS NULL) AS lost_website_rows
        FROM `{dataset}.restaurant_catalog` c
        JOIN `{dataset}.restaurant_seed_catalog` s
          ON s.run_id = @run_id AND s.seed_id = c.seed_id
        WHERE c.run_id = @run_id
      ),
      existing_missing AS (
        SELECT COUNT(*) AS missing_count
        FROM `{dataset}.restaurant_seed_catalog` seed
        LEFT JOIN `{dataset}.restaurant_catalog` catalog
          ON catalog.run_id = @run_id
         AND catalog.seed_id = seed.seed_id
        WHERE seed.run_id = @run_id
          AND seed.existing_restaurant_id IS NOT NULL
          AND catalog.seed_id IS NULL
      ),
      existing_value_mismatches AS (
        SELECT COUNT(*) AS mismatch_count
        FROM `{dataset}.restaurant_seed_catalog` seed
        INNER JOIN `{dataset}.restaurant_source_records` existing
          ON existing.run_id = @run_id
         AND existing.source = 'existing_pg'
         AND existing.source_record_id = seed.existing_restaurant_id
        INNER JOIN `{dataset}.restaurant_catalog` catalog
          ON catalog.run_id = @run_id
         AND catalog.seed_id = seed.seed_id
        WHERE seed.run_id = @run_id
          AND (
            catalog.name IS DISTINCT FROM existing.name
            OR catalog.name_language_code
              IS DISTINCT FROM COALESCE(NULLIF(existing.name_language_code, ''), 'ja')
            OR catalog.latitude IS DISTINCT FROM existing.latitude
            OR catalog.longitude IS DISTINCT FROM existing.longitude
            OR catalog.image_url IS DISTINCT FROM existing.image_url
            OR catalog.image_path IS DISTINCT FROM existing.image_path
            OR catalog.address_components_json
              IS DISTINCT FROM existing.address_components_json
            OR catalog.plus_code_json IS DISTINCT FROM existing.plus_code_json
          )
      ),
      target_categories AS (
        SELECT DISTINCT item_qid
        FROM `{dish_dataset}.dish_category_features_catalog`
        WHERE feature_type = 'gate'
          AND feature_key = 'region:country:JP'
          AND score > 0
      ),
      category_stats AS (
        SELECT COUNT(*) AS row_count FROM target_categories
      ),
      media_stats AS (
        SELECT
          COUNT(*) AS row_count,
          COUNT(DISTINCT dish_media_id) AS distinct_media_count,
          COUNTIF(
            availability_status != 'available'
            OR NULLIF(embed_html, '') IS NULL
            OR rights_basis NOT IN (
              'official_api', 'official_oembed', 'partner_license', 'first_party_permission'
            )
            OR restaurant_match_confidence < 0.95
            OR category_confidence < 0.80
          ) AS invalid_count
        FROM `{dataset}.dish_media_catalog`
        WHERE run_id = @run_id
      ),
      media_orphans AS (
        SELECT COUNT(*) AS orphan_count
        FROM `{dataset}.dish_media_catalog` media
        LEFT JOIN `{dataset}.restaurant_catalog` restaurant
          ON restaurant.run_id = @run_id
         AND restaurant.google_place_id = media.google_place_id
        LEFT JOIN target_categories category
          ON category.item_qid = media.category_id
        WHERE media.run_id = @run_id
          AND (restaurant.google_place_id IS NULL OR category.item_qid IS NULL)
      ),
      coverage_stats AS (
        SELECT
          COUNT(*) AS row_count,
          COUNT(DISTINCT CONCAT(CAST(service_cell_id AS STRING), ':', category_id))
            AS distinct_pair_count,
          COUNTIF(shortage_count > 0) AS shortage_rows
        FROM `{dataset}.dish_media_coverage_catalog`
        WHERE run_id = @run_id
      ),
      expected_coverage AS (
        SELECT
          (SELECT COUNT(*) FROM `{dataset}.restaurant_service_cell_catalog` WHERE run_id = @run_id)
          * (SELECT row_count FROM category_stats) AS row_count
      ),
      checks AS (
        SELECT 'source_record_key_unique' check_name, 'ERROR' severity,
          CAST(row_count - distinct_count AS FLOAT64) observed_value, 0.0 threshold_value,
          row_count = distinct_count passed FROM source_stats
        UNION ALL SELECT 'seed_non_empty', 'ERROR', CAST(row_count AS FLOAT64), 1.0,
          row_count >= 1 FROM seed_stats
        UNION ALL SELECT 'seed_id_unique', 'ERROR', CAST(row_count - distinct_count AS FLOAT64), 0.0,
          row_count = distinct_count FROM seed_stats
        UNION ALL SELECT 'one_source_record_one_link', 'ERROR',
          CAST(
            ABS((SELECT row_count FROM source_stats) - row_count)
            + (row_count - distinct_count)
            AS FLOAT64
          ), 0.0,
          (SELECT row_count FROM source_stats) = row_count
            AND row_count = distinct_count FROM link_stats
        UNION ALL SELECT 'one_match_row_per_seed', 'ERROR',
          CAST(ABS((SELECT row_count FROM seed_stats) - row_count) AS FLOAT64), 0.0,
          (SELECT row_count FROM seed_stats) = row_count AND row_count = distinct_seed_count
          FROM match_stats
        UNION ALL SELECT 'accepted_google_place_id_unique', 'ERROR',
          CAST(duplicate_count AS FLOAT64), 0.0, duplicate_count = 0
          FROM accepted_place_duplicates
        UNION ALL SELECT 'restaurant_catalog_non_empty', 'ERROR', CAST(row_count AS FLOAT64), 1.0,
          row_count >= 1 FROM restaurant_stats
        UNION ALL SELECT 'restaurant_google_place_id_unique', 'ERROR',
          CAST(row_count - distinct_place_count AS FLOAT64), 0.0,
          row_count = distinct_place_count FROM restaurant_stats
        UNION ALL SELECT 'restaurant_required_fields_valid', 'ERROR',
          CAST(invalid_count AS FLOAT64), 0.0, invalid_count = 0 FROM restaurant_stats
        UNION ALL SELECT 'restaurant_overseas_only_from_existing_pg', 'ERROR',
          CAST(invalid_count AS FLOAT64), 0.0, invalid_count = 0
          FROM overseas_not_existing
        UNION ALL SELECT 'restaurant_merge_no_data_loss', 'ERROR',
          CAST(lost_name_rows + lost_social_rows + lost_phone_rows + lost_website_rows AS FLOAT64),
          0.0,
          lost_name_rows + lost_social_rows + lost_phone_rows + lost_website_rows = 0
          FROM restaurant_merge_loss
        UNION ALL SELECT 'existing_pg_restaurants_preserved', 'ERROR',
          CAST(missing_count AS FLOAT64), 0.0, missing_count = 0 FROM existing_missing
        UNION ALL SELECT 'existing_pg_serving_values_preserved', 'ERROR',
          CAST(mismatch_count AS FLOAT64), 0.0, mismatch_count = 0
          FROM existing_value_mismatches
        UNION ALL SELECT 'jp_gate_category_count', 'ERROR', CAST(row_count AS FLOAT64),
          CAST(@expected_category_count AS FLOAT64), row_count = @expected_category_count
          FROM category_stats
        UNION ALL SELECT 'dish_media_id_unique', 'ERROR',
          CAST(row_count - distinct_media_count AS FLOAT64), 0.0,
          row_count = distinct_media_count FROM media_stats
        UNION ALL SELECT 'dish_media_publish_rules', 'ERROR', CAST(invalid_count AS FLOAT64), 0.0,
          invalid_count = 0 FROM media_stats
        UNION ALL SELECT 'dish_media_references_exist', 'ERROR', CAST(orphan_count AS FLOAT64), 0.0,
          orphan_count = 0 FROM media_orphans
        UNION ALL SELECT 'coverage_cross_product_complete', 'ERROR',
          CAST(ABS(row_count - (SELECT row_count FROM expected_coverage)) AS FLOAT64), 0.0,
          row_count = (SELECT row_count FROM expected_coverage) FROM coverage_stats
        UNION ALL SELECT 'coverage_pair_unique', 'ERROR',
          CAST(row_count - distinct_pair_count AS FLOAT64), 0.0,
          row_count = distinct_pair_count FROM coverage_stats
        UNION ALL SELECT 'all_area_category_pairs_filled', 'WARNING',
          SAFE_DIVIDE(CAST(shortage_rows AS FLOAT64), NULLIF(row_count, 0)), 0.0,
          shortage_rows = 0 FROM coverage_stats
      )
      SELECT * FROM checks ORDER BY severity, check_name
    """


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()
    parameters = [
        bigquery.ScalarQueryParameter("run_id", "STRING", run_id),
        bigquery.ScalarQueryParameter(
            "expected_category_count", "INT64", args.expected_category_count
        ),
    ]
    checked_at = utc_now()
    # 1回の検証結果をvalidation_idで束ねる。9_* はこの単位で全ERRORを評価し、
    # 部分的なstreaming insertや古い検証結果の混在を許さない。
    validation_id = str(uuid.uuid4())
    with pipeline.step(
        run_id,
        "8_1_validate_catalogs",
        parameters={
            "expected_category_count": args.expected_category_count,
            "fail_on_warning": args.fail_on_warning,
        },
        repo_root=REPO_ROOT,
    ) as step:
        results = list(pipeline.execute(validation_sql(pipeline), parameters))
        if args.skip_dish_media_checks:
            skipped = [r.check_name for r in results if r.check_name in DISH_MEDIA_CHECKS]
            results = [r for r in results if r.check_name not in DISH_MEDIA_CHECKS]
            step["skipped_dish_media_checks"] = skipped
            LOGGER.warning(
                "dish_media 経路の検査を外した: %s。restaurants だけを公開する納品でのみ使うこと",
                ", ".join(skipped),
            )
        rows: list[dict[str, Any]] = []
        for result in results:
            passed = bool(result.passed)
            LOGGER.info(
                "%s %-42s observed=%s threshold=%s",
                "PASS" if passed else "FAIL",
                result.check_name,
                result.observed_value,
                result.threshold_value,
            )
            rows.append(
                {
                    "validation_id": validation_id,
                    "run_id": run_id,
                    "check_name": result.check_name,
                    "severity": result.severity,
                    "passed": passed,
                    "observed_value": result.observed_value,
                    "threshold_value": result.threshold_value,
                    "details_json": json.dumps(
                        {"validator": "8_1_validate_catalogs.py"}, ensure_ascii=False
                    ),
                    "checked_at": checked_at.isoformat(),
                }
            )
        errors = pipeline.client.insert_rows_json(
            pipeline.table("restaurant_quality_results"), rows
        )
        if errors:
            raise RuntimeError(f"quality resultsの保存に失敗しました: {errors}")
        step["row_count"] = len(results)

        failed = [
            row
            for row in rows
            if not row["passed"]
            and (row["severity"] == "ERROR" or args.fail_on_warning)
        ]
        if failed:
            names = ", ".join(row["check_name"] for row in failed)
            raise RuntimeError(f"品質ゲートに失敗しました: {names}")


if __name__ == "__main__":
    main()
