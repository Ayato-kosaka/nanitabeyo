#!/usr/bin/env python3
"""#1674 catalog に **PostgreSQL のスキーマに依存する識別子を載せない**ことを縛る。

## 何が起きていたか

`restaurant_catalog.existing_restaurant_id` は «1_2 がどのスキーマを読んだか» に
依存する `restaurants.id` の UUID だった。ところが `9_1 --schema` は独立した引数で、
一致を誰も検証していなかったため、**dev で作った catalog を `--schema public` で
流せた**（`COALESCE(s.existing_restaurant_id, gen_random_uuid())` が dev の UUID を
public の主キーとして INSERT できた）。止めるはずの `validate_staging` は
`JOIN restaurants r ON r.id = s.existing_restaurant_id` を経由するので、public に
無い dev の UUID は 0 件ヒット＝**素通り**した。

直し方は «世界に名前を付ける» ではなく **«世界に依存しない成果物にする»** で、
この列を catalog から外した。外れている以上、`--schema` の不一致は原理的に
起こらない（検知する対象そのものが無い）。

## 何を縛るか（«パターン» で縛る）

個別の列名ではなく **「スキーマに依存する識別子が catalog へ出ていないこと」**。

1. `3_4`（catalog を作る側）で `existing_restaurant_id` が出てよいのは
   **JOIN の結合条件とコメントだけ**。SELECT の射影に現れたら落とす
2. `9_1`（catalog を読む側）の staging に `existing_restaurant_id` 列が無いこと。
   列が無ければ SQL からも読めない

⚠️ テスト（`tests/test_9_1_overwrite_guard.sh`）の器はこの列を**意図的に持っている**
（旧ガードで事故を再現する負の対照）。だからここは **本番のスクリプトだけ**を見る。

ソースを読むだけなので BigQuery も PostgreSQL も要らない。
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUILDER = HERE / "3_4_build_restaurant_catalog.py"
SYNCER = HERE / "9_1_sync_restaurants.py"

COLUMN = "existing_restaurant_id"

# JOIN の結合条件として書かれている行。`ON x = y` / `AND x = y` のどちらか。
JOIN_CONDITION = re.compile(r"^\s*(?:ON|AND)\s+\S+\s*=\s*\S+\s*$")
# コメント行（SQL の `--` と Python の `#`）
COMMENT = re.compile(r"^\s*(?:--|#)")


class CatalogSchemaIndependenceTest(unittest.TestCase):
    def test_builder_mentions_the_column_only_in_joins_and_comments(self) -> None:
        offenders: list[tuple[int, str]] = []
        seen_join = False
        for number, line in enumerate(
            BUILDER.read_text(encoding="utf-8").splitlines(), start=1
        ):
            if COLUMN not in line:
                continue
            if COMMENT.match(line):
                continue
            if JOIN_CONDITION.match(line):
                seen_join = True
                continue
            offenders.append((number, line.strip()))

        self.assertEqual(
            offenders,
            [],
            "catalog を作る側が existing_restaurant_id を射影しています"
            f"（スキーマ依存の UUID が catalog へ漏れます）: {offenders}",
        )
        # ⚠️ 探し方が壊れていないことの自己確認。この列は JOIN 条件には **残っている**
        #    （既存 PG 行の照合に使う）。1 件も見つからないなら、このテストは
        #    «何も読めていないのに緑» になっている。
        self.assertTrue(
            seen_join,
            f"{COLUMN} が JOIN 条件として 1 度も見つかりません"
            "（このテストの探し方が壊れています）",
        )

    def test_staging_has_no_schema_dependent_id_column(self) -> None:
        source = SYNCER.read_text(encoding="utf-8")
        ddl = re.search(
            r"CREATE TEMP TABLE restaurant_sync_staging \((.*?)\)\s*ON COMMIT DROP",
            source,
            re.S,
        )
        self.assertIsNotNone(ddl, "staging の DDL が見つかりません（探し方が壊れています）")
        self.assertNotIn(
            COLUMN,
            ddl.group(1),  # type: ignore[union-attr]
            "staging に existing_restaurant_id 列が復活しています"
            "（dev の UUID を public の主キーにできる形）",
        )

    def test_syncer_does_not_read_the_column(self) -> None:
        offenders = [
            (number, line.strip())
            for number, line in enumerate(
                SYNCER.read_text(encoding="utf-8").splitlines(), start=1
            )
            if COLUMN in line and not COMMENT.match(line)
        ]
        self.assertEqual(
            offenders,
            [],
            f"9_1 が {COLUMN} を読んでいます（catalog はこの列を持ちません）: {offenders}",
        )


if __name__ == "__main__":
    unittest.main()
