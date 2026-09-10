"""#1970 `4_4_crawl_official_site_igs.py --stores-run-id` を固定する。

欠陥（1 文）: `4_16_target_near_cells.py` は site_crawl 経路の狙いを runner 上の
`site_crawl_stores.json` にしか書かないため、ジョブが終わると消え、
`4_4 --stores-file` へ渡す手段が実際には無かった。4_16 が新たに書く
`sns_site_crawl_target`（#1970）をここから直接読めるようにする。

固定するのは 3 つ:
1. `--stores-run-id` を渡すと、その run_id の行だけを `--stores-file` と同じ dict 形
   （`[{id, name, website}]`）で crawl 対象にする（`_read_site_crawl_target_stores`）
2. `--stores-file` と `--stores-run-id` の併用はエラー
3. どちらも無ければ従来どおり `restaurant_catalog` を順に crawl する（既定の挙動が壊れていない）

旧実装（`--stores-run-id` が無い版）では、(1) は `_read_site_crawl_target_stores` が
存在せず `AttributeError`、(2) は `--stores-run-id` という引数自体が無く `SystemExit`
（unrecognized arguments）、(3) は変更前と同じ挙動なのでそもそも壊れない。
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

# google.cloud.bigquery の軽量スタブは conftest.py が 1 箇所で用意する

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

_spec = importlib.util.spec_from_file_location(
    "crawl_official_site_igs", HERE / "4_4_crawl_official_site_igs.py")
m = importlib.util.module_from_spec(_spec)
sys.modules["crawl_official_site_igs"] = m
_spec.loader.exec_module(m)


class _FakePipeline:
    """`table()` / `execute()` だけを差し込む。BQ へは一切繋がない。"""

    def __init__(self, rows):
        self._rows = rows
        self.sql = ""
        self.params = None

    def table(self, name: str) -> str:
        return f"proj.ds.{name}"

    def execute(self, sql, params=None):
        self.sql = sql
        self.params = params
        return self._rows


class ReadSiteCrawlTargetStoresTest(unittest.TestCase):
    """`_read_site_crawl_target_stores` は sns_site_crawl_target の行を --stores-file と同じ形にする。"""

    def test_maps_rows_into_stores_file_shape(self) -> None:
        rows = [
            {"google_place_id": "p1", "name": "らーめん花子", "website": "https://a.example"},
            {"google_place_id": "p2", "name": "寿司太郎", "website": "https://b.example"},
        ]
        pipeline = _FakePipeline(rows)
        stores = m._read_site_crawl_target_stores(pipeline, "sns-2026-09-11-nearcell")
        self.assertEqual(stores, [
            {"id": "p1", "name": "らーめん花子", "website": "https://a.example"},
            {"id": "p2", "name": "寿司太郎", "website": "https://b.example"},
        ])

    def test_only_the_given_run_id_is_targeted(self) -> None:
        """指定した run_id だけが対象になる（他 run_id を巻き込まない）ことを SQL/params で確かめる。"""
        pipeline = _FakePipeline([])
        m._read_site_crawl_target_stores(pipeline, "sns-2026-09-11-nearcell")
        self.assertIn("sns_site_crawl_target", pipeline.sql)
        self.assertIn("run_id = @run_id", pipeline.sql)
        self.assertEqual(len(pipeline.params), 1)
        param = pipeline.params[0]
        self.assertEqual(param.name, "run_id")
        self.assertEqual(param.value, "sns-2026-09-11-nearcell")

    def test_empty_result_is_empty_list_not_error(self) -> None:
        pipeline = _FakePipeline([])
        self.assertEqual(m._read_site_crawl_target_stores(pipeline, "no-such-run"), [])


class MutualExclusionTest(unittest.TestCase):
    """`--stores-file` と `--stores-run-id` の併用はエラーで止める。"""

    def test_both_flags_together_is_rejected(self) -> None:
        with self.assertRaises(SystemExit):
            m.parse_args(["--stores-file", "x.json", "--stores-run-id", "sns-2026-09-11-nearcell"])

    def test_stores_file_alone_is_accepted(self) -> None:
        args = m.parse_args(["--stores-file", "x.json"])
        self.assertEqual(args.stores_file, "x.json")
        self.assertIsNone(args.stores_run_id)

    def test_stores_run_id_alone_is_accepted(self) -> None:
        args = m.parse_args(["--stores-run-id", "sns-2026-09-11-nearcell"])
        self.assertEqual(args.stores_run_id, "sns-2026-09-11-nearcell")
        self.assertIsNone(args.stores_file)


class DefaultPathIsUnchangedTest(unittest.TestCase):
    """どちらも無ければ既定の挙動（restaurant_catalog を順に crawl）のままであること。"""

    def test_neither_flag_given_leaves_both_none(self) -> None:
        args = m.parse_args(["--run-id", "sns-2026-09-11"])
        self.assertIsNone(args.stores_file)
        self.assertIsNone(args.stores_run_id)

    def test_main_falls_back_to_catalog_read_when_neither_flag_is_given(self) -> None:
        """main() のソース上、両方 None の分岐（else）が _read_catalog_stores を呼ぶこと。

        main() を丸ごと実行すると crawl まで走ってしまう（ネットワーク・BQ 資格情報が要る）ため、
        分岐構造をソースで確かめる（このリポジトリの既存テスト（例: test_4_2_attempt_ledger.py）
        と同じやり方）。
        """
        source = (HERE / "4_4_crawl_official_site_igs.py").read_text(encoding="utf-8")
        main_body = source.split("def main() -> None:", 1)[1]
        else_branch = main_body.split("else:", 1)[1].split("LOGGER.info(", 1)[0]
        self.assertIn("_read_catalog_stores(", else_branch)
        # if/elif の順序は stores_file → stores_run_id → catalog（既定）
        self.assertIn("if args.stores_file:", main_body)
        self.assertIn("elif args.stores_run_id:", main_body)
        self.assertLess(main_body.index("if args.stores_file:"), main_body.index("elif args.stores_run_id:"))
        self.assertLess(main_body.index("elif args.stores_run_id:"), main_body.index("else:"))


if __name__ == "__main__":
    unittest.main()
