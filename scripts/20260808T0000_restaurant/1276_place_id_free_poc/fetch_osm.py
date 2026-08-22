#!/usr/bin/env python3
"""OpenStreetMap から日本の飲食店 POI を取り出して seed CSV にする。

`0000_open_data_poc` の OSM 実装は taginfo でタグ件数を数えるだけで、実データを
取得していなかった。ここでは Overpass から実際の POI を取り、Overture と同じ
seed スキーマへ落とす。

日本全体を一度に問い合わせると Overpass が落ちるので、緯度経度でタイルに割って
順に取得する。タイルごとに生JSONを保存し、途中で失敗しても再開できるようにする。
OSM は ODbL なので、成果物の扱いは Overture (CDLA-Permissive) と分けて考える必要が
ある点に注意する。
"""

from __future__ import annotations

import argparse
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Iterator

ROOT = Path(__file__).resolve().parent
DEFAULT_ENDPOINT = "https://overpass.kumi.systems/api/interpreter"
# 0000_open_data_poc が「コア8業態」と呼んでいるものに揃える。
CORE_AMENITIES = (
    "restaurant", "cafe", "fast_food", "bar", "pub", "food_court", "ice_cream", "biergarten",
)
# 日本の緯度経度の範囲。南西諸島から北海道まで。
JAPAN_BOUNDS = (24.0, 122.0, 46.0, 146.5)


def tiles(step: float) -> Iterator[tuple[float, float, float, float]]:
    south, west, north, east = JAPAN_BOUNDS
    latitude = south
    while latitude < north:
        longitude = west
        while longitude < east:
            yield (latitude, longitude, min(latitude + step, north), min(longitude + step, east))
            longitude += step
        latitude += step


# パン屋・菓子店・惣菜店は amenity ではなく shop 側に付く。Google Maps には
# これらも店として載るので、seed に入れないと取りこぼす。
FOOD_SHOPS = (
    "bakery", "confectionery", "pastry", "deli", "chocolate", "ice_cream",
    "coffee", "tea", "beverages", "alcohol", "seafood", "butcher", "greengrocer",
)


def build_query(
    bbox: tuple[float, float, float, float],
    timeout_seconds: int,
    *,
    include_shops: bool = False,
) -> str:
    south, west, north, east = bbox
    amenity = "|".join(CORE_AMENITIES)
    clauses = [f'nwr["amenity"~"^({amenity})$"]({south},{west},{north},{east});']
    if include_shops:
        shop = "|".join(FOOD_SHOPS)
        clauses.append(f'nwr["shop"~"^({shop})$"]({south},{west},{north},{east});')
    return (
        f"[out:json][timeout:{timeout_seconds}];"
        f"({''.join(clauses)});"
        "out center tags;"
    )


