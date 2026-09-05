"""#1273 9_2 の «PG に繋がずに固定できる» 約束事。

SQL 本体の検証は実 PostgreSQL を立てる tests/test_9_2_sns_dish_media_sync.sh が持つ。
ここで固定するのはその手前の 3 つ、事故になったら取り返しがつかない側である。

  1. dev 以外へは絶対に書かない
  2. 既定は dry-run（--execute を明示しない限り書かない）
  3. 1 投稿 1 行に畳んで読む（同じ投稿を複数の dish_media にしない）
  4. #1815 店の国の突き合わせ先（restaurant_catalog の run_id）を省略できない
"""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "sync_sns_dish_media",
    Path(__file__).resolve().parent / "9_2_sync_sns_dish_media.py",
)
sync = importlib.util.module_from_spec(_SPEC)
assert _SPEC.loader is not None
_SPEC.loader.exec_module(sync)


# #1815 --restaurant-catalog-run-id は必須。省略できないことは下の
# ForeignStoreGateTest が固定するので、他の test は毎回これを付けて呼ぶ。
_RC = ["--restaurant-catalog-run-id", "restaurant-2026-08-23"]


def _args(extra: list[str] | None = None):
    return sync.parse_args(_RC + (extra or []))


class SchemaGuardTest(unittest.TestCase):
    def test_public_is_rejected_by_argparse(self) -> None:
        # argparse の choices で弾く（SystemExit）
        with self.assertRaises(SystemExit):
            sync.parse_args(_RC + ["--schema", "public"])

    def test_public_is_rejected_by_assertion(self) -> None:
        # choices を外されても、結果そのものを止める二段目
        with self.assertRaises(ValueError):
            sync.assert_dev_schema("public")
        sync.assert_dev_schema("dev")  # dev は通る

    def test_default_schema_is_dev(self) -> None:
        self.assertEqual("dev", _args().schema)


class DryRunDefaultTest(unittest.TestCase):
    def test_dry_run_is_the_default(self) -> None:
        self.assertTrue(sync.resolve_dry_run(_args()))

    def test_execute_turns_writing_on(self) -> None:
        self.assertFalse(sync.resolve_dry_run(_args(["--execute"])))

    def test_execute_and_dry_run_together_is_an_error(self) -> None:
        with self.assertRaises(ValueError):
            sync.resolve_dry_run(_args(["--execute", "--dry-run"]))


class CatalogRunIdTest(unittest.TestCase):
    def test_defaults_to_the_sync_run_id(self) -> None:
        self.assertEqual(
            ["sns-2026-09-04"],
            sync.parse_catalog_run_ids(_args(), "sns-2026-09-04"),
        )

    def test_comma_separated_ids(self) -> None:
        args = _args(["--catalog-run-id", "a, b ,c"])
        self.assertEqual(["a", "b", "c"], sync.parse_catalog_run_ids(args, "x"))

    def test_all_runs_is_none(self) -> None:
        args = _args(["--all-catalog-runs"])
        self.assertIsNone(sync.parse_catalog_run_ids(args, "x"))

    def test_all_runs_and_explicit_ids_conflict(self) -> None:
        args = _args(["--all-catalog-runs", "--catalog-run-id", "a"])
        with self.assertRaises(ValueError):
            sync.parse_catalog_run_ids(args, "x")


class ForeignStoreGateTest(unittest.TestCase):
    """#1815 日本以外の店を PG へ渡さない。

    126 店 / dish_media 1,025 行が dev へ入った事故は、この経路に国の判定が
    **1 つも無かった**ために起きた。突き合わせ先を «省略できる» ようにすると、
    引数を書き忘れた 1 回で同じことが起きる。
    """

    def test_restaurant_catalog_run_id_is_required(self) -> None:
        with self.assertRaises(SystemExit):
            sync.parse_args([])

    def test_query_drops_foreign_stores(self) -> None:
        sql = sync.catalog_query(_FakePipeline(), ["r1"])
        self.assertIn("proj.ds.restaurant_catalog", sql)
        self.assertIn("NOT IFNULL(", sql)

    def test_judgement_is_not_transcribed(self) -> None:
        # 判定は common_sns が唯一の正。9_2 が自前で持っていたら写経である
        source = (Path(__file__).resolve().parent / "9_2_sync_sns_dish_media.py").read_text(
            encoding="utf-8"
        )
        self.assertIn("foreign_store_sql", source)
        self.assertNotIn("가-힣", source)


class _FakePipeline:
    """BigQueryPipeline のうち SQL 生成が使う部分だけ。認証しない。"""

    def table(self, name: str) -> str:
        return f"proj.ds.{name}"


class CatalogQueryTest(unittest.TestCase):
    def test_collapses_to_one_row_per_post(self) -> None:
        sql = sync.catalog_query(_FakePipeline(), ["r1"])
        # 1 投稿 1 dish_media は build_dish_media_id の制約。ここが崩れると
        # 同じ投稿で dish_media の PK が衝突する
        self.assertIn("PARTITION BY provider, external_content_id", sql)
        self.assertIn("WHERE rn = 1", sql)
        # 同着で結果が揺れない（冪等）
        self.assertIn("ORDER BY built_at DESC", sql)

    def test_run_filter_is_parameterised(self) -> None:
        self.assertIn("run_id IN UNNEST(@run_ids)", sync.catalog_query(_FakePipeline(), ["r1"]))
        self.assertNotIn("run_id IN UNNEST", sync.catalog_query(_FakePipeline(), None))

    def test_parameters_match_the_query(self) -> None:
        names = {p.name for p in sync.query_parameters(["r1"], "rc1")}
        self.assertEqual({"providers", "run_ids", "restaurant_catalog_run_id"}, names)
        self.assertEqual(
            {"providers", "restaurant_catalog_run_id"},
            {p.name for p in sync.query_parameters(None, "rc1")},
        )

    def test_providers_match_the_db_check(self) -> None:
        # dmee_provider_check（20260824T0200）と同じ値域。狭めると PG が受け取れる行を手前で捨てる
        self.assertEqual(
            ("instagram", "tiktok", "youtube", "x"), sync.ALLOWED_PROVIDERS
        )


if __name__ == "__main__":
    unittest.main()
