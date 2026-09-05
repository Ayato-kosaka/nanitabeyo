#!/usr/bin/env python3
"""ソース別rawを「ソース1レコード=1行」の共通形式へ変換する。

この段階では同一店舗を統合しない。Overture、IFAS、OSM、既存PGの列差を吸収し、
次の2_2が同じ名寄せロジックを全ソースへ適用できる状態だけを作る。
"""

from __future__ import annotations

import argparse
import json
import logging
from collections.abc import Iterable
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from google.cloud import bigquery

from normalization import (
    normalize_address,
    normalize_name,
    normalize_name_l1,
    normalize_phone,
    s2_cell_id,
)
from pipeline_common import BigQueryPipeline, configure_logging, require_run_id

LOGGER = logging.getLogger(__name__)
REPO_ROOT = Path(__file__).resolve().parents[2]
JAPAN_BOUNDS = {"min_lat": 20.0, "max_lat": 46.5, "min_lon": 122.0, "max_lon": 154.0}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="source rawを共通形式へ変換します")
    parser.add_argument("--run-id")
    parser.add_argument("--snapshot-date", type=date.fromisoformat, required=True)
    parser.add_argument(
        "--skip-invalid-existing",
        action="store_true",
        help="名称・座標が不正な既存PG行を、IDを記録したうえで除外して続行する。"
        "既定は停止（現行データ100%保全）。devスキーマのテスト行を想定した逃げ道で、"
        "public の実行では付けないこと",
    )
    return parser.parse_args()


def address_from_components(value: str | None) -> str:
    """既存Google形式JSONから名寄せ用の住所文字列だけを復元する。

    PostgreSQLへ戻す際には元JSONをそのまま使う。この文字列は名寄せ候補の
    tie-breakにしか使わず、Google Contentの代替マスターにはしない。
    """

    if not value:
        return ""
    try:
        components = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return ""
    if not isinstance(components, list):
        return ""
    priorities = {
        "administrative_area_level_1": 10,
        "administrative_area_level_2": 20,
        "locality": 30,
        "ward": 40,
        "sublocality": 50,
        "sublocality_level_1": 50,
        "route": 60,
        "street_number": 70,
        "premise": 80,
    }
    selected: list[tuple[int, str]] = []
    for component in components:
        if not isinstance(component, dict):
            continue
        text = component.get("longText") or component.get("long_name")
        types = component.get("types") or []
        if not text:
            continue
        priority = min(
            (priorities[item] for item in types if item in priorities), default=999
        )
        if priority < 999:
            selected.append((priority, str(text)))
    return "".join(text for _, text in sorted(selected))


def country_from_components(value: str | None) -> str | None:
    """既存PG行（Google由来）の address_components から国コードを取り出す。

    #843 既存PG行だけは海外がありうるので «一律 JP» にしてはいけない。
    Google の `country` component の shortText が ISO 3166-1 alpha-2 である。
    引けない行は None のままにする（座標から国を推測しない）。
    """

    if not value:
        return None
    try:
        components = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(components, list):
        return None
    for component in components:
        if not isinstance(component, dict):
            continue
        if "country" not in (component.get("types") or []):
            continue
        short_text = component.get("shortText") or component.get("short_name")
        if isinstance(short_text, str) and len(short_text) == 2 and short_text.isupper():
            return short_text
    return None


def valid_coordinates(latitude: Any, longitude: Any) -> bool:
    """座標として成立しているか。**日本かどうかは見ない。**

    #843 ここで日本の矩形まで課していたため、既存PGにある海外の店（実測 338 行 /
    13.8%。トビリシ・ロンドン等の実在店）が «不正な行» として捨てられていた。
    «座標として壊れている» と «探索範囲の外» は別の話なので、関数を分ける。
    """

    if not isinstance(latitude, (int, float)) or not isinstance(
        longitude, (int, float)
    ):
        return False
    if isinstance(latitude, bool) or isinstance(longitude, bool):
        return False
    return -90.0 <= latitude <= 90.0 and -180.0 <= longitude <= 180.0


