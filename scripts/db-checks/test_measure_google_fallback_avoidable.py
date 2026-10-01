"""#843 需要の重みを入れた «Google fallback を避けられる率» の計算を縛るテスト。

DB は張らない。純関数（需要 CSV の読み込み・重みづけ・バッチ分割）と、
ソースを AST で読むだけの «形» の検査だけで回す。

守りたい形は 3 つ。

1. **«使える dish_media» と «セル × カテゴリの集計» の定義を書き直していないこと。**
   #1782 で «同じ判定を 2 箇所へ書いたらずれる» を 2 回踏んでいる
2. **本番の検索は JP gate を見ないので、起点を gate で絞らないこと。**
   絞ると gate の外の供給（dev 実測で usable があるカテゴリ 2,776 / gate は 134）を
   «無い» と数えてしまう
3. **判定できないセル（restaurants が 1 件も無いセル）を «返せた» 側へ混ぜないこと。**
   下界と上界の両方を出す
"""

from __future__ import annotations

import ast
import sys
import textwrap
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    import psycopg2  # noqa: F401
    import psycopg2.extras  # noqa: F401
except ImportError:
    fake_psycopg2 = types.ModuleType("psycopg2")
    fake_errors = types.ModuleType("psycopg2.errors")
    fake_extras = types.ModuleType("psycopg2.extras")

    class Error(Exception):
        pass

    for name in ("ReadOnlySqlTransaction", "QueryCanceled", "InFailedSqlTransaction"):
        setattr(fake_errors, name, type(name, (Error,), {}))
    fake_psycopg2.Error = Error
    fake_psycopg2.errors = fake_errors
    fake_psycopg2.connect = mock.MagicMock()
    fake_extras.execute_values = mock.MagicMock()
    fake_psycopg2.extras = fake_extras
    sys.modules["psycopg2"] = fake_psycopg2
    sys.modules["psycopg2.errors"] = fake_errors
    sys.modules["psycopg2.extras"] = fake_extras

import dish_media_coverage_sql as coverage_sql  # noqa: E402
import measure_dish_media_coverage as coverage_sut  # noqa: E402
import measure_google_fallback_avoidable as sut  # noqa: E402

SOURCE = Path(sut.__file__).read_text(encoding="utf-8")


class DemandCsvTest(unittest.TestCase):
    def test_comment_lines_are_skipped(self) -> None:
        with mock.patch.object(Path, "open", mock.mock_open(read_data=textwrap.dedent(
            """\
            # 出所: ...
            # ⚠️ 地点は入れていない
            s2_cell_id,category_id,radius_m,searches
            123,Q1,500,3
            456,Q2,1000,1
            """
        ))):
            rows = sut.load_demand(Path("dummy.csv"))
        self.assertEqual([(123, "Q1", 500.0, 3), (456, "Q2", 1000.0, 1)],
                         [tuple(r) for r in rows])
        self.assertEqual(500.0, rows[0].radius_m)
        self.assertEqual(3, rows[0].searches)

    def test_empty_demand_is_an_error_not_a_zero_rate(self) -> None:
        """0 行を «0% だった» と読ませない（CSV の読み違えは率の誤報になる）。"""
        with mock.patch.object(Path, "open", mock.mock_open(
            read_data="# only comments\ns2_cell_id,category_id,radius_m,searches\n"
        )):
            with self.assertRaises(SystemExit):
                sut.load_demand(Path("dummy.csv"))

    def test_shipped_demand_csv_matches_its_documented_totals(self) -> None:
        """同梱の CSV が «2,056 組 / 2,400 件» のままであることを縛る。

        先頭のコメントに書いた母数と中身がずれたら、報告した率の出所が追えなくなる。
        """
        rows = sut.load_demand(sut.DEFAULT_DEMAND_CSV)
        self.assertEqual(2056, len(rows))
        self.assertEqual(2400, sum(row.searches for row in rows))
        header = sut.DEFAULT_DEMAND_CSV.read_text(encoding="utf-8")
        self.assertIn("2,056 組", header)
        self.assertIn("2,400 件", header)
        # 需要を作った S2 レベルと、スクリプトの既定が同じであること
        self.assertIn(f"S2 level {sut.DEMAND_S2_LEVEL}", header)


class BatchTest(unittest.TestCase):
    def test_batches_cover_every_value_once(self) -> None:
        values = list(range(7))
        chunks = sut.batched(values, 3)
        self.assertEqual([[0, 1, 2], [3, 4, 5], [6]], chunks)
        self.assertEqual(values, [v for chunk in chunks for v in chunk])


