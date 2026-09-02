#!/usr/bin/env python3
"""外部データの取得と 1_x ローダーの実行を、1プロセスで完結させる入口。

GitHub Actions の `db-script-run.yml` は「1回の dispatch で python スクリプトを
1本」実行し、job をまたいでファイルは残らない。1_3〜1_6 は入力ファイル
（Overture parquet / OSM PBF / IFAS CSV / 許可台帳）をローカルパスで受け取る
設計なので、Actions から流すには取得とロードを同じ job の中でやる必要がある。

取得元はすべて PoC で固定したものを使う。

- overture: `0000_open_data_poc/sources.lock.json` の asset（sha256 検証あり）
- osm: geofabrik の japan-latest.osm.pbf（日次更新なので release は取得日で記録）
- ifas: 自治体一覧 JS から 5桁コードを抽出し、1自治体1CSVを取得
- food_permit: `1276_place_id_free_poc/results/permits_manifest.json` の
  580 リソースを再取得し、座標の無い住所は国土地理院で解決してからロード
  （PoC の 13,896 件のジオコーダキャッシュを読み込むので、初回でも
  新規の問い合わせは差分だけになる）

使い方（db-script-run.yml の args にそのまま書ける）:

    1_0_fetch_and_load.py --source overture --run-id restaurant-2026-08-23 \
        --snapshot-date 2026-08-23
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import time
import urllib.request
from collections import Counter
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
POC_LOCK = HERE / "0000_open_data_poc" / "sources.lock.json"
PERMIT_POC = HERE / "1276_place_id_free_poc"
PERMIT_MANIFEST = PERMIT_POC / "results" / "permits_manifest.json"
GEOCODE_SEED_CACHE = PERMIT_POC / "results" / "geocode_cache.csv.gz"
PREFECTURE_MAP = PERMIT_POC / "results" / "municipality_prefecture.json"

OSM_URL = "https://download.geofabrik.de/asia/japan-latest.osm.pbf"
USER_AGENT = (
    "nanitabeyo-restaurant-pipeline/1.0 (+https://github.com/Ayato-kosaka/nanitabeyo)"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        required=True,
        choices=("overture", "osm", "ifas", "food_permit"),
    )
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--snapshot-date", type=date.fromisoformat, required=True)
    parser.add_argument(
        "--work-dir",
        type=Path,
        default=Path("/tmp/restaurant_source_data"),
        help="ダウンロード先。job 終了とともに消えてよいファイルだけを置く",
    )
    parser.add_argument(
        "--geocode-qps",
        type=float,
        default=5.0,
        help="国土地理院ジオコーダへの毎秒リクエスト数（公開APIなので上げない）",
    )
    return parser.parse_args()


def run_step(command: list[str]) -> None:
    print(f"▶ {' '.join(command)}", flush=True)
    subprocess.run(command, check=True, cwd=HERE)


def download(url: str, target: Path, *, expected_sha256: str | None = None) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        started = time.monotonic()
        digest = hashlib.sha256()
        received = 0
        partial = target.with_suffix(target.suffix + ".part")
        with urllib.request.urlopen(request, timeout=120) as response, partial.open(
            "wb"
        ) as stream:
            while chunk := response.read(1 << 22):
                stream.write(chunk)
                digest.update(chunk)
                received += len(chunk)
                if received % (1 << 28) < (1 << 22):
                    print(f"  … {received / 1e6:,.0f}MB", flush=True)
        partial.rename(target)
        print(
            f"  取得完了 {received / 1e6:,.0f}MB ({time.monotonic() - started:,.0f}s)",
            flush=True,
        )
        if expected_sha256 and digest.hexdigest() != expected_sha256:
            target.unlink()
            raise RuntimeError(
                f"checksum不一致: {url} expected={expected_sha256} got={digest.hexdigest()}"
            )
    return target


def fetch_overture(args: argparse.Namespace) -> None:
    lock = json.loads(POC_LOCK.read_text(encoding="utf-8"))["overture"]
    parquet = download(
        lock["asset"],
        args.work_dir / Path(lock["asset"]).name,
        expected_sha256=lock["sha256"],
    )
    run_step(
        [
            sys.executable,
            str(HERE / "1_3_load_overture.py"),
            "--run-id", args.run_id,
            "--snapshot-date", args.snapshot_date.isoformat(),
            "--source-release", lock["release"],
            "--parquet", str(parquet),
            "--source-uri", lock["asset"],
        ]
    )


def fetch_osm(args: argparse.Namespace) -> None:
    # geofabrik は日次更新でchecksumを固定できない。source_release に取得日を
    # 記録し、再現には manifest の sha256（1_5 が記録する）を使う。
    pbf = download(OSM_URL, args.work_dir / "japan-latest.osm.pbf")
    run_step(
        [
            sys.executable,
            str(HERE / "1_5_load_osm.py"),
            "--run-id", args.run_id,
            "--snapshot-date", args.snapshot_date.isoformat(),
            "--source-release", args.snapshot_date.isoformat(),
            "--pbf", str(pbf),
            "--source-uri", OSM_URL,
        ]
    )


def fetch_ifas(args: argparse.Namespace) -> None:
    lock = json.loads(POC_LOCK.read_text(encoding="utf-8"))["ifas"]
    script = download(
        lock["jurisdiction_list_script"], args.work_dir / "ifas_jurisdictions.js"
    ).read_text(encoding="utf-8", errors="replace")
    codes = sorted(set(re.findall(r"_i_n(\d{5})_str", script)))
    if len(codes) != int(lock["jurisdiction_files"]):
        # 参加自治体は増減する。止めずに、記録だけ変える。
        print(
            f"! 自治体数が lock と違う: lock={lock['jurisdiction_files']} 現在={len(codes)}",
            flush=True,
        )
    directory = args.work_dir / "ifas"
    for index, code in enumerate(codes, start=1):
        download(
            lock["download_template"].format(municipality_code=code),
            directory / f"{code}_food_business_all.csv",
        )
        if index % 25 == 0:
            print(f"  {index}/{len(codes)} 自治体", flush=True)
        time.sleep(0.2)
    run_step(
        [
            sys.executable,
            str(HERE / "1_4_load_ifas.py"),
            "--run-id", args.run_id,
            "--snapshot-date", args.snapshot_date.isoformat(),
            "--as-of", args.snapshot_date.isoformat(),
            "--source-release", args.snapshot_date.isoformat(),
            "--directory", str(directory),
            "--source-uri", lock["portal"],
        ]
    )


def fetch_food_permit(args: argparse.Namespace) -> None:
    permits_dir = args.work_dir / "permits"
    manifest_out = args.work_dir / "permits_manifest.json"
    run_step(
        [
            sys.executable,
            str(PERMIT_POC / "fetch_permits.py"),
            "--from-manifest", str(PERMIT_MANIFEST),
            "--output-dir", str(permits_dir),
            "--manifest", str(manifest_out),
        ]
    )

    # 座標の無い行の住所だけをジオコーダへ回す。PoC のキャッシュを先に読み込む
    # ので、既知の 13,896 住所は再問い合わせしない。
    sys.path.insert(0, str(HERE))
    from food_permits import iter_permit_rows, load_prefecture_map

    stats: Counter = Counter()
    addresses = sorted(
        {
            permit.address
            for permit in iter_permit_rows(
                permits_dir,
                prefectures=load_prefecture_map(PREFECTURE_MAP),
                coordinates={},
                stats=stats,
            )
            if permit.latitude is None
        }
    )
    address_file = args.work_dir / "addresses.txt"
    address_file.write_text("\n".join(addresses) + "\n", encoding="utf-8")
    print(f"ジオコーディング対象 {len(addresses):,} 住所 / 内訳 {dict(stats)}", flush=True)

    geocode_cache = args.work_dir / "geocode.sqlite"
    run_step(
        [
            sys.executable,
            str(HERE / "geocode_addresses.py"),
            "--addresses", str(address_file),
            "--cache", str(geocode_cache),
            "--load", str(GEOCODE_SEED_CACHE),
            "--qps", str(args.geocode_qps),
        ]
    )
    run_step(
        [
            sys.executable,
            str(HERE / "1_6_load_food_permits.py"),
            "--run-id", args.run_id,
            "--snapshot-date", args.snapshot_date.isoformat(),
            "--source-release", args.snapshot_date.isoformat(),
            "--directory", str(permits_dir),
            "--prefecture-map", str(PREFECTURE_MAP),
            "--geocode-cache", str(geocode_cache),
            "--manifest", str(manifest_out),
        ]
    )


def main() -> None:
    args = parse_args()
    args.work_dir.mkdir(parents=True, exist_ok=True)
    handler = {
        "overture": fetch_overture,
        "osm": fetch_osm,
        "ifas": fetch_ifas,
        "food_permit": fetch_food_permit,
    }[args.source]
    handler(args)


if __name__ == "__main__":
    main()
