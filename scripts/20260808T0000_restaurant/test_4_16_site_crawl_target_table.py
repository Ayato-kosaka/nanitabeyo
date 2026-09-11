"""#1970 4_16 の site_crawl 経路を BigQuery（sns_site_crawl_target）へも書くことを固定する。

欠陥（1 文）: `4_16_target_near_cells.py` は site_crawl 経路の狙いを runner 上の
`site_crawl_stores.json` にしか書かないため、ジョブが終わると消え、
`4_4_crawl_official_site_igs.py --stores-file` へ渡す手段が実際には無かった
（account / site_embed の 2 経路は BigQuery の表へ書いているのに、この経路だけファイル）。

固定するのは 2 つ:
1. `build_site_crawl_target_rows`（純関数）が `sns_site_crawl_target` の行形（
   run_id / google_place_id / name / website / created_at）を正しく作ること
2. `--dry-run` では `sns_site_crawl_target` へ 1 行も書かない
   （BigQuery への書き込みは `if args.dry_run: return` より後にしか無いこと）

旧実装（この変更前）では `build_site_crawl_target_rows` も `TABLE_SITE_CRAWL_TARGET` も
存在しないため、(1) は `AttributeError`、(2) は「ソース中に `sns_site_crawl_target` への
書き込みが存在しない」ため恒真（＝退行の検出力が無い）ことをテスト自身が確かめる。
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
    "target_near_cells", HERE / "4_16_target_near_cells.py")
m = importlib.util.module_from_spec(_spec)
sys.modules["target_near_cells"] = m
_spec.loader.exec_module(m)


class BuildSiteCrawlTargetRowsTest(unittest.TestCase):
    def test_converts_site_crawl_stores_into_bq_row_shape(self) -> None:
        site_crawl = [
            {"google_place_id": "p1", "name": "らーめん花子", "website": "https://a.example"},
            {"google_place_id": "p2", "name": "寿司太郎", "website": "https://b.example"},
        ]
        rows = m.build_site_crawl_target_rows(site_crawl, "sns-2026-09-11-nearcell", "2026-09-11T00:00:00+00:00")
        self.assertEqual(rows, [
            {"run_id": "sns-2026-09-11-nearcell", "google_place_id": "p1", "name": "らーめん花子",
             "website": "https://a.example", "created_at": "2026-09-11T00:00:00+00:00"},
            {"run_id": "sns-2026-09-11-nearcell", "google_place_id": "p2", "name": "寿司太郎",
             "website": "https://b.example", "created_at": "2026-09-11T00:00:00+00:00"},
        ])

    def test_empty_input_is_empty_output(self) -> None:
        self.assertEqual(m.build_site_crawl_target_rows([], "run-1", "2026-09-11T00:00:00+00:00"), [])


class TableConstantTest(unittest.TestCase):
    def test_table_name_is_imported_from_common_sns(self) -> None:
        import common_sns
        self.assertEqual(common_sns.TABLE_SITE_CRAWL_TARGET, "sns_site_crawl_target")
        self.assertIs(m.TABLE_SITE_CRAWL_TARGET, common_sns.TABLE_SITE_CRAWL_TARGET)


class DryRunDoesNotWriteSiteCrawlTargetTest(unittest.TestCase):
    """--dry-run では sns_site_crawl_target への書き込み（delete_run_rows/load_json_rows）に到達しないこと。

    main() を丸ごと実行すると BigQuery 資格情報が要るため、`if args.dry_run: return` より
    後ろにしか TABLE_SITE_CRAWL_TARGET への書き込みが無いことをソース構造で確かめる
    （このリポジトリの既存テスト、例えば test_4_2_attempt_ledger.py と同じやり方）。
    """

    def test_site_crawl_target_write_is_only_after_the_dry_run_return(self) -> None:
        source = (HERE / "4_16_target_near_cells.py").read_text(encoding="utf-8")
        main_body = source.split("def main() -> None:", 1)[1]
        dry_run_idx = main_body.index("if args.dry_run:")
        return_idx = main_body.index("return", dry_run_idx)
        write_idx = main_body.index("TABLE_SITE_CRAWL_TARGET", return_idx)
        self.assertGreater(write_idx, return_idx,
                            "sns_site_crawl_target への書き込みが --dry-run の return より前にある")
        # --dry-run の分岐より前には TABLE_SITE_CRAWL_TARGET が出てこないこと
        self.assertNotIn("TABLE_SITE_CRAWL_TARGET", main_body[:dry_run_idx])

    def test_write_uses_delete_then_load_like_the_other_two_routes(self) -> None:
        """account / site_embed と同じ作法（delete_run_rows → load_json_rows）であること。"""
        source = (HERE / "4_16_target_near_cells.py").read_text(encoding="utf-8")
        write_block = source.split("site_crawl_rows = build_site_crawl_target_rows(", 1)[1][:400]
        self.assertIn("pipeline.delete_run_rows(TABLE_SITE_CRAWL_TARGET, run_id)", write_block)
        self.assertIn("pipeline.load_json_rows(TABLE_SITE_CRAWL_TARGET, site_crawl_rows)", write_block)


class TheScriptCreatesTheTableItOwnsTest(unittest.TestCase):
    """新しい表を足したら、**それを書く script が作る**（migration の DDL に頼らない）。

    2026-09-11、`sns_site_crawl_target` へ書く 4_16 が
    `404 Table food-scroll:restaurant_recommendation.sns_site_crawl_target was not found`
    で落ちた。DDL は migration ファイルに足してあったが、**その migration がまだ当たって
    いない dataset では存在しない**。この pipeline の他の script（`4_21` の貼り付け台帳、
    `4_2` の «呼んだ handle» の台帳）はどれも実行時に `CREATE TABLE IF NOT EXISTS` する。
    そちらが正であり、4_16 だけが例外になっていた。

    ⚠️ «テストが緑でも本番で落ちる» 形がこれで **今日 3 つ目**である
    （予約語の CTE 名 / GEOGRAPHY の DISTINCT / 表の未作成）。どれも «SQL を実行しないから
    分からない» ものなので、実行しなくても分かる形（＝ここ）で止める。
    """

    SOURCE = (HERE / "4_16_target_near_cells.py").read_text(encoding="utf-8")

    def test_create_table_if_not_exists_is_declared(self) -> None:
        self.assertIn("CREATE TABLE IF NOT EXISTS", self.SOURCE,
                      "書き込む表を script が作っていない（migration 頼みになっている）")

    def test_the_table_is_created_before_it_is_written(self) -> None:
        """`load_json_rows` より前に `CREATE` を通していること（順序まで固定する）。"""
        body = self.SOURCE
        create_at = body.find("CREATE_SITE_CRAWL_TARGET_SQL.replace")
        write_at = body.find("load_json_rows(TABLE_SITE_CRAWL_TARGET")
        self.assertNotEqual(-1, create_at, "CREATE を実行している箇所が無い")
        self.assertNotEqual(-1, write_at, "表へ書いている箇所が無い")
        self.assertLess(create_at, write_at,
                        "CREATE より先に書き込んでいる（初回の run が必ず落ちる）")


if __name__ == "__main__":
    unittest.main()
