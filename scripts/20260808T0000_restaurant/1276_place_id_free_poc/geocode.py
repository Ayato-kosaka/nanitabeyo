#!/usr/bin/env python3
"""住所文字列を座標に変換する。国土地理院の住所検索APIを使う。

許可台帳（`fetch_permits.py`）には住所しか入っていない。この PoC の判定は
「店名 + 座標矩形」で成り立っているので、座標が無いと1行も名寄せできない。

国土地理院の `address-search` は番地まで解決してくれる（実測:
「鹿児島県鹿児島市千日町15番15号」→ 31.590157, 130.555893）。無料で、
Google のSKUとは無関係なので、この PoC の「絶対に課金しない」制約も壊さない。

公開APIなので、間隔を空けて叩き、結果は必ずキャッシュする。同じ住所を
二度問い合わせない。番地まで当たらない住所は、末尾を削って粗く当て直し、
どの粒度で当たったかを記録する（粗い座標を「番地レベル」と誤認しないため）。
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent

ENDPOINT = "https://msearch.gsi.go.jp/address-search/AddressSearch?q="
USER_AGENT = "nanitabeyo-open-data-poc/1.0 (+https://github.com/Ayato-kosaka/nanitabeyo)"

SCHEMA = """
CREATE TABLE IF NOT EXISTS geocode (
  address   TEXT PRIMARY KEY,
  latitude  REAL,
  longitude REAL,
  matched   TEXT NOT NULL DEFAULT '',
  level     TEXT NOT NULL DEFAULT ''
);
"""

# 末尾から順に落として粗くしていく。落とした段階を level として残す。
TRIM_PATTERNS = (
    ("floor", re.compile(r"\s*(?:[Bb]?[0-9０-９]+\s*(?:階|[FfＦ])|地下[0-9０-９]*階).*$")),
    ("building", re.compile(r"[\s　][^\s　]*(ビル|マンション|ハイツ|プラザ|センター|会館).*$")),
    ("banchi", re.compile(r"(?<=[0-9０-９])\s*号.*$")),
)


class GeocodeCache:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        # 複数プロセスで同じキャッシュへ書くので、ロック待ちを許す。
        # timeout を付けないと "database is locked" で落ちる（実際に落ちた）。
        self._connection = sqlite3.connect(str(path), check_same_thread=False, timeout=60.0)
        self._connection.execute("PRAGMA journal_mode=WAL")
        self._connection.executescript(SCHEMA)
        self._connection.commit()
        self._lock = threading.Lock()

    def known(self) -> set[str]:
        with self._lock:
            return {row[0] for row in self._connection.execute("SELECT address FROM geocode")}

    def put(self, address: str, latitude, longitude, matched: str, level: str) -> None:
        with self._lock:
            self._connection.execute(
                "INSERT OR REPLACE INTO geocode VALUES (?, ?, ?, ?, ?)",
                (address, latitude, longitude, matched, level),
            )

    def flush(self) -> None:
        with self._lock:
            self._connection.commit()


def variants(address: str) -> list[tuple[str, str]]:
    """粗くしていく段階の一覧。(level, 住所) を細かい順に返す。"""

    out = [("full", address)]
    text = address
    for level, pattern in TRIM_PATTERNS:
        trimmed = pattern.sub("", text).strip()
        if trimmed and trimmed != text:
            out.append((level, trimmed))
            text = trimmed
    return out


def lookup(address: str, *, timeout: float = 20.0) -> tuple[float, float, str] | None:
    request = urllib.request.Request(
        ENDPOINT + urllib.parse.quote(address), headers={"User-Agent": USER_AGENT}
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not payload:
        return None
    best = payload[0]
    longitude, latitude = best["geometry"]["coordinates"]
    return latitude, longitude, best["properties"].get("title", "")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--addresses", type=Path, required=True, help="1行1住所")
    parser.add_argument("--cache", type=Path, default=ROOT / "cache" / "geocode.sqlite")
    parser.add_argument("--qps", type=float, default=5.0)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--load", type=Path,
                        help="results/geocode_cache.csv.gz を読み込んでから始める")
    arguments = parser.parse_args()

    cache = GeocodeCache(arguments.cache)
    if arguments.load and arguments.load.exists():
        import csv
        import gzip

        with gzip.open(arguments.load, "rt", encoding="utf-8", newline="") as handle:
            loaded = 0
            for row in csv.DictReader(handle):
                cache.put(
                    row["address"],
                    float(row["latitude"]) if row["latitude"] else None,
                    float(row["longitude"]) if row["longitude"] else None,
                    "",
                    row["level"],
                )
                loaded += 1
        cache.flush()
        print(f"キャッシュを {loaded:,} 件読み込んだ", flush=True)
    done = cache.known()
    addresses = [
        line.strip()
        for line in arguments.addresses.read_text(encoding="utf-8").splitlines()
        if line.strip() and line.strip() not in done
    ]
    if arguments.limit:
        addresses = addresses[: arguments.limit]
    print(f"未取得の住所 {len(addresses):,} 件（キャッシュ済み {len(done):,}）", flush=True)

    interval = 1.0 / arguments.qps if arguments.qps > 0 else 0.0
    lock = threading.Lock()
    state = {"done": 0, "hit": 0, "miss": 0, "next_at": time.monotonic()}

    def work(address: str) -> None:
        result = None
        level = ""
        for candidate_level, candidate in variants(address):
            with lock:
                now = time.monotonic()
                start = max(now, state["next_at"])
                state["next_at"] = start + interval
            time.sleep(max(0.0, start - time.monotonic()))
            try:
                result = lookup(candidate)
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError):
                result = None
            if result:
                level = candidate_level
                break
        with lock:
            state["done"] += 1
            if result:
                state["hit"] += 1
                cache.put(address, result[0], result[1], result[2], level)
            else:
                state["miss"] += 1
                cache.put(address, None, None, "", "none")
            if state["done"] % 200 == 0:
                print(f"  {state['done']:,}/{len(addresses):,} 命中 {state['hit']:,}", flush=True)
                cache.flush()

    with ThreadPoolExecutor(max_workers=arguments.workers) as pool:
        list(pool.map(work, addresses))
    cache.flush()
    print(json.dumps({"requested": len(addresses), "hit": state["hit"], "miss": state["miss"]},
                     ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
