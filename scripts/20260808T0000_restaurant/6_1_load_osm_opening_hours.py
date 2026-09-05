#!/usr/bin/env python3
"""#1666 OSM の営業時間を PostgreSQL の `restaurant_opening_hours` へ入れる。

## 位置づけ

営業時間の供給元は 2 つある。

1. **OSM の `opening_hours`** … これ。BigQuery に取り込み済みで、追加のネットワーク不要
2. 公式サイトのクロール … #1273 側の fetch 基盤に相乗りする（別途）

⚠️ **OSM で埋まるのは全店の 1.69% 程度**（[実測](https://github.com/Ayato-kosaka/nanitabeyo/issues/1666#issuecomment-5536782822)）。
クローラの代わりにはならない。「追加ネットワーク 0 で拾えるおまけ」である。

## OSM のレコードと自社の店をどう突き合わせるか

**BigQuery の中で完結させる。** `restaurant_source_records`（source='osm'）から
`restaurant_catalog` へは lineage が残っていないので、**位置と名前で突き合わせる**。

    OSM の点 ──(30m 以内 / 1 対 1)── restaurant_catalog ── google_place_id ── PG の restaurants

⚠️ `google_place_id` を経由するのは、PostgreSQL 側と**確実に同じ店を指せる唯一の鍵**
   だからである。座標で PG を引き直すと、BigQuery 側と別の丸め・別の索引で
   «少しだけ違う店» を掴む余地が残る。

### «近いものを全部» にすると、他店の営業時間を配ることになる

⚠️ **距離だけで結ぶと 1 対多になる。** 実測（[計測](https://github.com/Ayato-kosaka/nanitabeyo/issues/1666)）では
OSM の 1 点が最大 **62 店**に当たった。雑居ビルに OSM がノードを 1 つしか持たず、
Google 側には各階のテナントが個別に載っているためである。そのまま入れると
**61 店に «隣の店の営業時間» を配る**ことになり、#288 の営業中フィルタが
開いている店を閉店と判定する（あるいはその逆をする）。

そこで、**どのテナントか言い切れるときだけ採る**。言い切れないものは捨てる
（3 値判定の `unknown` のまま残るので、営業時間が «無い» のと同じ扱いになる）。

| 採る条件 | 根拠の強さ | 実測 |
| --- | --- | --- |
| 30m 以内に**名前が一致する店がちょうど 1 つ** | 名前が一致している | 5,976 店 |
| 30m 以内の候補が**そもそも 1 店だけ** | 他に取り違える相手が居ない | — |
| 15m 以内の候補が**ちょうど 1 店**（名前は不一致） | 距離が飛び抜けて近い | — |
| 上記以外 | **捨てる** | 5,947 点 |

さらに、**店側から見ても 1 対 1 にする**（2 つの OSM 点が同じ店を主張したら、
名前一致 → 距離の順で 1 つだけ残す）。結果は 13,782 点 → 13,782 店、平均 8.7m。

## 上書きの仕方

`source='osm'` の行だけを **対象店ぶん消してから入れ直す**（1 トランザクション）。
UPSERT だけだと、OSM 側で消えたコマ（例: 昼営業をやめた）が残り続ける。
他の source（`official_site` / `user` / `owner`）には一切触らない。

## 使い方（db-script-run.yml から）

    # 1. まず件数を見る（BigQuery は読むだけ / PostgreSQL には触らない）
    script_path: scripts/20260808T0000_restaurant/6_1_load_osm_opening_hours.py
    args: --schema dev

    # 2. 確認できたら入れる
    args: --schema dev --apply

⚠️ `--schema public` への `--apply` はスクリプト側で拒否する。

環境変数:
    DATABASE_URL … PostgreSQL 接続文字列（必須）
"""

from __future__ import annotations

import argparse
import collections
import logging
import os
import sys
from pathlib import Path

from google.cloud import bigquery

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from osm_opening_hours import parse_osm_opening_hours  # noqa: E402
from pipeline_common import BigQueryPipeline, configure_logging  # noqa: E402