def fetch_tile(endpoint: str, query: str, *, retries: int = 3, timeout: int = 300) -> dict[str, Any]:
    payload = urllib.parse.urlencode({"data": query}).encode("utf-8")
    for attempt in range(retries + 1):
        try:
            request = urllib.request.Request(
                endpoint,
                data=payload,
                headers={
                    # Overpass は連絡先の分かる User-Agent を求めている。
                    "User-Agent": "nanitabeyo-place-id-poc/1.0 (+https://github.com/Ayato-kosaka/nanitabeyo)",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            )
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
            if attempt >= retries:
                raise
            # Overpass は混雑時に 429/504 を返す。指数的に待って譲る。
            time.sleep(min(2**attempt * 10, 120))
    raise AssertionError("unreachable")


def cache_name(bbox: tuple[float, float, float, float], step: float) -> str:
    # step 1.0 の名前は先に取得した4タイルと互換にしておく（取り直しを避ける）。
    if abs(step - 1.0) < 1e-9:
        return f"{bbox[0]:.1f}_{bbox[1]:.1f}.json"
    return f"{bbox[0]:.4f}_{bbox[1]:.4f}_{step:.4f}.json"


def split(bbox: tuple[float, float, float, float]) -> list[tuple[float, float, float, float]]:
    south, west, north, east = bbox
    mid_lat, mid_lon = (south + north) / 2, (west + east) / 2
    return [
        (south, west, mid_lat, mid_lon),
        (south, mid_lon, mid_lat, east),
        (mid_lat, west, north, mid_lon),
        (mid_lat, mid_lon, north, east),
    ]


class Collector:
    """タイルを取り、重すぎて落ちるものは4分割して取り直す。

    Overpass は広い矩形で件数が多いと timeout / 504 を返す。件数が読めない以上、
    事前にタイル幅を決め打ちできないので、落ちたものだけ細かくする。
    """

    def __init__(self, endpoint: str, cache_dir: Path, *, query_timeout: int, pause: float,
                 max_depth: int, include_shops: bool = False):
        self._endpoint = endpoint
        self._cache_dir = cache_dir
        self._query_timeout = query_timeout
        self._pause = pause
        self._max_depth = max_depth
        self._include_shops = include_shops
        self._lock = threading.Lock()
        self.rows: dict[str, dict[str, str]] = {}
        self.done = 0
        self.failed: list[tuple[float, float, float, float]] = []

    def _absorb(self, document: dict[str, Any], label: str) -> None:
        elements = document.get("elements", [])
        with self._lock:
            for element in elements:
                row = element_to_row(element)
                if row:
                    self.rows[row["source_id"]] = row
            self.done += 1
            print(f"[{self.done}] {label} elements={len(elements)} total={len(self.rows)}", flush=True)

    def collect(self, bbox: tuple[float, float, float, float], step: float, depth: int = 0) -> None:
        cache_path = self._cache_dir / cache_name(bbox, step)
        if cache_path.exists():
            try:
                self._absorb(json.loads(cache_path.read_text(encoding="utf-8")), cache_path.name)
                return
            except json.JSONDecodeError:
                cache_path.unlink()
        try:
            document = fetch_tile(
                self._endpoint,
                build_query(bbox, self._query_timeout, include_shops=self._include_shops),
                timeout=self._query_timeout + 120,
            )
        except Exception as error:  # noqa: BLE001 - 分割して取り直すため型を問わない
            if depth >= self._max_depth:
                with self._lock:
                    self.failed.append(bbox)
                print(f"!! 取得失敗 {bbox} depth={depth}: {error}", flush=True)
                return
            print(f"-- 分割 {bbox} depth={depth}: {error}", flush=True)
            for child in split(bbox):
                self.collect(child, step / 2, depth + 1)
            return
        cache_path.write_text(json.dumps(document), encoding="utf-8")
        time.sleep(self._pause)
        self._absorb(document, cache_path.name)


def element_to_row(element: dict[str, Any]) -> dict[str, str] | None:
    tags = element.get("tags") or {}
    name = tags.get("name") or tags.get("name:ja")
    if not name:
        return None
    if element.get("type") == "node":
        latitude, longitude = element.get("lat"), element.get("lon")
    else:
        center = element.get("center") or {}
        latitude, longitude = center.get("lat"), center.get("lon")
    if latitude is None or longitude is None:
        return None
    # OSM の住所はタグに分かれている。Overture の freeform 相当へ組み直す。
    parts = [
        tags.get("addr:province") or tags.get("addr:state") or "",
        tags.get("addr:city") or "",
        tags.get("addr:suburb") or "",
        tags.get("addr:neighbourhood") or "",
        tags.get("addr:quarter") or "",
        tags.get("addr:block_number") or "",
        tags.get("addr:housenumber") or "",
    ]
    return {
        "source_id": f"osm:{element.get('type')}/{element.get('id')}",
        "name": name,
        "freeform": "".join(part for part in parts if part),
        "postcode": tags.get("addr:postcode") or "",
        "locality": tags.get("addr:city") or "",
        "latitude": f"{float(latitude):.7f}",
        "longitude": f"{float(longitude):.7f}",
        "category": tags.get("amenity") or tags.get("shop") or "",
        "website": tags.get("website") or tags.get("contact:website") or "",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--cache-dir", type=Path, default=ROOT / "data" / "osm")
    parser.add_argument("--output", type=Path, default=ROOT / "data" / "osm_places.csv")
    parser.add_argument("--step", type=float, default=1.0, help="タイルの一辺（度）")
    parser.add_argument("--pause-seconds", type=float, default=1.0)
    parser.add_argument("--query-timeout", type=int, default=180)
    parser.add_argument("--workers", type=int, default=4, help="Overpass への同時接続数")
    parser.add_argument("--max-depth", type=int, default=3, help="重いタイルを分割する深さの上限")
    parser.add_argument(
        "--include-shops",
        action="store_true",
        help="パン屋・菓子店など shop 側の業態も取る",
    )
    parser.add_argument(
        "--occupied-cells",
        type=Path,
        help="他ソースに1件でも店がある1度セルの一覧。海のタイルを問い合わせないために使う",
    )
    arguments = parser.parse_args()

    arguments.cache_dir.mkdir(parents=True, exist_ok=True)
    boxes = list(tiles(arguments.step))
    if arguments.occupied_cells and arguments.occupied_cells.exists():
        # 日本の陸地は緯度経度の矩形に収まらない。海のタイルを1つずつ Overpass に
        # 聞くと待ち時間ばかり増えるので、他ソースに店が1件もない1度セルは飛ばす。
        # 110km 四方に飲食店が1軒も無いセルは事実上すべて海である。
        occupied = set(json.loads(arguments.occupied_cells.read_text(encoding="utf-8")))
        before = len(boxes)
        boxes = [
            bbox for bbox in boxes
            if f"{int(bbox[0] // 1)}_{int(bbox[1] // 1)}" in occupied
        ]
        print(f"海のタイルを除外: {before} -> {len(boxes)}", flush=True)
    print(f"タイル数: {len(boxes)} 並列: {arguments.workers}", flush=True)

    collector = Collector(
        arguments.endpoint,
        arguments.cache_dir,
        query_timeout=arguments.query_timeout,
        pause=arguments.pause_seconds,
        max_depth=arguments.max_depth,
        include_shops=arguments.include_shops,
    )
    with ThreadPoolExecutor(max_workers=arguments.workers) as pool:
        list(pool.map(lambda bbox: collector.collect(bbox, arguments.step), boxes))
    rows = collector.rows
    if collector.failed:
        print(f"!! 取得できなかったタイル: {len(collector.failed)}", flush=True)

    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    import csv as csv_module

    with arguments.output.open("w", encoding="utf-8", newline="") as stream:
        writer = csv_module.DictWriter(
            stream,
            fieldnames=[
                "source_id", "name", "freeform", "postcode", "locality",
                "latitude", "longitude", "category", "website",
            ],
        )
        writer.writeheader()
        for row in sorted(rows.values(), key=lambda item: item["source_id"]):
            writer.writerow(row)
    print(
        json.dumps(
            {
                "osm_rows": len(rows),
                "failed_tiles": [list(bbox) for bbox in collector.failed],
                "output": str(arguments.output),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