def in_japan_bounds(latitude: Any, longitude: Any) -> bool:
    """今回の探索範囲に入るか。**«日本かどうか» の判定ではない。**

    ⚠️ #843 この矩形は韓国全土とロシア沿海地方を含む。国を決める材料にしてはいけない。
    国は `country_code`（1_3 が Overture の addresses[1].country から運ぶ値、
    政府台帳・日本 extract なら 'JP'、既存PGは Google の country component）で決まる。
    ここは «Google 照合の矩形を作れる範囲か» を見ているだけである。

    open data 側は日本のぶんしか取り込まないのでこれで絞る。
    既存PG行には課さない — 海外の店を «無かったこと» にしないため。
    Google 照合へ回すかどうかも、最終的にはこの判定で決まる（3_2 は
    seed の座標を使って矩形を組み立てるので、範囲外の seed は候補にならない）。
    """

    if not valid_coordinates(latitude, longitude):
        return False
    return (
        JAPAN_BOUNDS["min_lat"] <= latitude <= JAPAN_BOUNDS["max_lat"]
        and JAPAN_BOUNDS["min_lon"] <= longitude <= JAPAN_BOUNDS["max_lon"]
    )


def query_rows(
    pipeline: BigQueryPipeline, sql: str, run_id: str, snapshot_date: date
) -> Iterable[Any]:
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("run_id", "STRING", run_id),
            bigquery.ScalarQueryParameter("snapshot_date", "DATE", snapshot_date),
        ]
    )
    return pipeline.client.query(
        sql, job_config=job_config, location=pipeline.config.region
    ).result(page_size=10_000)


def build_common_row(
    *,
    run_id: str,
    source: str,
    source_record_id: str,
    source_release: str | None,
    name: str | None,
    name_language_code: str | None,
    address: str | None,
    country_code: str | None,
    latitude: float | None,
    longitude: float | None,
    phone: str | None,
    website: str | None,
    social_urls: list[str] | tuple[str, ...] | None,
    source_categories: list[str] | tuple[str, ...] | None,
    operating_status: str | None,
    source_confidence: float | None,
    existing_restaurant_id: str | None,
    google_place_id: str | None,
    image_url: str | None,
    image_path: str | None,
    address_components_json: str | None,
    plus_code_json: str | None,
    raw_payload_json: str | None,
    record_hash: str,
    require_japan: bool = True,
) -> dict[str, Any] | None:
    """共通形式の 1 行を組む。座標か名前が使えなければ None。

    #843 `require_japan` は «探索範囲の外なら取り込まない» の意味である。
    open data は日本ぶんしか扱わないので既定 True。**既存PG行だけは False** で呼ぶ。
    海外の店を «不正な行» として捨てないためで、これを混ぜていたせいで
    実測 338 行（既存 2,446 行の 13.8%）が BigQuery 側から消えていた。
    """

    cleaned_name = (name or "").strip()
    if not cleaned_name:
        return None
    in_scope = in_japan_bounds if require_japan else valid_coordinates
    if not in_scope(latitude, longitude):
        return None
    assert latitude is not None and longitude is not None
    cleaned_address = (address or "").strip()
    return {
        "run_id": run_id,
        "source": source,
        "source_record_id": source_record_id,
        "source_release": source_release,
        "name": cleaned_name,
        "name_language_code": name_language_code,
        "normalized_name": normalize_name(cleaned_name),
        "normalized_name_l1": normalize_name_l1(cleaned_name),
        "address": cleaned_address or None,
        "normalized_address": normalize_address(cleaned_address) or None,
        # #843 国は «取り込んだときに分かっていた値» だけを入れる。
        # 座標から推測した値をここに混ぜると、後段が «根拠のある国» と区別できない。
        "country_code": country_code or None,
        "latitude": latitude,
        "longitude": longitude,
        "location": f"POINT({longitude} {latitude})",
        "s2_cell_id": s2_cell_id(latitude, longitude),
        "phone": normalize_phone(phone),
        "website": website,
        "social_urls": sorted(set(filter(None, social_urls or ()))),
        "source_categories": sorted(set(filter(None, source_categories or ()))),
        "operating_status": operating_status,
        "source_confidence": source_confidence,
        "existing_restaurant_id": existing_restaurant_id,
        "google_place_id": google_place_id,
        "image_url": image_url,
        "image_path": image_path,
        "address_components_json": address_components_json,
        "plus_code_json": plus_code_json,
        "raw_payload_json": raw_payload_json,
        "record_hash": record_hash,
        "built_at": datetime.now(timezone.utc).isoformat(),
    }


