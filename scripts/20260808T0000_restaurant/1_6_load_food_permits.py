#!/usr/bin/env python3
"""自治体の食品営業許可台帳を BigQuery raw へロードする。

IFAS（`1_4_load_ifas.py`）と役割が違う。IFAS は 2021年6月の食品衛生法改正
**以降**にオンライン申請された分しか持たない。改正前に許可を取った施設は、
各自治体が個別にオープンデータとして公開している。両方入れて初めて許可台帳が
埋まる（鹿児島市: IFAS 9,812 行 + 改正前の台帳 4,885 行）。

なぜ要るかは `food_permits.py` の docstring に測定つきで書いてある。要点だけ:
Google の店に届かない分は名寄せの失敗ではなくデータの欠落で、中心は雑居ビル
上階のスナック・バー。許可台帳の住所には階数が入るのでそこを指せる。

取得は `1276_place_id_free_poc/fetch_permits.py` で行う（CKAN / ArcGIS Hub /
自治体サイト直リンクの3経路）。このスクリプトは落としたファイル群を読む。

座標が無い台帳が多いので、先に `geocode_addresses.py` で住所を解決しておく。
座標が無い行も raw には残す。BigQuery 上で「まだ座標が付いていないだけ」の行と
「そもそも取れない行」を区別できるようにするためである。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sqlite3
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path

from food_permits import iter_permit_rows, load_prefecture_map
from pipeline_common import (
    BigQueryPipeline,
    configure_logging,
    require_run_id,
    sha256_file,
    stable_record_hash,
)

LOGGER = logging.getLogger(__name__)
REPO_ROOT = Path(__file__).resolve().parents[2]
TABLE = "restaurant_food_permit_raw"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="自治体の食品営業許可台帳をBigQueryへロードします"
    )
    parser.add_argument("--run-id")
    parser.add_argument("--snapshot-date", type=date.fromisoformat, required=True)
    parser.add_argument("--source-release")
    parser.add_argument(
        "--directory", type=Path, required=True, help="台帳ファイルを置いたディレクトリ"
    )
    parser.add_argument(
        "--prefecture-map",
        type=Path,
        required=True,
        help="市区町村→都道府県の対応表。台帳の住所は都道府県から始まらないことが多い",
    )
    parser.add_argument(
        "--geocode-cache",
        type=Path,
        help="geocode_addresses.py のキャッシュ。無くても座標なしでロードする",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        help="fetch_permits.py が出す取得元一覧。ライセンス追跡のため記録する",
    )
    return parser.parse_args()


def load_coordinates(path: Path | None) -> dict[str, tuple[float, float, str]]:
    if path is None or not path.exists():
        return {}
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    coordinates = {
        address: (latitude, longitude, level)
        for address, latitude, longitude, level in connection.execute(
            "SELECT address, latitude, longitude, level FROM geocode"
            " WHERE latitude IS NOT NULL"
        )
    }
    connection.close()
    return coordinates


def combined_sha256(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.name.encode("utf-8"))
        digest.update(sha256_file(path).encode("ascii"))
    return digest.hexdigest()


def iter_rows(args: argparse.Namespace, run_id: str, stats: Counter):
    prefectures = load_prefecture_map(args.prefecture_map)
    coordinates = load_coordinates(args.geocode_cache)
    for permit in iter_permit_rows(
        args.directory, prefectures=prefectures, coordinates=coordinates, stats=stats
    ):
        payload = {
            "jurisdiction": permit.jurisdiction,
            "source_record_id": permit.source_record_id,
            "name": permit.name,
            "address": permit.address,
            "business_type": permit.business_type or None,
            "latitude": permit.latitude,
            "longitude": permit.longitude,
            "coordinate_source": permit.coordinate_source or None,
            # 座標が無い行は矩形を作れないので名寄せできない。raw には残し、
            # 2_1 側で除外する。
            "is_active": True,
            "raw_payload_json": permit.raw_payload_json,
        }
        yield {
            "run_id": run_id,
            "snapshot_date": args.snapshot_date.isoformat(),
            "source_release": args.source_release,
            **payload,
            "record_hash": stable_record_hash(payload),
            "ingested_at": datetime.now(timezone.utc).isoformat(),
        }


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    paths = sorted(
        path
        for path in args.directory.glob("*")
        if path.suffix.lower() in (".csv", ".xlsx", ".xlsm", ".xls")
    )
    if not paths:
        raise FileNotFoundError(f"許可台帳のファイルがありません: {args.directory}")

    stats: Counter = Counter()
    pipeline = BigQueryPipeline()
    parameters = {
        "snapshot_date": args.snapshot_date,
        "source_release": args.source_release,
        "files": len(paths),
    }
    with pipeline.step(
        run_id, "1_6_load_food_permits", parameters=parameters, repo_root=REPO_ROOT
    ) as step:
        pipeline.delete_run_rows(
            TABLE,
            run_id,
            partition_field="snapshot_date",
            partition_date=args.snapshot_date,
        )
        loaded = pipeline.load_json_rows(TABLE, iter_rows(args, run_id, stats))
        step["row_count"] = loaded
        # 落とした行を必ず残す。列名の揺れ1つで自治体が丸ごと消えるので、
        # 理由別の件数が無いと気づけない。
        step["dropped_reasons"] = dict(stats.most_common())
        LOGGER.info("取り込み %d 行 / 内訳 %s", loaded, dict(stats.most_common()))
        pipeline.append_manifest(
            {
                "run_id": run_id,
                "source": "food_permit",
                "snapshot_date": args.snapshot_date.isoformat(),
                "source_release": args.source_release,
                "source_uri": str(args.manifest) if args.manifest else "各自治体オープンデータ",
                "local_file_name": f"{len(paths)} municipality files",
                "sha256": combined_sha256(paths),
                # 自治体ごとにライセンス表記が違う。個別の表記は manifest に残す。
                "license_id": "各自治体のオープンデータ利用規約",
                "terms_version": args.source_release,
                "attribution_text": "各自治体 食品営業許可施設一覧",
                "row_count": loaded,
                "loaded_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        if args.manifest and args.manifest.exists():
            step["source_manifest"] = json.loads(args.manifest.read_text(encoding="utf-8"))[:200]


if __name__ == "__main__":
    main()
