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

# #1273 SNS 経路（4_* → 5_1 → 9_1_build_sns_dish_media_catalog → 9_2_sync_sns_dish_media）の
# 配信直前ゲート。旧 dish_media_catalog 向けの検査（DISH_MEDIA_CHECKS）は
# sns_dish_media_catalog を 1 行も見ないので、SNS の中身は誰も検査していなかった。
#
# jp_gate_category_count をこの集合へ入れているのは、SNS だけを検証する
# （--sns-only）ときにも «134 カテゴリの一覧そのものが壊れていないか» が要るからである。
# sns_media_jp_gate_category_rate はその一覧を分母に使うので、一覧が壊れていれば率も嘘になる。
SNS_MEDIA_CHECKS = frozenset({
    "jp_gate_category_count",
    "sns_dish_media_catalog_non_empty",
    "sns_media_pg_unique_key_unique",
    "sns_media_required_fields_valid",
    "sns_media_duplicate_post_rate",
    "sns_media_store_inside_japan",
    "sns_media_store_known_rate",
    "sns_media_jp_gate_category_rate",
})

# SNS の集合に入っているが restaurant 側の check でもあるもの。SNS を流していない run
# でも残す（134 カテゴリの一覧そのものの検査であって、SNS 固有の検査ではない）。
SHARED_WITH_RESTAURANT_CHECKS = frozenset({"jp_gate_category_count"})

# --- SNS 経路の閾値 -----------------------------------------------------------
#
# すべて 2026-09-05 の実測（run_id=sns-catalog-2026-09-05 / 142,489 行 / 19,605 店 /
# 140,481 投稿）を基準に置いている。「なんとなく」で置いた数字はここに 1 つも無い。

# «同じ投稿が複数行に出ている» 行の割合。ERROR。
#
# dish_media の ID は build_dish_media_id(provider, 投稿ID) で決まる（料理カテゴリを
# 含めない）ので、**1 投稿は 1 dish_media にしかならない**。9_2 は catalog を
# ROW_NUMBER() で 1 投稿 1 行へ畳んで読むため、余った行は PG を壊さずに捨てられる。
# つまりこれは «壊れる» 検査ではなく «店の当て方が壊れ始めていないか» の検査である。
#
# 閾値 3% の根拠:
#   - 今日の実測 1.409%（2,008 行 / 142,489 行。1,388 投稿）。中身は全件が
#     «同じ投稿に別の店»（別カテゴリは 0 件）で、同じ投稿が複数の店アカウントから
#     採れたときに起きる。柱1（店アカウント収集）が伸びるほど自然に増える量なので、
#     今日の倍までは «増えた» と呼ばない
#   - 一方、9_1 が resolve の最新行へ絞れていなかったときの実測は **18.5%** だった
#     （common_sns.LATEST_RESOLVED_QUALIFY のコメント）。同じ壊れ方が再発したら
#     3% は必ず超える
SNS_DUPLICATE_POST_RATE_MAX = 0.03

# restaurant_catalog に居ない店を指している行の割合。WARNING。
#
# 9_2 はこの行を落として続行する（止めると 1 件の取りこぼしで全件が届かなくなる）ので、
# 止める理由が無い。見たいのは «増えていないか» だけである。
#
# 閾値 1% の根拠:
#   - 今日の実測 0.349%（497 行 / 84 店）
#   - restaurant_catalog は run_id=restaurant-2026-08-23 の snapshot なので、resolve が
#     後から見つけた place_id は構造的にここへ落ちる。ゆっくり増えるのが正常
#   - 3 倍（1%）を超えたら «ゆっくり» ではない。restaurant 側の再同期が要るか、
#     resolve が catalog に無い place_id を作り始めたかのどちらかを疑う
SNS_UNKNOWN_STORE_RATE_MAX = 0.01

# アプリの 134 カテゴリ（JP ゲート）の外を指している行の割合。WARNING。
#
# 捨てない。dish_categories には 134 の外も居るので PG へは入る。ただし JP の検索には
# 出ないので、割合が跳ねたら «resolve がアプリの語彙の外へ流れ始めた» という意味になる。
#
# 閾値 30% の根拠:
#   - 今日の実測 18.702%（26,648 行 / 1,401 カテゴリ）
#   - 7_2 のファネルで観測されている帯は 19.9〜21.2%。18.7〜21.2% が «いつもの範囲»
#   - その上限（21.2%）に対して約 1.4 倍。帯の中で揺れる限りは鳴らず、帯を明らかに
#     外れたときだけ鳴る位置
SNS_OUTSIDE_JP_GATE_CATEGORY_RATE_MAX = 0.30