def iter_source_records(
    pipeline: BigQueryPipeline,
    run_id: str,
    snapshot_date: date,
    skipped_invalid_existing: list[str] | None = None,
) -> Iterable[dict[str, Any]]:
    dataset = pipeline.dataset_ref

    existing_sql = f"""
      SELECT * FROM `{dataset}.restaurant_existing_pg_raw`
      WHERE snapshot_date = @snapshot_date AND run_id = @run_id
      ORDER BY source_record_id
    """
    for row in query_rows(pipeline, existing_sql, run_id, snapshot_date):
        result = build_common_row(
            run_id=run_id,
            source="existing_pg",
            source_record_id=row.source_record_id,
            source_release=None,
            name=row.name,
            name_language_code=row.name_language_code,
            address=address_from_components(row.address_components_json),
            # #843/#843 既存PG行は海外がありうる。Google の country component から引く。
            country_code=country_from_components(row.address_components_json),
            latitude=row.latitude,
            longitude=row.longitude,
            phone=None,
            website=None,
            social_urls=None,
            source_categories=None,
            operating_status="existing",
            source_confidence=1.0,
            existing_restaurant_id=row.source_record_id,
            google_place_id=row.google_place_id,
            image_url=row.image_url,
            image_path=row.image_path,
            address_components_json=row.address_components_json,
            plus_code_json=row.plus_code_json,
            raw_payload_json=None,
            record_hash=row.record_hash,
            # #843 既存PG行には日本の矩形を課さない（海外の実在店を捨てないため）
            require_japan=False,
        )
        if result is None:
            # 既存PG行だけは「open dataの不正行」と同じように黙って捨てない。
            # 現行データ100%保全を優先し、対象IDを示してstep全体を停止する。
            # devスキーマにはJapan boundsの外を指すテスト行が混ざるため、
            # --skip-invalid-existing のときだけIDを残して除外する（8_1 の
            # 既存PG欠損チェックは seed_catalog 起点なので、ここで除外した行は
            # ゲートに掛からない）。
            if skipped_invalid_existing is not None:
                LOGGER.warning(
                    "不正な既存restaurantを除外: id=%s name=%r lat=%r lng=%r",
                    row.source_record_id, row.name, row.latitude, row.longitude,
                )
                skipped_invalid_existing.append(row.source_record_id)
                continue
            raise RuntimeError(
                f"既存restaurantの名称または座標が不正です: {row.source_record_id}"
            )
        yield result

    overture_sql = f"""
      SELECT * FROM `{dataset}.restaurant_overture_raw`
      WHERE snapshot_date = @snapshot_date AND run_id = @run_id
        AND lower(coalesce(operating_status, '')) NOT IN ('closed', 'permanently_closed')
      ORDER BY source_record_id
    """
    for row in query_rows(pipeline, overture_sql, run_id, snapshot_date):
        result = build_common_row(
            run_id=run_id,
            source="overture",
            source_record_id=row.source_record_id,
            source_release=row.source_release,
            name=row.name,
            name_language_code="ja",
            address=row.address,
            # #843 1_3 が addresses[1].country で絞ったうえで残した実測値。
            country_code=row.address_country,
            latitude=row.latitude,
            longitude=row.longitude,
            phone=next(iter(row.phones or ()), None),
            website=next(iter(row.websites or ()), None),
            social_urls=list(row.socials or ()),
            source_categories=list(row.categories or ()),
            operating_status=row.operating_status,
            source_confidence=row.confidence,
            existing_restaurant_id=None,
            google_place_id=None,
            image_url=None,
            image_path=None,
            address_components_json=None,
            plus_code_json=None,
            # feature単位のsource/license情報。restaurant_seed_source_linksから
            # Overture rawへ戻れるため、名寄せ後もattributionを再構成できる。
            raw_payload_json=row.sources_json,
            record_hash=row.record_hash,
        )
        if result:
            yield result

    ifas_sql = f"""
      SELECT * FROM `{dataset}.restaurant_ifas_raw`
      WHERE snapshot_date = @snapshot_date AND run_id = @run_id AND is_active
      ORDER BY source_record_id
    """
    for row in query_rows(pipeline, ifas_sql, run_id, snapshot_date):
        result = build_common_row(
            run_id=run_id,
            source="ifas",
            source_record_id=row.source_record_id,
            source_release=row.source_release,
            name=row.name,
            name_language_code="ja",
            address=row.address,
            # #843 IFAS は厚労省の食品営業許可台帳なので、行が在る時点で日本である。
            country_code="JP",
            latitude=row.latitude,
            longitude=row.longitude,
            phone=row.phone,
            website=None,
            social_urls=None,
            source_categories=[
                item for item in (row.business_type, row.business_format) if item
            ],
            operating_status="active_permit",
            source_confidence=None,
            existing_restaurant_id=None,
            google_place_id=None,
            image_url=None,
            image_path=None,
            address_components_json=None,
            plus_code_json=None,
            raw_payload_json=row.raw_payload_json,
            record_hash=row.record_hash,
        )
        if result:
            yield result

    # 4つ目のソース。IFAS に載らない改正前の許可を補う。座標が無い行は矩形を
    # 作れず名寄せできないので、ここで落とす（raw には残してある）。
    permit_sql = f"""
      SELECT * FROM `{dataset}.restaurant_food_permit_raw`
      WHERE snapshot_date = @snapshot_date AND run_id = @run_id AND is_active
        AND latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY source_record_id
    """
    for row in query_rows(pipeline, permit_sql, run_id, snapshot_date):
        result = build_common_row(
            run_id=run_id,
            source="food_permit",
            # 1_6 の旧実装は source_record_id をファイル名の先頭48文字から
            # 作っており、同じ自治体の別ファイルどうしで衝突した（根本は
            # food_permits.py で修正済み）。既に取り込んだ raw を作り直さずに
            # 「1 source record = 1 row」を保つため、内容ハッシュを添えて
            # ここでも一意性を担保する。ID が既に一意な新しい raw でも
            # 決定的に同じ値になり、二重に付くことはない。
            source_record_id=f"{row.source_record_id}#{row.record_hash[:12]}",
            source_release=row.source_release,
            name=row.name,
            name_language_code="ja",
            address=row.address,
            # #843 自治体の食品営業許可台帳なので日本である。
            country_code="JP",
            latitude=row.latitude,
            longitude=row.longitude,
            phone=None,
            website=None,
            social_urls=None,
            source_categories=[item for item in (row.business_type,) if item],
            operating_status="active_permit",
            source_confidence=None,
            existing_restaurant_id=None,
            google_place_id=None,
            image_url=None,
            image_path=None,
            address_components_json=None,
            plus_code_json=None,
            raw_payload_json=row.raw_payload_json,
            record_hash=row.record_hash,
        )
        if result:
            yield result

    osm_sql = f"""
      SELECT * FROM `{dataset}.restaurant_osm_raw`
      WHERE snapshot_date = @snapshot_date AND run_id = @run_id
      ORDER BY source_record_id
    """
    for row in query_rows(pipeline, osm_sql, run_id, snapshot_date):
        result = build_common_row(
            run_id=run_id,
            source="osm",
            source_record_id=row.source_record_id,
            source_release=row.source_release,
            name=row.name,
            name_language_code="ja",
            address=row.address,
            # #843 1_5 に渡す PBF は geofabrik の japan-latest（日本のextract）なので
            # 日本である。別の extract を入れるなら、ここも source_uri から決め直すこと。
            country_code="JP",
            latitude=row.latitude,
            longitude=row.longitude,
            phone=row.phone,
            website=row.website,
            social_urls=list(row.social_urls or ()),
            source_categories=[row.amenity, *(row.cuisine or ())],
            operating_status=None,
            source_confidence=None,
            existing_restaurant_id=None,
            google_place_id=None,
            image_url=None,
            image_path=None,
            address_components_json=None,
            plus_code_json=None,
            raw_payload_json=row.tags_json,
            record_hash=row.record_hash,
        )
        if result:
            yield result


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()
    skipped: list[str] | None = [] if args.skip_invalid_existing else None
    with pipeline.step(
        run_id,
        "2_1_build_restaurant_source_records",
        parameters={
            "snapshot_date": args.snapshot_date,
            "skip_invalid_existing": args.skip_invalid_existing,
        },
        repo_root=REPO_ROOT,
    ) as step:
        row_count = pipeline.load_json_rows(
            "restaurant_source_records",
            iter_source_records(pipeline, run_id, args.snapshot_date, skipped),
            write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
        )
        if row_count == 0:
            raise RuntimeError(
                "restaurant_source_records が0件です。1_* のrun_idを確認してください。"
            )
        step["row_count"] = row_count
        if skipped:
            step["skipped_invalid_existing"] = skipped
            LOGGER.warning("不正として除外した既存restaurant: %d件 %s", len(skipped), skipped)


if __name__ == "__main__":
    main()