LOGGER = logging.getLogger(__name__)

DEFAULT_CATALOG_RUN_ID = "restaurant-2026-08-23"
DEFAULT_SNAPSHOT_DATE = "2026-08-23"
# OSM の点と catalog の店を «同じ店» とみなす距離。#1782 の計測でも 30m を使っている
MATCH_RADIUS_M = 30
# 名前が当てにできないときに «飛び抜けて近い» と言える距離（段階③）
NEAR_RADIUS_M = 15

SOURCE = "osm"

# OSM の点と catalog の店を «取り違えない範囲で» 1 対 1 に結ぶ。
# 判定の根拠と、この形にした理由は上の docstring を読むこと。
# ⚠️ ここを «30m 以内を全部» に緩めると、雑居ビルの 1 ノードが最大 62 店へ
#    他店の営業時間を配る。段階を外すときは必ず 1 対 1 が保たれるか測り直す。
NAME_NORMALIZE_SQL = r"LOWER(REGEXP_REPLACE(NORMALIZE({col}, NFKC), r'[\s\p{{P}}\p{{S}}]', ''))"

MATCH_SQL = """
WITH osm AS (
  SELECT
    source_record_id,
    location,
    {osm_name} AS norm_name,
    JSON_VALUE(raw_payload_json, '$.opening_hours') AS opening_hours
  FROM `{dataset}.restaurant_source_records`
  WHERE run_id = @catalog_run_id
    AND source = 'osm'
    AND JSON_VALUE(raw_payload_json, '$.opening_hours') IS NOT NULL
    AND JSON_VALUE(raw_payload_json, '$.opening_hours') != ''
),
cat AS (
  SELECT google_place_id, location, {cat_name} AS norm_name
  FROM `{dataset}.restaurant_catalog`
  WHERE run_id = @catalog_run_id
    AND google_place_id IS NOT NULL
),
-- 30m 以内の «あり得る組み合わせ» を全部出す（まだ絞らない）
paired AS (
  SELECT
    osm.source_record_id,
    cat.google_place_id,
    osm.opening_hours,
    ST_DISTANCE(cat.location, osm.location) AS distance_m,
    (osm.norm_name IS NOT NULL AND osm.norm_name = cat.norm_name) AS name_eq
  FROM cat
  JOIN osm ON ST_DWITHIN(cat.location, osm.location, @radius_m)
),
-- OSM の点ごとに «候補が何件あるか» を数え、言い切れるかどうかを決める
per_osm AS (
  SELECT
    source_record_id,
    COUNT(*) AS n_candidates,
    COUNTIF(name_eq) AS n_name_eq,
    COUNTIF(distance_m <= @near_radius_m) AS n_near
  FROM paired
  GROUP BY source_record_id
),
eligible AS (
  SELECT
    p.*,
    CASE
      WHEN o.n_name_eq = 1 AND p.name_eq THEN 'name'
      WHEN o.n_name_eq = 0 AND o.n_candidates = 1 THEN 'sole'
      ELSE 'near'
    END AS match_tier
  FROM paired p
  JOIN per_osm o USING (source_record_id)
  WHERE
    -- ① 名前が一致する店がちょうど 1 つ → その店
    (o.n_name_eq = 1 AND p.name_eq)
    -- ② 名前は当てにできないが、候補がそもそも 1 店だけ
    OR (o.n_name_eq = 0 AND o.n_candidates = 1)
    -- ③ 候補は複数あるが、近い方の輪の中に 1 店しか居ない
    OR (o.n_name_eq = 0 AND o.n_candidates > 1
        AND o.n_near = 1 AND p.distance_m <= @near_radius_m)
),
-- 店側から見ても 1 対 1 にする（2 つの OSM 点が同じ店を主張したときの後始末）
store_dedup AS (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY google_place_id
    ORDER BY name_eq DESC, distance_m ASC, source_record_id
  ) AS rn
  FROM eligible
)
SELECT google_place_id, opening_hours, distance_m, match_tier
FROM store_dedup
WHERE rn = 1
"""

