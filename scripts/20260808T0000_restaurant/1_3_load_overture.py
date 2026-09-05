#!/usr/bin/env python3
"""固定した Overture GeoParquet から日本の food_and_drink をロードする。"""

from __future__ import annotations

import argparse
import logging
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path

import duckdb

from pipeline_common import (
    BigQueryPipeline,
    configure_logging,
    require_run_id,
    sha256_file,
)

LOGGER = logging.getLogger(__name__)
REPO_ROOT = Path(__file__).resolve().parents[2]

# #843 «日本かどうか» の判定は 1 か所にしか書かない。
# 抽出（COPY）と、抽出前の健全性チェック（assert_country_is_usable）が別々の
# 述語を持つと、片方だけ直したときに «テストは緑のまま取り込みだけ壊れる» が起きる。
JAPAN_COUNTRY_PREDICATE = "addresses[1].country = 'JP'"
# 座標の矩形は国の判定ではなく、«この part ファイルが日本周辺のものか» の前段確認。
BBOX_PREDICATE = (
    "bbox.xmin BETWEEN 122.0 AND 154.0 AND bbox.ymin BETWEEN 20.0 AND 46.5"
)
FOOD_CATEGORY_PREDICATE = """(
              list_contains(taxonomy.hierarchy, 'food_and_drink')
              OR basic_category IN (
                'restaurant', 'bar', 'cafe', 'casual_eatery', 'coffee_shop',
                'food_and_beverage_store', 'bakery', 'dessert_shop', 'pub',
                'fast_food_restaurant'
              )
            )"""
SHAPE_PREDICATE = "names.primary IS NOT NULL AND bbox IS NOT NULL"
# country が NULL の行がこれを超えたら、その release では country を単独の
# 判定材料にできない。実測 (2026-08-19_0) は日本の矩形の全 POI 3,376,834 行中
# 3 行 = 0.0001% なので、0.5% は «明らかに壊れた» だけを捕まえる閾値である。
MAX_MISSING_COUNTRY_RATIO = 0.005


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Overture Places snapshotをBigQueryへロードします"
    )
    parser.add_argument("--run-id")
    parser.add_argument("--snapshot-date", type=date.fromisoformat, required=True)
    parser.add_argument("--source-release", required=True, help="例: 2026-07-22.0")
    parser.add_argument("--parquet", type=Path, required=True)
    parser.add_argument("--source-uri", required=True)
    return parser.parse_args()


def assert_country_is_usable(connection: duckdb.DuckDBPyConnection, source: Path) -> None:
    """country を «国の判定» に使ってよい release かを、取り込む前に確かめる。

    #843 この step は addresses[1].country == 'JP' だけを日本の根拠にする。
    将来の release でこの列が埋まらなくなったら、**静かに日本の店が 8 割消える**。
    件数が減ったことは 1_3 の row_count では分からない（減ること自体は正常な変動と
    区別が付かない）ので、«国が引けない行の割合» を直接測って落とす。

    逆に «矩形の中に国外の行が居ること» はここでは異常ではない。part ファイルは
    地理的に分割されているだけで、韓国・沿海地方が混ざっているのが既定である。
    """

    row = connection.execute(
        f"""
        SELECT
          count(*) AS in_scope,
          count(*) FILTER (WHERE addresses[1].country IS NULL) AS missing_country,
          count(*) FILTER (WHERE {JAPAN_COUNTRY_PREDICATE}) AS japan
        FROM read_parquet({sql_literal(str(source.resolve()))})
        WHERE {BBOX_PREDICATE}
          AND {FOOD_CATEGORY_PREDICATE}
          AND {SHAPE_PREDICATE}
        """
    ).fetchone()
    in_scope, missing_country, japan = int(row[0]), int(row[1]), int(row[2])
    if in_scope == 0:
        raise RuntimeError(
            "矩形内のfood_and_drinkが0件です。parquetのpart/releaseを確認してください。"
        )
    ratio = missing_country / in_scope
    LOGGER.info(
        "国の内訳: 矩形内 %d行 / country='JP' %d行 / countryが無い %d行 (%.4f%%)",
        in_scope, japan, missing_country, ratio * 100,
    )
    if ratio > MAX_MISSING_COUNTRY_RATIO:
        raise RuntimeError(
            f"addresses[1].country が引けない行が {missing_country}/{in_scope} "
            f"({ratio:.2%}) あります。この release では country を単独の日本判定に"
            "使えません。閾値は MAX_MISSING_COUNTRY_RATIO。"
        )