class SummarizeTest(unittest.TestCase):
    DEMAND = [
        sut.DemandRow((1, "Q1", 500.0, 10)),   # 供給あり
        sut.DemandRow((2, "Q1", 500.0, 5)),    # 供給なし（セルは在る）
        sut.DemandRow((3, "Q1", 500.0, 85)),   # セルが area_cells に無い（判定不能）
    ]

    def test_weights_by_searches_not_by_pairs(self) -> None:
        summary = sut.summarize(self.DEMAND, {(1, "Q1"): 2}, known_cells={1, 2})
        self.assertEqual(100, summary["demand_searches"])
        self.assertEqual(10, summary["searches_served"])
        self.assertEqual(85, summary["searches_unjudgeable_no_area_cell"])
        # 下界: 判定不能を «返せない» 側へ → 10 / 100
        self.assertAlmostEqual(0.10, summary["served_rate_lower"])
        # 上界: 判定不能を分母から除く → 10 / 15
        self.assertAlmostEqual(10 / 15, summary["served_rate_upper"])
        # 組ベースは 1 / 3（重みを入れない数字と取り違えないため別に出す）
        self.assertEqual(1, summary["pairs_served"])
        self.assertAlmostEqual(1 / 3, summary["pairs_served_rate"])

    def test_unjudgeable_cells_are_never_counted_as_served(self) -> None:
        """area_cells に無いセルは、集計表に行があっても «返せた» にしない。"""
        summary = sut.summarize(self.DEMAND, {(3, "Q1"): 99}, known_cells={1, 2})
        self.assertEqual(0, summary["searches_served"])
        self.assertAlmostEqual(0.0, summary["served_rate_lower"])

    def test_one_restaurant_is_enough(self) -> None:
        """fallback の境目は «1 件» であって «5 件» ではない。"""
        summary = sut.summarize(
            [sut.DemandRow((1, "Q1", 500.0, 1))], {(1, "Q1"): 1}, known_cells={1}
        )
        self.assertAlmostEqual(1.0, summary["served_rate_lower"])

    def test_worst_categories_are_ranked_by_unserved_searches(self) -> None:
        demand = [
            sut.DemandRow((1, "Q1", 500.0, 3)),
            sut.DemandRow((1, "Q2", 500.0, 7)),
        ]
        summary = sut.summarize(demand, {}, known_cells={1})
        worst = summary["worst_categories_by_unserved_searches"]
        self.assertEqual("Q2", worst[0]["category_id"])
        self.assertEqual(7, worst[0]["unserved"])


class DefinitionsAreNotRewrittenTest(unittest.TestCase):
    def test_usable_and_stage5_definitions_come_from_coverage_sql(self) -> None:
        self.assertIn("coverage_sql.build_stage5_matched_rows_sql", SOURCE)
        self.assertIn("build_usable_dish_media_temp_table", SOURCE)
        # 自前で «使える dish_media» の条件を書いていないこと
        for forbidden in ("playback_status", "deleted_at IS NULL", "GROUP BY ac.s2_cell_id"):
            self.assertNotIn(forbidden, SOURCE, f"{forbidden} を写経している")

    def test_driver_is_built_without_the_jp_gate(self) -> None:
        """本番の検索は JP gate を見ない。絞ると gate の外の供給を «無い» と数える。"""
        self.assertIn("include_jp_gate=False", SOURCE)
        self.assertNotIn("include_jp_gate=True", SOURCE)
        sql = coverage_sql.build_stage5_driver_temp_table_sql(include_jp_gate=False)
        self.assertNotIn("jp_gate", sql)
        self.assertIn("jp_gate", coverage_sql.build_stage5_driver_temp_table_sql())

    def test_only_select_and_set_statements_are_executed(self) -> None:
        """書き込みを 1 文も持たないこと（DDL は一時テーブルぶんだけ、共有の道具経由）。"""
        tree = ast.parse(SOURCE)
        literals: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                if node.func.attr != "execute":
                    continue
                for arg in node.args[:1]:
                    if isinstance(arg, (ast.Constant, ast.JoinedStr)):
                        literals.append(ast.unparse(arg))
        self.assertTrue(literals, "execute の呼び出しが 1 つも見つからない")
        for literal in literals:
            head = literal.strip("'\"f ").upper()
            self.assertTrue(
                head.startswith("SELECT") or head.startswith("SET"),
                f"SELECT / SET 以外を実行している: {literal}",
            )

    def test_public_schema_is_not_selectable(self) -> None:
        """本番を測るのはオーナーが public と言ったときだけ（#843 の規則）。"""
        parser = sut.build_arg_parser()
        schema = next(a for a in parser._actions if "--schema" in a.option_strings)  # noqa: SLF001
        self.assertEqual(["dev"], list(schema.choices))