DELETE_SQL = """
  DELETE FROM restaurant_opening_hours
  WHERE source = %s AND restaurant_id = ANY(%s::uuid[])
"""

# 10 万行弱を入れるので execute_values でまとめる（1 行ずつだと往復で時間が溶ける）
INSERT_SQL = """
  INSERT INTO restaurant_opening_hours
    (restaurant_id, source, day_of_week, opens_at, closes_at, crosses_midnight, fetched_at)
  VALUES %s
  ON CONFLICT (restaurant_id, source, day_of_week, opens_at) DO NOTHING
"""


def fetch_matches(catalog_run_id: str, limit: int | None):
    """BigQuery で «OSM の営業時間 × 自社の google_place_id» を取る（読むだけ）。"""
    pipeline = BigQueryPipeline()
    sql = MATCH_SQL.format(
        dataset=pipeline.dataset_ref,
        osm_name=NAME_NORMALIZE_SQL.format(col="name"),
        cat_name=NAME_NORMALIZE_SQL.format(col="name"),
    )
    if limit:
        sql += f"\nLIMIT {int(limit)}"
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("catalog_run_id", "STRING", catalog_run_id),
            bigquery.ScalarQueryParameter("radius_m", "FLOAT64", float(MATCH_RADIUS_M)),
            bigquery.ScalarQueryParameter("near_radius_m", "FLOAT64", float(NEAR_RADIUS_M)),
        ]
    )
    rows = pipeline.client.query(
        sql, job_config=job_config, location=pipeline.config.region
    ).result()
    return [(r.google_place_id, r.opening_hours, r.match_tier) for r in rows]


