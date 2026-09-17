#!/usr/bin/env python3
"""#1881 «配信する値» の作り方が 1 箇所にしか無いことを固定する。

## なぜこのテストが要るか

2026-09-09、`3_4`（値を作る側）と `8_1`（値を確かめる側）が **別の規則で同じ列を
扱っていた**ため、品質ゲートが構造的に必ず落ちる状態になっていた。

    3_4: COALESCE(existing.image_url, s.image_url, '')      … NULL を '' へ正規化して入れる
    8_1: catalog.image_url IS DISTINCT FROM existing.image_url … 正規化前と完全一致を求める

`existing` が NULL の列は catalog が必ず `''` になるので、**app 作成店 2,469 行の
全部が必ず不一致**になった（[run 34347785203](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/34347785203) で列ごとに実測）。
データは壊れておらず、**ゲートの側が間違っていた**。

これは CLAUDE.md「本番のロジックをテストへ写経しない」と同じ形で、写経先が
«テスト» ではなく «品質ゲート» だった。**同じ判定を 2 箇所に書いた時点で、
ずれるのは時間の問題だった。**

そこで «写経が復活したら赤くなる» 形で縛る。

実行:
    python3 -m unittest scripts/20260808T0000_restaurant/test_catalog_publish_values.py
"""

from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from catalog_publish_values import (  # noqa: E402
    COMPARED_COLUMNS,
    preserved_mismatch_sql,
    publish_value_sql,
)

BUILDER = HERE / "3_4_build_restaurant_catalog.py"
VALIDATOR = HERE / "8_1_validate_catalogs.py"


class SingleSourceTest(unittest.TestCase):
    def test_builder_and_validator_both_import_the_source(self) -> None:
        for path in (BUILDER, VALIDATOR):
            source = path.read_text(encoding="utf-8")
            self.assertIn(
                "catalog_publish_values",
                source,
                f"{path.name} が «配信する値» の正本を使っていない",
            )

    def test_neither_side_hand_writes_the_coalesce(self) -> None:
        """⚠️ 写経が復活したら赤くする（これが今回の欠陥そのもの）。"""
        for path in (BUILDER, VALIDATOR):
            body = "\n".join(
                line
                for line in path.read_text(encoding="utf-8").splitlines()
                if not line.lstrip().startswith("#") and not line.lstrip().startswith("--")
            )
            for column in ("image_url", "address_components_json"):
                self.assertNotRegex(
                    body,
                    rf"COALESCE\(\s*(NULLIF\(\s*)?\w+\.{column}",
                    f"{path.name} が {column} の作り方を自分で書いている。"
                    f" catalog_publish_values を呼ぶこと",
                )


class NormalisationTest(unittest.TestCase):
    """⚠️ «両側が同じ式» であることを、式そのもので確かめる。"""

    def test_gate_compares_against_the_normalised_value(self) -> None:
        condition = preserved_mismatch_sql(
            catalog="catalog", existing="existing", seed="seed"
        )
        for column in COMPARED_COLUMNS:
            expected = publish_value_sql(column, existing="existing", seed="seed")
            self.assertIn(
                f"catalog.{column} IS DISTINCT FROM {expected}",
                condition,
                f"{column} を正規化前と比べている（構造的に必ず落ちる形）",
            )

    def test_null_columns_do_not_mismatch_by_construction(self) -> None:
        """existing が NULL の列で «必ず不一致» にならないこと。

        `image_url` は `COALESCE(..., '')` で必ず非 NULL になるので、右辺も同じ
        COALESCE を通っていなければ NULL vs '' で必ず食い違う。
        """
        for column in ("image_url", "address_components_json"):
            expr = publish_value_sql(column, existing="existing", seed="seed")
            self.assertTrue(
                expr.startswith("COALESCE("),
                f"{column} は既定値へ寄せる列である",
            )
            self.assertRegex(
                expr, r"'(\[\])?'\s*\)$", f"{column} の既定値が式の末尾に無い"
            )

    def test_every_compared_column_has_a_recipe(self) -> None:
        for column in COMPARED_COLUMNS:
            self.assertTrue(publish_value_sql(column, existing="e", seed="s"))

    def test_unknown_column_is_rejected(self) -> None:
        with self.assertRaises(KeyError):
            publish_value_sql("country_code", existing="e", seed="s")


if __name__ == "__main__":
    unittest.main()
