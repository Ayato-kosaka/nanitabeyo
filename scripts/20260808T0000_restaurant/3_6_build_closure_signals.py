#!/usr/bin/env python3
"""閉店の «根拠» を集める（#1639）。判定はしない。

## なぜこの形なのか

`2_1` は `WHERE ... AND is_active` で閉店レコードを捨てている。**これは正しい。**
閉店した店を seed 化して «新しい店» として公開してしまっては困るからである。
したがって 2_1 のフィルタは外さない。

代わりに、閉店レコードを **既に公開済みのカタログへ突き合わせる** 別の経路を作る。
「閉店した店を新規に作らない」と「既にある店が閉店したことを知る」は別の仕事である。

## なぜ Google に頼らないのか

無料の Place Details（IDs Only）で «結果が無ければ閉店» を判定できるか実験した結果、
**閉店群 260 店・対照群 260 店とも 200 OK が 100.0%** だった（2026-08-29）。
Google は閉店した店を消さず、`businessStatus: CLOSED_PERMANENTLY` を立てたまま
place_id を生かし続ける。**404 は閉店の信号にならない。**
`businessStatus` を取るには課金 SKU が要るので、無料の道はここには無い。

Overture の `operating_status` も 108 万件中 `permanently_closed` が **1 件**しかなく、
実質使えない。**IFAS（食品衛生の台帳）だけが閉店日を持っている。**

## 突き合わせの規律

**名前一致（NFKC 正規化・空白除去）＋ 座標 50m 以内**に限る。
座標だけだと 1 レコードが約 5.5 店へ広がって使い物にならない（実測 1,128 → 6,182 店）。
名前を足すと 265 レコード → 265 ペアの 1:1 になり、広がりが消える。

`box_unique_strict` と同じ «広がったら採らない» 規律である。

## このテーブルは «判定» ではなく «根拠»

`restaurant_closure_signals` に入るのは「IFAS がこの店を閉店として記録している」という
事実だけで、**閉店と決めたわけではない**。`restaurants` へ反映するかは別の判断で、
複数の独立した根拠が揃ってから行う（`restaurant_bids` は課金済みなので、
1 つの根拠で消してはいけない）。
"""

from __future__ import annotations

import argparse
from pathlib import Path

from google.cloud import bigquery

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id

REPO_ROOT = Path(__file__).resolve().parents[2]

# 名寄せの許容距離。50m は実測で 1:1 に収まった上限。
# これを広げると別テナントを巻き込む（15m 以内の別店舗ペアが 4,482 組ある）。
MATCH_RADIUS_M = 50.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="閉店の根拠を集めます（判定はしません）")
    parser.add_argument("--run-id")
    parser.add_argument(
        "--radius-m",
        type=float,
        default=MATCH_RADIUS_M,
        help=f"名前一致に加えて課す距離。既定 {MATCH_RADIUS_M}m",
    )
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    if not 0 < args.radius_m <= 200:
        raise ValueError("--radius-m は 0〜200 です（広げると別テナントを巻き込む）")
    pipeline = BigQueryPipeline()

    sql = f"""
      CREATE OR REPLACE TABLE `{pipeline.dataset_ref}.restaurant_closure_signals`
      CLUSTER BY google_place_id
      OPTIONS (description = '閉店の根拠。判定ではない。反映は複数の根拠が揃ってから。')
      AS
      WITH cat AS (
        SELECT
          c.google_place_id,
          c.name,
          REGEXP_REPLACE(NORMALIZE(c.name, NFKC), r'[\\s　]', '') AS nname,
          c.location
        FROM `{pipeline.dataset_ref}.restaurant_catalog` c
        WHERE c.run_id = @run_id AND c.location IS NOT NULL
      ),
      closed AS (
        SELECT
          source_record_id,
          name,
          REGEXP_REPLACE(NORMALIZE(name, NFKC), r'[\\s　]', '') AS nname,
          ST_GEOGPOINT(longitude, latitude) AS loc,
          closed_on,
          permit_expires_on,
          is_active
        FROM `{pipeline.dataset_ref}.restaurant_ifas_raw`
        WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 120 DAY)
          AND (is_active = FALSE OR closed_on IS NOT NULL)
          AND latitude IS NOT NULL AND longitude IS NOT NULL
        -- ⚠️ **1 レコードにつき最新のスナップショット 1 本だけを採る。**
        -- restaurant_ifas_raw は snapshot_date で積み上がる。窓の中に 2 本入ると
        -- 同じ廃業レコードが 2 行になり、下の matched_store_count / matched_record_count が
        -- 揃って 2 になって、**1:1 の検査が全件を捨てる**。件数がゼロになるだけで
        -- エラーにはならないので、黙って機能が止まる。
        -- 現在は窓内に 1 本（2026-08-23）しか無く顕在化していないが、次の取り込みで必ず起きる。
        QUALIFY ROW_NUMBER() OVER (
          PARTITION BY source_record_id ORDER BY snapshot_date DESC
        ) = 1
      ),
      matched AS (
        SELECT
          cat.google_place_id,
          cat.name AS catalog_name,
          closed.name AS source_name,
          closed.source_record_id,
          closed.closed_on,
          closed.permit_expires_on,
          ST_DISTANCE(closed.loc, cat.location) AS distance_m,
          -- 1 レコードが複数店に当たったら «広がった» ので採らない。
          COUNT(*) OVER (PARTITION BY closed.source_record_id) AS matched_store_count,
          COUNT(*) OVER (PARTITION BY cat.google_place_id) AS matched_record_count
        FROM closed
        JOIN cat
          ON closed.nname = cat.nname
         AND ST_DWithin(closed.loc, cat.location, @radius_m)
      )
      SELECT
        @run_id AS run_id,
        google_place_id,
        'ifas' AS source,
        source_record_id,
        catalog_name,
        source_name,
        closed_on,
        permit_expires_on,
        distance_m,
        CURRENT_TIMESTAMP() AS observed_at
      FROM matched
      -- 1:1 のものだけ。広がったペアは «同名の別店» の可能性があるので捨てる。
      WHERE matched_store_count = 1 AND matched_record_count = 1
    """

    parameters = [
        bigquery.ScalarQueryParameter("run_id", "STRING", run_id),
        bigquery.ScalarQueryParameter("radius_m", "FLOAT64", args.radius_m),
    ]
    with pipeline.step(
        run_id,
        "3_6_build_closure_signals",
        parameters={"radius_m": args.radius_m},
        repo_root=REPO_ROOT,
    ) as step:
        pipeline.execute(sql, parameters)
        step["row_count"] = next(
            iter(
                pipeline.execute(
                    f"SELECT COUNT(*) AS c "
                    f"FROM `{pipeline.dataset_ref}.restaurant_closure_signals`"
                )
            )
        ).c


if __name__ == "__main__":
    main()