# dish_media_external_embeddings.provider の CHECK（dmee_provider_check）と同じ値域。
# infra/supabase/migrations/20260824T0200_create_dish_media_external_embeddings.sql
# ここを狭めると «PG が受け取れる行を手前で ERROR にする» ことになるので、DB に合わせる。
# 9_2_sync_sns_dish_media.ALLOWED_PROVIDERS と一致していることは
# test_8_1_sns_quality_gate.py が ast で読んで固定する（写経のずれを検知する）。
DMEE_ALLOWED_PROVIDERS = ("instagram", "tiktok", "youtube", "x")

# 日本の矩形。restaurant_overseas_only_from_existing_pg と同じ値を使う。
JAPAN_BBOX = (20.0, 46.5, 122.0, 154.0)  # lat_min, lat_max, lng_min, lng_max


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
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
        "--sns-run-id",
        default=None,
        help="#1273 SNS 経路の検査を実行する。読む sns_dish_media_catalog の run_id。"
        "渡さないと SNS check は結果から外れる（SNS を流していない run で "
        "sns_dish_media_catalog_non_empty が必ず ERROR になるのを避けるため）",
    )
    parser.add_argument(
        "--restaurant-catalog-run-id",
        default=None,
        help="#1273 SNS 経路の «店が実在するか / 国内か» を照らし合わせる restaurant_catalog "
        "の run_id。省略時は --run-id。SNS の run_id と restaurant の run_id は別なので、"
        "SNS 経路のゲートでは基本的に明示する",
    )
    parser.add_argument(
        "--sns-only",
        action="store_true",
        help="#1273 SNS 経路の check «だけ» を残す。restaurant / dish_media 側の check は"
        "結果から外す。SNS の run_id には restaurant_source_records が 1 行も無く、"
        "restaurant 側の check が全て ERROR になるため、SNS の run_id でゲートを"
        "回すときに使う（9_2 はこの run_id で検証結果を探す）",
    )
    parser.add_argument(
        "--fail-on-warning",
        action="store_true",
        help="coverage不足のWARNINGでも終了codeを非0にする場合だけ指定",
    )
    return parser.parse_args(argv)


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
      -- #1273 ここから SNS 経路（sns_dish_media_catalog）の検査。
      --
      -- 旧 dish_media_catalog（media_stats / media_orphans）はこの表を 1 行も見ない。
      -- 9_2 が PG(dev) へ書くのはこの表なので、ここを検査しないと «中身を誰も見ずに
      -- dev へ入る» ことになる。
      sns_media_stats AS (
        SELECT
          COUNT(*) AS row_count,
          -- 1 投稿 1 dish_media（build_dish_media_id は料理カテゴリを含めない）
          COUNT(DISTINCT CONCAT(provider, ':', external_content_id)) AS distinct_post_count,
          -- PG 側の UNIQUE (provider, external_content_id, dish_id) と同じ粒度。
          -- dish_id は (店, 料理カテゴリ) なので、ここでは (店, カテゴリ) で代用する。
          -- ここが重複していると 9_2 の ON CONFLICT DO NOTHING が黙って飲み込む。
          COUNT(DISTINCT CONCAT(
            provider, ':', external_content_id, ':', google_place_id, ':', dish_category_id
          )) AS distinct_pg_key_count,
          -- dmee の NOT NULL / CHECK に当たるものを手前で数える。
          --   canonical_url … dmee.canonical_url は NOT NULL。空文字も入れない
          --   provider      … dmee_provider_check の値域
          --   dish_category_id … PG の dish_categories.id は Wikidata QID
          COUNTIF(
            NULLIF(canonical_url, '') IS NULL
            OR NOT STARTS_WITH(canonical_url, 'https://')
            OR provider NOT IN UNNEST(@sns_allowed_providers)
            OR NULLIF(google_place_id, '') IS NULL
            OR NOT REGEXP_CONTAINS(dish_category_id, r'^Q[0-9]+$')
            OR NULLIF(row_hash, '') IS NULL
          ) AS invalid_count
        FROM `{dataset}.sns_dish_media_catalog`
        WHERE run_id = @sns_run_id
      ),
      -- «その店は PG に居るか / 日本の店か»。
      --
      -- 8_1 は PostgreSQL に触らない。PG の restaurants を作っているのは 9_1 が配信する
      -- restaurant_catalog なので、そちらを «PG に居る店» の代理として照らし合わせる。
      -- 座標もこの表しか持っていない（sns_post_resolved は国・座標を持たない）ので、
      -- 国外混入の判定もここで行う。
      sns_media_store_state AS (
        SELECT
          COUNT(*) AS row_count,
          COUNTIF(rc.google_place_id IS NULL) AS unknown_store_rows,
          COUNTIF(
            rc.google_place_id IS NOT NULL
            AND (rc.latitude NOT BETWEEN @jp_lat_min AND @jp_lat_max
                 OR rc.longitude NOT BETWEEN @jp_lng_min AND @jp_lng_max)
          ) AS overseas_rows
        FROM `{dataset}.sns_dish_media_catalog` m
        LEFT JOIN `{dataset}.restaurant_catalog` rc
          ON rc.run_id = @restaurant_catalog_run_id
         AND rc.google_place_id = m.google_place_id
        WHERE m.run_id = @sns_run_id
      ),
      sns_media_category_state AS (
        SELECT
          COUNT(*) AS row_count,
          COUNTIF(t.item_qid IS NULL) AS outside_gate_rows
        FROM `{dataset}.sns_dish_media_catalog` m
        LEFT JOIN target_categories t ON t.item_qid = m.dish_category_id
        WHERE m.run_id = @sns_run_id
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
        -- #1273 SNS 経路（9_2 が PG(dev) へ書く行）の検査。
        UNION ALL SELECT 'sns_dish_media_catalog_non_empty', 'ERROR',
          CAST(row_count AS FLOAT64), 1.0, row_count >= 1 FROM sns_media_stats
        UNION ALL SELECT 'sns_media_pg_unique_key_unique', 'ERROR',
          CAST(row_count - distinct_pg_key_count AS FLOAT64), 0.0,
          row_count = distinct_pg_key_count FROM sns_media_stats
        UNION ALL SELECT 'sns_media_required_fields_valid', 'ERROR',
          CAST(invalid_count AS FLOAT64), 0.0, invalid_count = 0 FROM sns_media_stats
        UNION ALL SELECT 'sns_media_duplicate_post_rate', 'ERROR',
          COALESCE(SAFE_DIVIDE(
            CAST(row_count - distinct_post_count AS FLOAT64), NULLIF(row_count, 0)
          ), 0.0),
          @sns_duplicate_post_rate_max,
          COALESCE(SAFE_DIVIDE(
            CAST(row_count - distinct_post_count AS FLOAT64), NULLIF(row_count, 0)
          ), 0.0) <= @sns_duplicate_post_rate_max
          FROM sns_media_stats
        UNION ALL SELECT 'sns_media_store_inside_japan', 'ERROR',
          CAST(overseas_rows AS FLOAT64), 0.0, overseas_rows = 0
          FROM sns_media_store_state
        UNION ALL SELECT 'sns_media_store_known_rate', 'WARNING',
          COALESCE(SAFE_DIVIDE(
            CAST(unknown_store_rows AS FLOAT64), NULLIF(row_count, 0)
          ), 0.0),
          @sns_unknown_store_rate_max,
          COALESCE(SAFE_DIVIDE(
            CAST(unknown_store_rows AS FLOAT64), NULLIF(row_count, 0)
          ), 0.0) <= @sns_unknown_store_rate_max
          FROM sns_media_store_state
        UNION ALL SELECT 'sns_media_jp_gate_category_rate', 'WARNING',
          COALESCE(SAFE_DIVIDE(
            CAST(outside_gate_rows AS FLOAT64), NULLIF(row_count, 0)
          ), 0.0),
          @sns_outside_jp_gate_category_rate_max,
          COALESCE(SAFE_DIVIDE(
            CAST(outside_gate_rows AS FLOAT64), NULLIF(row_count, 0)
          ), 0.0) <= @sns_outside_jp_gate_category_rate_max
          FROM sns_media_category_state
      )
      SELECT * FROM checks ORDER BY severity, check_name
    """


def query_parameters(args: argparse.Namespace, run_id: str) -> list[Any]:
    """validation_sql が参照する named parameter を全て組む。

    SNS の check を実行しない run でも SQL は同じ 1 本なので、@sns_run_id 等は必ず渡す。
    渡さない run では sns_dish_media_catalog に 1 行も当たらず、結果は下の
    select_checks が結果集合から外す。
    """

    lat_min, lat_max, lng_min, lng_max = JAPAN_BBOX
    return [
        bigquery.ScalarQueryParameter("run_id", "STRING", run_id),
        bigquery.ScalarQueryParameter(
            "expected_category_count", "INT64", args.expected_category_count
        ),
        bigquery.ScalarQueryParameter("sns_run_id", "STRING", args.sns_run_id or run_id),
        bigquery.ScalarQueryParameter(
            "restaurant_catalog_run_id",
            "STRING",
            args.restaurant_catalog_run_id or run_id,
        ),
        bigquery.ArrayQueryParameter(
            "sns_allowed_providers", "STRING", list(DMEE_ALLOWED_PROVIDERS)
        ),
        bigquery.ScalarQueryParameter(
            "sns_duplicate_post_rate_max", "FLOAT64", SNS_DUPLICATE_POST_RATE_MAX
        ),
        bigquery.ScalarQueryParameter(
            "sns_unknown_store_rate_max", "FLOAT64", SNS_UNKNOWN_STORE_RATE_MAX
        ),
        bigquery.ScalarQueryParameter(
            "sns_outside_jp_gate_category_rate_max",
            "FLOAT64",
            SNS_OUTSIDE_JP_GATE_CATEGORY_RATE_MAX,
        ),
        bigquery.ScalarQueryParameter("jp_lat_min", "FLOAT64", lat_min),
        bigquery.ScalarQueryParameter("jp_lat_max", "FLOAT64", lat_max),
        bigquery.ScalarQueryParameter("jp_lng_min", "FLOAT64", lng_min),
        bigquery.ScalarQueryParameter("jp_lng_max", "FLOAT64", lng_max),
    ]


def select_checks(check_names: list[str], args: argparse.Namespace) -> tuple[list[str], list[str]]:
    """実行した check のうち «この run で意味を成すもの» と «外したもの» に分ける。

    SQL は 1 本なので全 check が計算される。どれを検証結果として残すかは、
    その run が何を流したかで決まる。

    - `--sns-only`     … SNS の check だけを残す（SNS の run_id には restaurant 側の
                          行が 1 つも無く、restaurant の check は全て ERROR になる）
    - `--sns-run-id` 無し … SNS の check を外す（sns_dish_media_catalog_non_empty が
                          必ず ERROR になる）
    - `--skip-dish-media-checks` … 旧 dish_media 経路の check を外す
    """

    kept: list[str] = []
    skipped: list[str] = []
    for name in check_names:
        if args.sns_only:
            drop = name not in SNS_MEDIA_CHECKS
        elif name in SNS_MEDIA_CHECKS - SHARED_WITH_RESTAURANT_CHECKS:
            drop = args.sns_run_id is None
        elif name in DISH_MEDIA_CHECKS:
            drop = args.skip_dish_media_checks
        else:
            drop = False
        (skipped if drop else kept).append(name)
    return kept, skipped


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()
    parameters = query_parameters(args, run_id)
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
            "sns_run_id": args.sns_run_id,
            "restaurant_catalog_run_id": args.restaurant_catalog_run_id,
            "sns_only": args.sns_only,
        },
        repo_root=REPO_ROOT,
    ) as step:
        results = list(pipeline.execute(validation_sql(pipeline), parameters))
        kept, skipped = select_checks([r.check_name for r in results], args)
        results = [r for r in results if r.check_name in set(kept)]
        if skipped:
            step["skipped_checks"] = skipped
            LOGGER.warning(
                "この run で意味を成さない検査を外した: %s", ", ".join(skipped)
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
