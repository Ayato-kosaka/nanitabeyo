#!/usr/bin/env python3
"""既存ID・ダブル検索・人手overrideからGoogle Place ID採用表を再生成する。"""

from __future__ import annotations

import argparse
from pathlib import Path

from google.cloud import bigquery

from entity_resolution import SOURCE_PRIORITY
from google_place_matching import ALGORITHM_VERSION
from pipeline_common import BigQueryPipeline, configure_logging, require_run_id

REPO_ROOT = Path(__file__).resolve().parents[2]


def source_rank_sql(column: str) -> str:
    """source_names 配列から最優先ソースの順位を出す SQL 式を作る。

    優先順位を SQL へ直書きすると entity_resolution.SOURCE_PRIORITY と二重管理に
    なる。2_2 の実体解決が採用した代表レコードの決め方と、ここで「同じ店の
    どの seed を残すか」の決め方は一致していないといけない。
    """

    whens = " ".join(
        f"WHEN '{source}' THEN {rank}"
        for source, rank in sorted(SOURCE_PRIORITY.items(), key=lambda kv: kv[1])
    )
    return (
        f"(SELECT MIN(CASE src {whens} ELSE 999 END) "
        f"FROM UNNEST({column}) AS src)"
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Google Place ID match catalogを生成します"
    )
    parser.add_argument("--run-id")
    parser.add_argument("--attempt-lookback-days", type=int, default=90)
    parser.add_argument(
        "--collapse-radius-m",
        type=float,
        default=50.0,
        help=(
            "同じ place_id に当たった seed 群がこの距離以内に収まっていれば"
            "「同一店舗の表記ゆれ」とみなして1行へ畳む。0 で無効化"
        ),
    )
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    if args.attempt_lookback_days <= 0:
        raise ValueError("--attempt-lookback-days は1以上にしてください")
    pipeline = BigQueryPipeline()

    # 優先順位は「最新の人手判断 > 既存PG > 自動照合」。reject overrideは
    # google_place_idをNULLにして必ずpublish対象外とする。
    sql = f"""
      CREATE OR REPLACE TABLE `{pipeline.dataset_ref}.restaurant_google_place_match_catalog`
      CLUSTER BY match_status, google_place_id, seed_id
      OPTIONS (description = '既存DB移植・ダブルクエリ・手動確定を統合した現在の採用結果。')
      AS
      WITH latest_attempt AS (
        SELECT * EXCEPT(rn)
        FROM (
          SELECT
            a.*,
            ROW_NUMBER() OVER (
              PARTITION BY seed_id ORDER BY attempted_at DESC, attempt_id DESC
            ) AS rn
          FROM `{pipeline.dataset_ref}.restaurant_google_place_match_attempts` a
          WHERE attempted_date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL @lookback_days DAY)
                                     AND CURRENT_DATE()
            AND run_id = @run_id
            AND algorithm_version = @algorithm_version
        )
        WHERE rn = 1
      ),
      latest_override AS (
        SELECT * EXCEPT(rn)
        FROM (
          SELECT
            o.*,
            ROW_NUMBER() OVER (
              PARTITION BY seed_id ORDER BY decided_at DESC
            ) AS rn
          FROM `{pipeline.dataset_ref}.restaurant_google_place_match_overrides` o
        )
        WHERE rn = 1
      ),
      resolved AS (
        SELECT
          s.seed_id,
          CASE
            WHEN o.decision = 'reject' THEN NULL
            WHEN o.decision = 'accept' THEN o.google_place_id
            WHEN s.existing_google_place_id IS NOT NULL THEN s.existing_google_place_id
            WHEN a.result_status = 'box_unique_strict' THEN a.matched_place_id
            ELSE NULL
          END AS google_place_id,
          CASE
            WHEN o.decision = 'reject' THEN 'manual_rejected'
            WHEN o.decision = 'accept' AND o.google_place_id IS NOT NULL THEN 'manual_matched'
            WHEN o.decision IS NOT NULL THEN 'invalid_override'
            WHEN s.existing_google_place_id IS NOT NULL THEN 'existing_pg_matched'
            WHEN s.conflict_reason IS NOT NULL THEN 'conflict_seed'
            WHEN a.result_status IS NOT NULL THEN a.result_status
            ELSE 'not_attempted'
          END AS base_status,
          CASE
            WHEN o.decision IS NOT NULL THEN 'manual_override'
            WHEN s.existing_google_place_id IS NOT NULL THEN 'existing_pg_carry_forward'
            WHEN a.result_status IS NOT NULL THEN @algorithm_version
            ELSE 'none'
          END AS match_method,
          CASE
            WHEN o.decision = 'accept' THEN 1.0
            WHEN s.existing_google_place_id IS NOT NULL THEN 1.0
            -- ラベル 6,000 件で確定 5,083 件・裁定後の誤り0件（95%下限 99.92%）。
            -- 1.0 にしないのは、別のラベル集合でも0である保証が無いため。
            WHEN a.result_status = 'box_unique_strict' THEN 0.999
            ELSE NULL
          END AS match_confidence,
          a.attempt_id AS source_attempt_id,
          COALESCE(o.decided_at, a.attempted_at) AS confirmed_at,
          s.location AS seed_location,
          {source_rank_sql("s.source_names")} AS source_rank
        FROM `{pipeline.dataset_ref}.restaurant_seed_catalog` s
        LEFT JOIN latest_attempt a USING (seed_id)
        LEFT JOIN latest_override o USING (seed_id)
        WHERE s.run_id = @run_id
      ),
      -- 同じ place_id に当たった seed 群の広がり（最遠2点の距離）。
      -- 実測では50,519グループのうち95.3%が25m以内、100m超は0件で、中央値は
      -- 7.3m だった。つまりこれらは「別々の店が1つの place_id を奪い合っている」
      -- のではなく、「同じ店がソース違いで2行に分かれ、2_2 の実体解決が
      -- 正規化名の不一致（例: 松屋 / 松屋　戸塚店）で寄せ切れなかった」形である。
      place_id_spread AS (
        SELECT
          google_place_id,
          ST_MAXDISTANCE(ST_UNION_AGG(seed_location), ST_UNION_AGG(seed_location))
            AS spread_m
        FROM resolved
        WHERE google_place_id IS NOT NULL AND seed_location IS NOT NULL
        GROUP BY google_place_id
      ),
      duplicate_checked AS (
        SELECT
          resolved.*,
          place_id_spread.spread_m,
          COUNTIF(google_place_id IS NOT NULL) OVER (PARTITION BY google_place_id) AS place_id_count,
          -- 同じ place_id に複数 seed が当たったとき、既存PG由来（現行DBに
          -- 実在する店）と手動確定は「その place_id である」ことが確定して
          -- いるので勝たせ、open data 側だけを隔離する。両方落とすと本番の
          -- 実在店舗が catalog から消え、8_1 の
          -- existing_pg_restaurants_preserved が落ちる（実測673件）。
          -- 優先度が同じ seed 同士が競合した場合は従来どおり両方隔離する。
          ROW_NUMBER() OVER (
            PARTITION BY google_place_id
            ORDER BY
              CASE base_status
                WHEN 'existing_pg_matched' THEN 0
                WHEN 'manual_matched' THEN 1
                ELSE 2
              END,
              -- 畳み込むときに残す1件は、2_2 の実体解決が代表レコードを選ぶ
              -- のと同じ優先順位（overture > existing_pg > osm > ifas >
              -- food_permit）で決める。seed_id は最後の決定的な同点処理。
              source_rank,
              seed_id
          ) AS place_id_rank,
          COUNTIF(base_status IN ('existing_pg_matched', 'manual_matched'))
            OVER (PARTITION BY google_place_id) AS authoritative_count
        FROM resolved
        LEFT JOIN place_id_spread USING (google_place_id)
      )
      SELECT
        @run_id AS run_id,
        seed_id,
        google_place_id,
        CASE
          WHEN google_place_id IS NULL OR place_id_count <= 1 THEN base_status
          -- 権威ある seed が「ちょうど1件」あるとき、その1件だけを残す。
          -- 2件以上あるなら既存DB側が矛盾しているので人手判断へ回す。
          WHEN authoritative_count = 1 AND place_id_rank = 1 THEN base_status
          -- 権威ある seed が無く、群が @collapse_radius_m 以内に収まっている
          -- なら同一店舗の表記ゆれとみなし、優先ソースの1件だけを残す。
          -- place_id の割り当ては1件も変えないので②（確定分の正解率）には
          -- 影響しない。変わるのは「どの seed の店名を出すか」だけである。
          WHEN authoritative_count = 0
               AND @collapse_radius_m > 0
               AND spread_m IS NOT NULL
               AND spread_m <= @collapse_radius_m
            THEN IF(place_id_rank = 1, base_status, 'duplicate_merged')
          ELSE 'conflict_duplicate_place_id'
        END AS match_status,
        match_method,
        match_confidence,
        source_attempt_id,
        confirmed_at,
        CURRENT_TIMESTAMP() AS built_at
      FROM duplicate_checked
    """
    parameters = [
        bigquery.ScalarQueryParameter("run_id", "STRING", run_id),
        bigquery.ScalarQueryParameter(
            "lookback_days", "INT64", args.attempt_lookback_days
        ),
        bigquery.ScalarQueryParameter("algorithm_version", "STRING", ALGORITHM_VERSION),
        bigquery.ScalarQueryParameter(
            "collapse_radius_m", "FLOAT64", args.collapse_radius_m
        ),
    ]
    with pipeline.step(
        run_id,
        "3_3_build_google_place_match_catalog",
        parameters={
            "attempt_lookback_days": args.attempt_lookback_days,
            "collapse_radius_m": args.collapse_radius_m,
        },
        repo_root=REPO_ROOT,
    ) as step:
        pipeline.execute(sql, parameters)
        step["row_count"] = next(
            iter(
                pipeline.execute(
                    f"SELECT COUNT(*) AS c FROM `{pipeline.dataset_ref}.restaurant_google_place_match_catalog`"
                )
            )
        ).c


if __name__ == "__main__":
    main()