def main() -> int:
    configure_logging()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev")
    parser.add_argument("--catalog-run-id", default=DEFAULT_CATALOG_RUN_ID)
    parser.add_argument("--snapshot-date", default=DEFAULT_SNAPSHOT_DATE)
    parser.add_argument("--limit", type=int, default=None, help="動作確認用に件数を絞る")
    parser.add_argument(
        "--apply", action="store_true", help="PostgreSQL へ書き込む（既定は書かない）"
    )
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        LOGGER.error("❌ DATABASE_URL environment variable is required")
        return 1
    if args.schema == "public" and args.apply:
        LOGGER.error("❌ public への書き込みはこのスクリプトからは行わない")
        return 1

    import psycopg2
    from psycopg2.extras import execute_values

    LOGGER.info("BigQuery から OSM の営業時間 × google_place_id を取得中…")
    matches = fetch_matches(args.catalog_run_id, args.limit)
    LOGGER.info("突き合わせできた店: %s 件", f"{len(matches):,}")

    # 突き合わせが 1 対 1 になっていることを、入れる前にここで確かめる。
    # 崩れているなら «他店の営業時間を配る» 状態なので、書かずに落とす。
    place_ids = [m[0] for m in matches]
    if len(set(place_ids)) != len(place_ids):
        LOGGER.error(
            "❌ 同じ店に複数の営業時間が割り当たっている（%s 件 / %s 店）。書き込みを中止する。",
            f"{len(place_ids):,}",
            f"{len(set(place_ids)):,}",
        )
        return 1

    tiers = collections.Counter(m[2] for m in matches)
    LOGGER.info(
        "  内訳: 名前一致 %s / 候補が 1 店だけ %s / %sm 以内に 1 店 %s",
        f"{tiers['name']:,}",
        f"{tiers['sole']:,}",
        NEAR_RADIUS_M,
        f"{tiers['near']:,}",
    )

    # 文字列 → 行。扱えないものは «推測せず» 捨てる（3 値判定の unknown のまま残る）
    parsed_by_place: dict[str, list] = {}
    unparsable = collections.Counter()
    for place_id, raw, _tier in matches:
        rows = parse_osm_opening_hours(raw)
        if rows is None:
            unparsable[raw] += 1
            continue
        if rows:
            parsed_by_place[place_id] = rows

    total_rows = sum(len(v) for v in parsed_by_place.values())
    LOGGER.info("")
    LOGGER.info("=" * 72)
    LOGGER.info("# 変換結果")
    LOGGER.info("=" * 72)
    LOGGER.info("営業時間を行にできた店 : %s 件", f"{len(parsed_by_place):,}")
    LOGGER.info("入れる行数             : %s 行", f"{total_rows:,}")
    LOGGER.info(
        "扱えなかった値         : %s 件（%s 種類）— unknown のまま残す",
        f"{sum(unparsable.values()):,}",
        f"{len(unparsable):,}",
    )
    for v, n in unparsable.most_common(5):
        LOGGER.info("    %4s  %s", n, v[:60])

    with psycopg2.connect(database_url) as conn:
        with conn.cursor() as cur:
            if not args.apply:
                cur.execute("SET default_transaction_read_only = on")
            cur.execute(f'SET search_path TO "{args.schema}", extensions')

            # google_place_id → restaurants.id。PG 側に無い店は黙って捨てる
            cur.execute(
                "SELECT google_place_id, id FROM restaurants "
                "WHERE google_place_id = ANY(%s)",
                (list(parsed_by_place.keys()),),
            )
            fetched = cur.fetchall()
            id_by_place = dict(fetched)
            # BigQuery 側で 1 対 1 にしても、PG 側で同じ google_place_id を持つ店が
            # 2 つあれば、そこでまた «別の店へ配る» が復活する。ここでも確かめる。
            if len(id_by_place) != len(fetched):
                LOGGER.error(
                    "❌ 同じ google_place_id を持つ restaurants が複数ある（%s 行 / %s 店）。中止する。",
                    f"{len(fetched):,}",
                    f"{len(id_by_place):,}",
                )
                return 1
            LOGGER.info("")
            LOGGER.info(
                "PostgreSQL(%s) に居た店: %s / %s",
                args.schema,
                f"{len(id_by_place):,}",
                f"{len(parsed_by_place):,}",
            )

            restaurant_ids = list(id_by_place.values())
            insert_rows = [
                (
                    id_by_place[place_id],
                    SOURCE,
                    r.day_of_week,
                    r.opens_at,
                    r.closes_at,
                    r.crosses_midnight,
                    f"{args.snapshot_date}T00:00:00Z",
                )
                for place_id, rows in parsed_by_place.items()
                if place_id in id_by_place
                for r in rows
            ]
            LOGGER.info("実際に入る行数: %s 行", f"{len(insert_rows):,}")

            if not args.apply:
                LOGGER.info("")
                LOGGER.info("dry-run のため書き込んでいません。--apply を付けると実行します。")
                LOGGER.info("戻すには: DELETE FROM restaurant_opening_hours WHERE source = 'osm';")
                return 0

            # source='osm' の行だけを対象店ぶん消してから入れ直す（1 トランザクション）
            cur.execute(DELETE_SQL, (SOURCE, restaurant_ids))
            deleted = cur.rowcount
            execute_values(cur, INSERT_SQL, insert_rows, page_size=1000)
            conn.commit()

            cur.execute(
                "SELECT count(*), count(DISTINCT restaurant_id) "
                "FROM restaurant_opening_hours WHERE source = %s",
                (SOURCE,),
            )
            n_rows, n_restaurants = cur.fetchone()
            LOGGER.info("")
            LOGGER.info("✅ 古い osm 行 %s 件を消し、%s 件を入れました。", f"{deleted:,}", f"{len(insert_rows):,}")
            LOGGER.info("いま source='osm' の行: %s 行 / %s 店", f"{n_rows:,}", f"{n_restaurants:,}")
            LOGGER.info("戻すには: DELETE FROM restaurant_opening_hours WHERE source = 'osm';")
    return 0


if __name__ == "__main__":
    sys.exit(main())
