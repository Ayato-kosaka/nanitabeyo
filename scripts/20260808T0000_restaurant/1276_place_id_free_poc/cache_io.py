#!/usr/bin/env python3
"""probe キャッシュを、リポジトリに置ける形で出し入れする。

キャッシュを持ち出せるようにしておく理由は2つある。

1. Text Search には1日 75,000 リクエストの上限がある。取り直しには日数がかかるので、
   一度取った結果は捨てたくない。
2. 実行環境は使い捨てで、`cache/` は .gitignore に入っている。手元の SQLite が
   消えると、判定ルールを変えたときの再評価すらできなくなる。

保存するのは place_id と HTTP status だけで、Google 由来の店名・住所・座標は
一切含まない（そもそも取得していない）。gzip 圧縮した CSV で 46,013 行 2.0MB。
"""

from __future__ import annotations

import argparse
import csv
import gzip
import sqlite3
import sys
from pathlib import Path

csv.field_size_limit(min(sys.maxsize, 2**31 - 1))

COLUMNS = ("seed_id", "probe", "fingerprint", "status", "ids", "error")


def dump(cache: Path, output: Path) -> int:
    connection = sqlite3.connect(f"file:{cache}?mode=ro", uri=True)
    available = [row[1] for row in connection.execute("PRAGMA table_info(probe)")]
    columns = [name for name in COLUMNS if name in available]
    output.parent.mkdir(parents=True, exist_ok=True)
    rows = 0
    with gzip.open(output, "wt", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(columns)
        for row in connection.execute(f"SELECT {', '.join(columns)} FROM probe"):
            writer.writerow(row)
            rows += 1
    connection.close()
    return rows


def load(archive: Path, cache: Path) -> int:
    cache.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(cache)
    connection.execute(
        """CREATE TABLE IF NOT EXISTS probe (
            seed_id TEXT NOT NULL,
            probe TEXT NOT NULL,
            fingerprint TEXT,
            status INTEGER,
            ids TEXT NOT NULL,
            error TEXT,
            PRIMARY KEY (seed_id, probe)
        )"""
    )
    rows = 0
    with gzip.open(archive, "rt", encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream)
        columns = reader.fieldnames or []
        placeholders = ", ".join("?" for _ in columns)
        statement = (
            f"INSERT OR REPLACE INTO probe ({', '.join(columns)}) VALUES ({placeholders})"
        )
        batch = []
        for record in reader:
            batch.append(tuple(record[name] for name in columns))
            if len(batch) >= 5000:
                connection.executemany(statement, batch)
                rows += len(batch)
                batch.clear()
        if batch:
            connection.executemany(statement, batch)
            rows += len(batch)
    connection.commit()
    connection.close()
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    out = sub.add_parser("dump", help="SQLite から gzip CSV へ")
    out.add_argument("--cache", type=Path, required=True)
    out.add_argument("--output", type=Path, required=True)
    into = sub.add_parser("load", help="gzip CSV から SQLite へ")
    into.add_argument("--archive", type=Path, required=True)
    into.add_argument("--cache", type=Path, required=True)
    arguments = parser.parse_args()

    if arguments.command == "dump":
        rows = dump(arguments.cache, arguments.output)
        size = arguments.output.stat().st_size
        print(f"{rows} 行 -> {arguments.output} ({size / 1_048_576:.1f}MB)")
    else:
        rows = load(arguments.archive, arguments.cache)
        print(f"{rows} 行 -> {arguments.cache}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