class MissingS2DependencyTest(unittest.TestCase):
    """依存の欠落を «呼んだ瞬間» に捕まえること。

    2026-10-01 に [PR #2099](https://github.com/Ayato-kosaka/nanitabeyo/pull/2099) で
    ガードを **import の周り**へ置いたが、`normalization.s2_cell_id()` は `s2sphere` を
    **関数の中で** import するので、そのガードは一度も効かない場所にあった。
    «直したつもりが効いていない» を二度やらないため、**実際に発火することを**テストする。
    """

    def test_module_not_found_is_turned_into_an_actionable_message(self) -> None:
        with mock.patch.object(
            coverage_sut, "s2_cell_id",
            side_effect=ModuleNotFoundError("No module named 's2sphere'", name="s2sphere"),
        ):
            with self.assertRaises(SystemExit) as caught:
                coverage_sut.compute_area_cells([(35.0, 139.0)], s2_level=14)
        message = str(caught.exception)
        self.assertIn("s2sphere", message)
        self.assertIn("scripts/20260808T0000_restaurant/requirements.txt", message)

    def test_guard_is_at_the_call_site_not_at_the_import(self) -> None:
        source = Path(coverage_sut.__file__).read_text(encoding="utf-8")
        self.assertIn("from normalization import s2_cell_id", source)
        # import を try で囲んでいないこと（囲んでも発火しないので、囲むと嘘になる）
        self.assertNotIn("try:\n    from normalization import", source)


class CrawlTargetsTest(unittest.TestCase):
    """«次に何を埋めるか» の出口を縛る（#843 §3）。

    2026-10-01 の実測で «返せないのはカテゴリ不足ではなく地理の偏り» と分かった
    （ラーメンは全国 6,180 店に在庫があるのに検索の 83% が返せない）。
    だから **需要があって供給が無いセルを名指しできる**ことが成果物である。

    ⚠️ **2 種類を混ぜないこと。** 店はあるが投稿が無いセルは crawl で埋まるが、
    店の記録すら無いセルは crawl では埋まらない（別の問題）。混ぜると
    «crawl すれば解決する» という誤った見通しになる。
    """

    DEMAND = [
        sut.DemandRow((1, "Q1", 500.0, 10)),   # 供給あり → ターゲットではない
        sut.DemandRow((2, "Q1", 500.0, 7)),    # 店はあるが投稿が無い
        sut.DemandRow((3, "Q1", 500.0, 4)),    # 店の記録すら無い
    ]
    COUNTS = {(1, "Q1"): 3}
    KNOWN = {1, 2}
    RESTAURANTS = {1: 120, 2: 45}

    def _summary(self) -> dict:
        return sut.summarize(self.DEMAND, self.COUNTS, self.KNOWN, self.RESTAURANTS)

    def test_served_pairs_are_not_targets(self) -> None:
        targets = self._summary()["crawl_targets"]
        self.assertNotIn((1, "Q1"), [(t["s2_cell_id"], t["category_id"]) for t in targets])
        self.assertEqual(2, len(targets))

    def test_kind_separates_crawlable_from_not(self) -> None:
        by_cell = {t["s2_cell_id"]: t for t in self._summary()["crawl_targets"]}
        self.assertEqual("no_media", by_cell[2]["kind"])
        self.assertEqual(45, by_cell[2]["restaurants_in_cell"])
        self.assertEqual("no_restaurant", by_cell[3]["kind"])
        self.assertEqual(0, by_cell[3]["restaurants_in_cell"])

    def test_unserved_searches_split_by_kind(self) -> None:
        summary = self._summary()
        self.assertEqual(7, summary["unserved_searches_in_cells_with_restaurants"])
        self.assertEqual(4, summary["unserved_searches_in_cells_without_restaurants"])
        self.assertEqual(1, summary["crawl_targets_no_media"])
        self.assertEqual(1, summary["crawl_targets_no_restaurant"])
        self.assertEqual(2, summary["crawl_targets_total"])

    def test_targets_are_ranked_by_demand(self) -> None:
        targets = self._summary()["crawl_targets"]
        self.assertEqual([7, 4], [t["unserved_searches"] for t in targets])

    def test_summarize_works_without_restaurant_counts(self) -> None:
        """店舗数を渡さなくても落ちないこと（渡さない呼び出しが残っていてもよい）。"""
        summary = sut.summarize(self.DEMAND, self.COUNTS, self.KNOWN)
        self.assertEqual(2, summary["crawl_targets_total"])
        # 店舗数が分からないので、全部 «店の記録すら無い» 側へは倒さず 0 として扱う
        self.assertEqual(2, summary["crawl_targets_no_restaurant"])

    def test_full_target_list_is_not_inlined_into_the_json_line(self) -> None:
        """JSON は 1 行で Job Summary に貼られる。数千行を混ぜると読めなくなる。"""
        self.assertIn('if key != "crawl_targets"', SOURCE)
        self.assertIn('"crawl_targets_top20"', SOURCE)


if __name__ == "__main__":
    unittest.main()
