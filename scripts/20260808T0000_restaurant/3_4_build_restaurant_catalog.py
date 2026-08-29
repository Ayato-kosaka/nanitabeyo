#!/usr/bin/env python3
"""Google Place IDが安全に確定したseedだけをPostgreSQL公開形へ変換する。"""

from __future__ import annotations

import argparse
from pathlib import Path

from google.cloud import bigquery

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id

REPO_ROOT = Path(__file__).resolve().parents[2]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="restaurant publish catalogを生成します"
    )
    parser.add_argument("--run-id")
    parser.add_argument(
        "--service-cell-level",
        type=int,
        default=14,
        help="coverage集計のS2 level。初期値14は全国規模と近傍性の折衷",
    )
    parser.add_argument(
        "--allow-osm-only-publish",
        action="store_true",
        help="ODbL上のderived/collective database公開方針を承認済みの場合だけ指定",
    )
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    if not 0 <= args.service_cell_level <= 30:
        raise ValueError("--service-cell-level は0〜30です")
    pipeline = BigQueryPipeline()

    # 新規seedの address_components をGoogle由来に見せかけて合成しない。
    # 既存PG値はそのまま維持し、未取得は空配列とする。将来 Place Details を
    # 正式に取得する場合は、別raw/detail stepからこのcatalogへ昇格させる。
    catalog_sql = f"""
      CREATE OR REPLACE TABLE `{pipeline.dataset_ref}.restaurant_catalog`
      CLUSTER BY google_place_id, seed_id
      OPTIONS (description = 'PostgreSQL restaurants へ同期してよい Google Place ID 確定行のみ。')
      AS
      WITH publish_values AS (
        SELECT
          s.seed_id,
          s.existing_restaurant_id,
          m.google_place_id,
          COALESCE(existing.name, s.canonical_name) AS name,
          COALESCE(NULLIF(existing.name_language_code, ''), 'ja') AS name_language_code,
          COALESCE(existing.latitude, s.latitude) AS latitude,
          COALESCE(existing.longitude, s.longitude) AS longitude,
          COALESCE(existing.image_url, s.image_url, '') AS image_url,
          COALESCE(existing.image_path, s.image_path) AS image_path,
          COALESCE(
            NULLIF(existing.address_components_json, ''),
            NULLIF(s.address_components_json, ''),
            '[]'
          ) AS address_components_json,
          COALESCE(existing.plus_code_json, s.plus_code_json) AS plus_code_json,
          -- #1681 表示用の1行住所。**オープンデータ由来だけを使う。**
          -- existing（＝PG に入っている Google 由来の住所）は carry-forward しない。
          -- Google の住所は ToS 3.2.3 で保持できないので、そちらへ寄せてはいけない。
          NULLIF(s.canonical_address, '') AS address,
          -- #1681 ISO-3166-1 alpha-2。
          -- open data は日本の矩形で絞って取り込んでいるので、矩形内なら JP と断言できる
          -- （実測: パイプライン製 569,661 行のうち矩形外は 0 行）。
          -- 矩形外は既存PG由来の海外店（2_1 の require_japan=False で通した分）で、
          -- 国を断定する材料がここには無いので NULL にする。PG 側で別途埋める。
          CASE
            WHEN s.latitude BETWEEN 20.0 AND 46.5
             AND s.longitude BETWEEN 122.0 AND 154.0
            THEN 'JP'
          END AS country_code,
          s.phone,
          s.website,
          s.social_urls,
          s.source_names,
          m.match_method
        FROM `{pipeline.dataset_ref}.restaurant_seed_catalog` s
        INNER JOIN `{pipeline.dataset_ref}.restaurant_google_place_match_catalog` m
          USING (seed_id)
        LEFT JOIN `{pipeline.dataset_ref}.restaurant_source_records` existing
          ON existing.run_id = @run_id
         AND existing.source = 'existing_pg'
         AND existing.source_record_id = s.existing_restaurant_id
        WHERE s.run_id = @run_id
          AND m.run_id = @run_id
          AND m.google_place_id IS NOT NULL
          AND m.match_status IN ('existing_pg_matched', 'box_unique_strict', 'manual_matched')
          AND (@allow_osm_only_publish OR s.seed_origin != 'osm_only')
      )
      -- #843 `existing_restaurant_id` は catalog へ出さない。
      -- あれは «1_2 がどのスキーマを読んだか» に依存する PostgreSQL の UUID で、
      -- catalog に載せると «dev で作った catalog を public へ流す» が成立してしまう
      -- （9_1 が dev の UUID を public の主キーとして INSERT できた）。
      -- catalog はスキーマに依存しない成果物にする。PG 側の同定は
      -- google_place_id と seed_id で足りる（どちらもスキーマに依らない）。
      SELECT
        @run_id AS run_id,
        seed_id,
        google_place_id,
        name,
        name_language_code,
        latitude,
        longitude,
        ST_GEOGPOINT(longitude, latitude) AS location,
        image_url,
        image_path,
        address_components_json,
        plus_code_json,
        address,
        country_code,
        phone,
        website,
        social_urls,
        source_names,
        match_method,
        -- #1681 address / country_code / 連絡先も含める。含めないと、これらだけが
        -- 変わったときに row_hash が動かず、9_1 の更新条件をすり抜けて反映されない。
        TO_HEX(SHA256(CONCAT(
          google_place_id, '|', name, '|', CAST(latitude AS STRING), '|',
          CAST(longitude AS STRING), '|', image_url, '|',
          address_components_json, '|', COALESCE(plus_code_json, ''), '|',
          COALESCE(address, ''), '|', COALESCE(country_code, ''), '|',
          COALESCE(phone, ''), '|', COALESCE(website, ''), '|',
          ARRAY_TO_STRING(social_urls, ',')
        ))) AS row_hash,
        CURRENT_TIMESTAMP() AS built_at
      FROM publish_values
    """
    service_cell_sql = f"""
      CREATE OR REPLACE TABLE `{pipeline.dataset_ref}.restaurant_service_cell_catalog`
      CLUSTER BY service_cell_id
      OPTIONS (description = 'coverage分母となる、公開可能restaurantが1件以上あるS2セル。')
      AS
      SELECT
        @run_id AS run_id,
        S2_CELLIDFROMPOINT(location, @s2_level) AS service_cell_id,
        @s2_level AS s2_level,
        ST_CENTROID_AGG(location) AS center,
        COUNT(*) AS restaurant_count,
        CURRENT_TIMESTAMP() AS built_at
      FROM `{pipeline.dataset_ref}.restaurant_catalog`
      WHERE run_id = @run_id
      GROUP BY service_cell_id
    """
    parameters = [
        bigquery.ScalarQueryParameter("run_id", "STRING", run_id),
        bigquery.ScalarQueryParameter("s2_level", "INT64", args.service_cell_level),
        bigquery.ScalarQueryParameter(
            "allow_osm_only_publish", "BOOL", args.allow_osm_only_publish
        ),
    ]
    with pipeline.step(
        run_id,
        "3_4_build_restaurant_catalog",
        parameters={
            "service_cell_level": args.service_cell_level,
            "allow_osm_only_publish": args.allow_osm_only_publish,
        },
        repo_root=REPO_ROOT,
    ) as step:
        pipeline.execute(catalog_sql, parameters)
        pipeline.execute(service_cell_sql, parameters)
        step["row_count"] = next(
            iter(
                pipeline.execute(
                    f"SELECT COUNT(*) AS c FROM `{pipeline.dataset_ref}.restaurant_catalog`"
                )
            )
        ).c


if __name__ == "__main__":
    main()
