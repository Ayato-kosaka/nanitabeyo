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
          -- #1706 **既存 PG の値を carry-forward しない。**
          --
          -- 以前は COALESCE(existing.*, s.*) で «PG に在る値» を優先していた。
          -- 狙いは «既存行の表示値を上書きしない» ことだったが、その役目は
          -- 9_1 の `created_by_source = 'pipeline'` ガードが持っている（#1643）。
          -- 二重防御になっていただけでなく、**catalog の中身が «1_2 がどの
          -- スキーマを読んだか» に依存**するという副作用があった。dev で作った
          -- catalog には dev の値（Google 由来の address_components / plus_code /
          -- dev の GCS を指す image_path）が焼き込まれ、実測 2,108 行が
          -- そのまま public へ入りうる状態だった。
          --
          -- catalog はオープンデータだけから組む。PG の行を守るのは PG 側の仕事。
          s.canonical_name AS name,
          'ja' AS name_language_code,
          s.latitude,
          s.longitude,
          COALESCE(s.image_url, '') AS image_url,
          s.image_path,
          COALESCE(NULLIF(s.address_components_json, ''), '[]') AS address_components_json,
          s.plus_code_json,
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
          -- #843 独立レビュー②: 同じ place_id へ当たった «負けた seed» の連絡先を拾う。
          --
          -- 3_3 は同じ place_id に複数の seed が当たったとき 1 つだけ残し、
          -- 残りを duplicate_merged / conflict_duplicate_place_id にする。
          -- 畳んでよいと判断できた seed（duplicate_merged）は実測 52,900 件ある。
          -- 店の同定としては正しい（1 店 1 行）が、**連絡先まで一緒に捨てる理由は無い**。
          -- 勝った seed の値を優先し、無ければ負けた seed の値で埋める。
          COALESCE(NULLIF(s.phone, ''), sib.sibling_phone) AS phone,
          COALESCE(NULLIF(s.website, ''), sib.sibling_website) AS website,
          -- SNS は 1 本ではないので、重複を除いて合併する。
          --
          -- ⚠️ `IFNULL` を外してはいけない。**BigQuery の ARRAY_CONCAT は引数に
          -- 1 つでも NULL があると NULL を返す**ので、LEFT JOIN が外れた行
          -- （＝兄弟 seed が居ない大多数）で自分の配列ごと消える。
          -- 実測: これを忘れて social 492,247 → 19,306 / source_names
          -- 621,616 → 50,513 に化けた（同期前に catalog の実測で捕捉）。
          ARRAY(
            SELECT DISTINCT u FROM UNNEST(
              ARRAY_CONCAT(s.social_urls, IFNULL(sib.sibling_social_urls, []))
            ) AS u WHERE u IS NOT NULL AND u != ''
          ) AS social_urls,
          ARRAY(
            SELECT DISTINCT u FROM UNNEST(
              ARRAY_CONCAT(s.source_names, IFNULL(sib.sibling_source_names, []))
            ) AS u WHERE u IS NOT NULL AND u != ''
          ) AS source_names,
          m.match_method
        FROM `{pipeline.dataset_ref}.restaurant_seed_catalog` s
        INNER JOIN `{pipeline.dataset_ref}.restaurant_google_place_match_catalog` m
          USING (seed_id)
        -- 同じ place_id へ当たった «自分以外» の seed から連絡先を集める。
        LEFT JOIN (
          SELECT
            m2.google_place_id,
            m2.seed_id AS winner_seed_id,
            MIN(NULLIF(s2.phone, '')) AS sibling_phone,
            MIN(NULLIF(s2.website, '')) AS sibling_website,
            ARRAY_AGG(DISTINCT u IGNORE NULLS) AS sibling_social_urls,
            ARRAY_AGG(DISTINCT n IGNORE NULLS) AS sibling_source_names
          FROM `{pipeline.dataset_ref}.restaurant_google_place_match_catalog` m2
          JOIN `{pipeline.dataset_ref}.restaurant_google_place_match_catalog` m3
            ON m3.run_id = m2.run_id
           AND m3.google_place_id = m2.google_place_id
           AND m3.seed_id != m2.seed_id
           -- ⚠️ **`duplicate_merged` だけを合併元にする。**
           -- 3_3 は同じ place_id へ複数 seed が当たったとき、畳んでよいと判断した
           -- ものを `duplicate_merged`、判断できなかったものを
           -- `conflict_duplicate_place_id` にする。後者は «別の店かもしれない» という
           -- 意味なので、そこから連絡先を引くと**他店の電話番号を載せる**。
           -- 実測: duplicate_merged 52,900 seed / conflict 770 seed（PR #1700 レビュー）
           AND m3.match_status = 'duplicate_merged'
          JOIN `{pipeline.dataset_ref}.restaurant_seed_catalog` s2
            ON s2.run_id = m3.run_id AND s2.seed_id = m3.seed_id
          LEFT JOIN UNNEST(s2.social_urls) AS u
          LEFT JOIN UNNEST(s2.source_names) AS n
          WHERE m2.run_id = @run_id AND m2.google_place_id IS NOT NULL
          GROUP BY m2.google_place_id, m2.seed_id
        ) sib
          ON sib.google_place_id = m.google_place_id
         AND sib.winner_seed_id = s.seed_id
        WHERE s.run_id = @run_id
          AND m.run_id = @run_id
          AND m.google_place_id IS NOT NULL
          AND m.match_status IN ('existing_pg_matched', 'box_unique_strict', 'manual_matched')
          AND (@allow_osm_only_publish OR s.seed_origin != 'osm_only')
      )
      -- #1706 **PG にしか居ない店は catalog へ出さない。**
      --
      -- `1_2` は «この店の place_id はもう知っている» を open data の seed へ
      -- 結び付けるために PG を読む。open data 側に相手が居る seed
      -- （`existing_pg,overture` など）はその役目を果たしている。
      --
      -- 一方、**出所が existing_pg «だけ» の seed は、open data が何も知らない店**
      -- である。catalog へ出しても持ち込める中身が無く（dev 実測 1,538 行すべてで
      -- 住所・電話・サイト・画像が空）、その店は既に読み出し元の PG に居るので、
      -- 同じスキーマへ書き戻すのは no-op である。
      --
      -- 意味を持つのは **別のスキーマへ流したとき**だけで、そのときは
      -- «dev のアプリ利用者が作った 1,538 店を public へ INSERT する» という
      -- 望まない挙動になる。ここを外すことで catalog は
      -- **どのスキーマを読んで作ったかに依存しなくなる**。
      --
      -- ⚠️ 除くのは «existing_pg 単独» の seed だけである。open data と混ざった
      -- seed（実測 913 行）は place_id の持ち込み元として必要なので残す。
      , publish_rows AS (
        SELECT * FROM publish_values
        WHERE NOT (
          ARRAY_LENGTH(source_names) = 1 AND source_names[OFFSET(0)] = 'existing_pg'
        )
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
          ARRAY_TO_STRING(social_urls, ','), '|',
          -- #1706 source_names も hash に入れる。
          --
          -- 入れないと 9_1 の provenance UPDATE が «名前配列が変わったか» を
          -- 判定するために、62 万行すべてで jsonb から配列を組み立てて比較する
          -- ことになる（実測 1,538 秒 / 更新は 1,220 行だけ）。
          -- hash に含めれば、比較は文字列 1 回で済む。
          ARRAY_TO_STRING(source_names, ',')
        ))) AS row_hash,
        CURRENT_TIMESTAMP() AS built_at
      FROM publish_rows
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
