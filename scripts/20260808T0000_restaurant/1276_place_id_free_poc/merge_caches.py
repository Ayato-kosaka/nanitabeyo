#!/usr/bin/env python3
"""複数の probe キャッシュを1つにまとめる。

標本を何度かに分けて取ったので、確定結果は複数の SQLite に散っている。
`export` は1つのキャッシュしか読まないが、place_id の衝突（同じ place_id を
複数の seed が取り合う）は全体を見ないと検出できない。出力前にまとめる。

同じ (seed_id, probe) が複数のキャッシュにある場合は、後から渡したものを優先する。
問い合わせ内容が同じなら結果も同じはずだが、取り直した方が新しいためである。
"""

from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", type=Path, nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()

    if arguments.output.exists():
        raise SystemExit(f"{arguments.output} が既にある。消してから実行する")
    arguments.output.parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(arguments.output)
    first = True
    for index, path in enumerate(arguments.inputs):
        if not path.exists():
            print(f"見つからないので飛ばす: {path}")
            continue
        connection.execute("ATTACH DATABASE ? AS source", (f"file:{path}?mode=ro",))
        if first:
            # 元のスキーマをそのまま複製する。列構成はキャッシュ側の都合で変わりうる。
            schema = connection.execute(
                "SELECT sql FROM source.sqlite_master WHERE type='table' AND name='probe'"
            ).fetchone()
            connection.execute(schema[0])
            first = False
        before = connection.execute("SELECT count(*) FROM probe").fetchone()[0]
        columns = [row[1] for row in connection.execute("PRAGMA source.table_info(probe)")]
        shared = [
            name
            for name in columns
            if name in {row[1] for row in connection.execute("PRAGMA table_info(probe)")}
        ]
        column_list = ", ".join(shared)
        connection.execute(
            f"INSERT OR REPLACE INTO probe ({column_list}) SELECT {column_list} FROM source.probe"
        )
        connection.commit()
        after = connection.execute("SELECT count(*) FROM probe").fetchone()[0]
        print(f"{path.name}: +{after - before} 行（累計 {after}）")
        connection.execute("DETACH DATABASE source")
    total = connection.execute("SELECT count(*) FROM probe").fetchone()[0]
    seeds = connection.execute("SELECT count(DISTINCT seed_id) FROM probe").fetchone()[0]
    connection.close()
    print(f"合計 {total} 行 / seed {seeds} 件 -> {arguments.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