def build_filtered_parquet(
    source: Path, destination: Path, run_id: str, snapshot_date: date, release: str
) -> int:
    source_path = sql_literal(str(source.resolve()))
    destination_path = sql_literal(str(destination.resolve()))
    connection = duckdb.connect()
    try:
        assert_country_is_usable(connection, source)
        # raw snapshotそのものはローカルファイルのchecksumで固定する。BigQueryには、
        # 後続の名寄せに必要な列を型付きで保存し、790k件×巨大JSONの重複保持を避ける。
        query = f"""
        COPY (
          SELECT
            {sql_literal(run_id)}::VARCHAR AS run_id,
            {sql_literal(snapshot_date.isoformat())}::DATE AS snapshot_date,
            {sql_literal(release)}::VARCHAR AS source_release,
            id::VARCHAR AS source_record_id,
            names.primary::VARCHAR AS name,
            coalesce(addresses[1].freeform::VARCHAR, '') AS address,
            addresses[1].country::VARCHAR AS address_country,
            ((bbox.ymin + bbox.ymax) / 2)::DOUBLE AS latitude,
            ((bbox.xmin + bbox.xmax) / 2)::DOUBLE AS longitude,
            basic_category::VARCHAR AS primary_category,
            coalesce(taxonomy.hierarchy, []::VARCHAR[]) AS categories,
            operating_status::VARCHAR AS operating_status,
            confidence::DOUBLE AS confidence,
            -- Overtureはfeatureごとにsource/licenseが異なる。manifestの一律表記へ
            -- 潰さず、元のsources配列を各行に残してattributionを再現可能にする。
            coalesce(to_json(sources)::VARCHAR, '[]') AS sources_json,
            coalesce(phones, []::VARCHAR[]) AS phones,
            coalesce(websites, []::VARCHAR[]) AS websites,
            coalesce(socials, []::VARCHAR[]) AS socials,
            NULL::VARCHAR AS raw_payload_json,
            sha256(concat_ws('|', id::VARCHAR, coalesce(names.primary::VARCHAR, ''),
              coalesce(addresses[1].freeform::VARCHAR, ''),
              coalesce(addresses[1].country::VARCHAR, ''),
              coalesce(((bbox.ymin + bbox.ymax) / 2)::VARCHAR, ''),
              coalesce(((bbox.xmin + bbox.xmax) / 2)::VARCHAR, ''),
              coalesce(basic_category::VARCHAR, ''),
              coalesce(to_json(taxonomy.hierarchy)::VARCHAR, '[]'),
              coalesce(operating_status::VARCHAR, ''),
              coalesce(confidence::VARCHAR, ''),
              coalesce(to_json(sources)::VARCHAR, '[]'),
              coalesce(to_json(phones)::VARCHAR, '[]'),
              coalesce(to_json(websites)::VARCHAR, '[]'),
              coalesce(to_json(socials)::VARCHAR, '[]'))) AS record_hash,
            current_timestamp AS ingested_at
          FROM read_parquet({source_path})
          -- #843 日本の絞り込みは **addresses[1].country** で行う。座標の矩形は
          -- «この part ファイルに日本以外の地域が混ざっていないか» を見るだけの
          -- 前段フィルタであって、国の判定には使わない。
          --
          -- 以前はここが矩形だけだった。矩形（緯度20.0–46.5 / 経度122.0–154.0）は
          -- **韓国全土とロシア沿海地方を含む**ため、restaurant_catalog
          -- （run=restaurant-2026-08-23, 620,428行）に韓国の店が 97,726 行
          -- （15.75%。うち 92,872 行 95.0% がハングルを含む）、沿海地方の店が
          -- 358 行混入した。
          --
          -- 矩形へ切り替えた根拠（#1276 PoC の «country で絞ると22%落ちる»）は
          -- **2つの変更を同時に測った誤りである**。実測（Overture 2026-08-19_0 /
          -- 同一 bbox・同一述語で再現）:
          --   country='JP' かつ taxonomy のみ … 783,868 行（PoC の 789,612 に対応）
          --   country='JP' かつ taxonomy+basic … 847,392 行
          --   矩形     かつ taxonomy のみ     … 1,005,518 行（PoC の 1,012,263）
          --   矩形     かつ taxonomy+basic    … 1,077,176 行
          -- 22%（+221,650行）は «住所の無い日本の行» ではなく **全部が国外の行**
          -- だった。日本の行を実際に増やしたのは basic_category の併用（+63,524行、
          -- +8.1%）のほうである。だから **category の併用は残し、国の判定だけを
          -- country へ戻す**。
          --
          -- country が欠ける心配も実測で否定できる。日本の矩形にある全 POI
          -- 3,376,834 行のうち addresses[1].country が NULL なのは **3 行**
          -- （freeform が NULL なのは 202,294 行 = 6.0%。«住所が無い» はこちらで
          -- あって、国は別に埋まっている）。逆向きの誤り（日本の店に KR が付く）も
          -- 0 件で、country='KR' の 227,868 行は 1 行も日本の陸地から 200m 以内に
          -- 無い。対馬・五島（矩形では韓国と重なる）は country='JP' なので残る。
          --
          -- カテゴリは taxonomy だけではパン屋・菓子店が欠けるため basic_category を
          -- 併用する（上記のとおり、ここが本当に効いている側）。
          WHERE {JAPAN_COUNTRY_PREDICATE}
            AND {BBOX_PREDICATE}
            AND {FOOD_CATEGORY_PREDICATE}
            AND {SHAPE_PREDICATE}
        ) TO {destination_path} (FORMAT PARQUET, COMPRESSION ZSTD)
        """
        connection.execute(query)
        return int(
            connection.execute(
                f"SELECT count(*) FROM read_parquet({destination_path})"
            ).fetchone()[0]
        )
    finally:
        connection.close()


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    if not args.parquet.is_file():
        raise FileNotFoundError(args.parquet)

    pipeline = BigQueryPipeline()
    parameters = {
        "snapshot_date": args.snapshot_date,
        "source_release": args.source_release,
        "source_uri": args.source_uri,
    }
    with pipeline.step(
        run_id, "1_3_load_overture", parameters=parameters, repo_root=REPO_ROOT
    ) as step:
        with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as stream:
            filtered_path = Path(stream.name)
        try:
            expected = build_filtered_parquet(
                args.parquet,
                filtered_path,
                run_id,
                args.snapshot_date,
                args.source_release,
            )
            if expected == 0:
                raise RuntimeError(
                    "Overtureの日本food_and_drink抽出結果が0件です。release/schemaを確認してください。"
                )
            pipeline.delete_run_rows(
                "restaurant_overture_raw",
                run_id,
                partition_field="snapshot_date",
                partition_date=args.snapshot_date,
            )
            loaded = pipeline.load_parquet("restaurant_overture_raw", filtered_path)
            if loaded != expected:
                raise RuntimeError(
                    f"Overture件数不一致: extracted={expected}, loaded={loaded}"
                )
        finally:
            filtered_path.unlink(missing_ok=True)

        step["row_count"] = loaded
        pipeline.append_manifest(
            {
                "run_id": run_id,
                "source": "overture",
                "snapshot_date": args.snapshot_date.isoformat(),
                "source_release": args.source_release,
                "source_uri": args.source_uri,
                "local_file_name": args.parquet.name,
                "sha256": sha256_file(args.parquet),
                # 実際のlicenseはfeature内sources_jsonで追跡する。このmanifest値を
                # 一律license名として再利用してはいけない。
                "license_id": "per-feature-overture-sources",
                "terms_version": args.source_release,
                "attribution_text": "Overture Maps Foundation and source data providers",
                "row_count": loaded,
                "loaded_at": datetime.now(timezone.utc).isoformat(),
            }
        )


if __name__ == "__main__":
    main()
