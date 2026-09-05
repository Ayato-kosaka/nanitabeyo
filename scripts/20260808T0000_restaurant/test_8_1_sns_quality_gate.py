"""#1273 8_1 に足した «SNS 経路の品質ゲート» のうち、BigQuery を叩かずに固定できるもの。

閾値の «根拠» と実測値は 8_1_validate_catalogs.py のコメントにある。ここで固定するのは、
それを誰かが黙って変えたり、SQL と Python の対応がずれたときに気付ける形の 3 つ。

  1. check の名前・severity・閾値の対応（SQL 本文から読む。写経しない）
  2. どの run でどの check を残すか（--sns-run-id / --sns-only / --skip-dish-media-checks）
  3. provider の値域が 9_2 と一致していること（dmee_provider_check と同じであること）
"""

from __future__ import annotations

import ast
import importlib.util
import re
import unittest
from pathlib import Path

_HERE = Path(__file__).resolve().parent

_SPEC = importlib.util.spec_from_file_location(
    "validate_catalogs", _HERE / "8_1_validate_catalogs.py"
)
validate = importlib.util.module_from_spec(_SPEC)
assert _SPEC.loader is not None
_SPEC.loader.exec_module(validate)


class _FakeConfig:
    dish_dataset_ref = "proj.wikidata_food_graph"


class _FakePipeline:
    """validation_sql が使う部分だけ。認証しない。"""

    config = _FakeConfig()
    dataset_ref = "proj.restaurant_recommendation"


def _sql() -> str:
    return validate.validation_sql(_FakePipeline())


class ChecksExistTest(unittest.TestCase):
    """SNS 経路の check が «存在すること» を SQL 本文から確かめる。

    8_1 の checks は 1 本の SQL の UNION ALL なので、Python 側の集合と SQL 側の
    リテラルは黙ってずれる。片方だけ直したときに落ちるようにする。
    """

    def test_every_sns_check_is_emitted_by_the_sql(self) -> None:
        sql = _sql()
        for name in validate.SNS_MEDIA_CHECKS:
            with self.subTest(check=name):
                self.assertIn(f"'{name}'", sql)

    def test_sns_checks_cover_the_five_known_failure_shapes(self) -> None:
        # #1273 で «既に分かっている失敗の形»。名前を変えるのは構わないが、
        # 観点ごと消えたら落ちる。
        self.assertIn("sns_media_duplicate_post_rate", validate.SNS_MEDIA_CHECKS)  # 1投稿1行
        self.assertIn("sns_media_store_known_rate", validate.SNS_MEDIA_CHECKS)  # 店の実在
        self.assertIn("sns_media_jp_gate_category_rate", validate.SNS_MEDIA_CHECKS)  # 134の外
        self.assertIn("sns_media_required_fields_valid", validate.SNS_MEDIA_CHECKS)  # url/provider
        self.assertIn("sns_media_store_inside_japan", validate.SNS_MEDIA_CHECKS)  # 国外混入

    def test_severity_split_matches_what_stops_the_sync(self) -> None:
        sql = _sql()
        # 止めるもの: 構造が壊れている / 国外が混ざった / 重複が跳ねた
        for name in (
            "sns_dish_media_catalog_non_empty",
            "sns_media_pg_unique_key_unique",
            "sns_media_required_fields_valid",
            "sns_media_duplicate_post_rate",
            "sns_media_store_inside_japan",
        ):
            with self.subTest(check=name):
                self.assertIn(f"'{name}', 'ERROR'", sql)
        # 止めないもの: 9_2 が落として続行するもの / 捨てずに配信するもの
        for name in ("sns_media_store_known_rate", "sns_media_jp_gate_category_rate"):
            with self.subTest(check=name):
                self.assertIn(f"'{name}', 'WARNING'", sql)

    def test_the_sns_catalog_is_actually_read(self) -> None:
        sql = _sql()
        self.assertIn("sns_dish_media_catalog", sql)
        # SNS の run_id は restaurant の run_id と別。@run_id で読んではいけない
        self.assertIn("WHERE run_id = @sns_run_id", sql)
        self.assertIn("rc.run_id = @restaurant_catalog_run_id", sql)


class ThresholdTest(unittest.TestCase):
    """閾値は «今日の実測» を基準に置いたもの。上げ下げするなら根拠ごと直す。"""

    def test_duplicate_post_rate_allows_nothing(self) -> None:
        # #1846: 9_1 が «1 投稿 1 店» を確定するようになったので、catalog は構造的に
        # 1 投稿 1 行になる。少しでも余ったら «店の当て方が壊れた» なので 0 で止める。
        # （許していた頃の実測 1.409% は全件が «同じ投稿に別の店» だった）
        self.assertEqual(validate.SNS_DUPLICATE_POST_RATE_MAX, 0.0)

    def test_unknown_store_rate_passes_today(self) -> None:
        # 2026-09-05 実測: 497 / 142,489 = 0.349%
        self.assertGreater(validate.SNS_UNKNOWN_STORE_RATE_MAX, 497 / 142489)

    def test_jp_gate_category_rate_covers_the_observed_band(self) -> None:
        # 2026-09-05 実測: 26,648 / 142,489 = 18.702%。7_2 の観測帯は 19.9〜21.2%
        self.assertGreater(
            validate.SNS_OUTSIDE_JP_GATE_CATEGORY_RATE_MAX, 0.212
        )

    def test_thresholds_reach_the_sql_as_parameters(self) -> None:
        # 閾値を SQL へ直接書くと、Python の定数だけ直したときに黙ってずれる
        sql = _sql()
        for parameter in (
            "@sns_duplicate_post_rate_max",
            "@sns_unknown_store_rate_max",
            "@sns_outside_jp_gate_category_rate_max",
        ):
            with self.subTest(parameter=parameter):
                self.assertIn(parameter, sql)

    def test_every_named_parameter_in_the_sql_is_bound(self) -> None:
        # 束ね忘れると BigQuery が実行時に落ちる。ここで先に落とす
        args = validate.parse_args(["--run-id", "r", "--sns-run-id", "s"])
        bound = {p.name for p in validate.query_parameters(args, "r")}
        used = set(re.findall(r"@([a-z_]+)", _sql()))
        self.assertEqual(set(), used - bound)


class SelectChecksTest(unittest.TestCase):
    """SQL は 1 本なので全 check が計算される。どれを «検証結果» として残すか。"""

    ALL = sorted(
        validate.SNS_MEDIA_CHECKS
        | validate.DISH_MEDIA_CHECKS
        | {"restaurant_catalog_non_empty", "seed_non_empty"}
    )

    def test_sns_checks_are_dropped_when_sns_is_not_run(self) -> None:
        # SNS を流していない run で sns_dish_media_catalog_non_empty を残すと必ず ERROR
        args = validate.parse_args(["--run-id", "restaurant-2026-08-23"])
        kept, skipped = validate.select_checks(self.ALL, args)
        self.assertIn("sns_dish_media_catalog_non_empty", skipped)
        self.assertIn("restaurant_catalog_non_empty", kept)
        # 134 カテゴリの検査は restaurant 側の check でもあるので残る
        self.assertIn("jp_gate_category_count", kept)

    def test_sns_run_id_turns_the_sns_checks_on(self) -> None:
        args = validate.parse_args(
            ["--run-id", "r", "--sns-run-id", "sns-catalog-2026-09-05"]
        )
        kept, _ = validate.select_checks(self.ALL, args)
        for name in validate.SNS_MEDIA_CHECKS:
            with self.subTest(check=name):
                self.assertIn(name, kept)

    def test_sns_only_drops_the_restaurant_side(self) -> None:
        # SNS の run_id には restaurant_source_records が 1 行も無く、
        # restaurant 側の check は全て ERROR になる
        args = validate.parse_args(
            ["--run-id", "sns-catalog-2026-09-05", "--sns-run-id", "sns-catalog-2026-09-05",
             "--sns-only"]
        )
        kept, skipped = validate.select_checks(self.ALL, args)
        self.assertEqual(sorted(validate.SNS_MEDIA_CHECKS), sorted(kept))
        self.assertIn("restaurant_catalog_non_empty", skipped)
        self.assertIn("coverage_cross_product_complete", skipped)

    def test_dish_media_skip_still_works(self) -> None:
        args = validate.parse_args(["--run-id", "r", "--skip-dish-media-checks"])
        kept, skipped = validate.select_checks(self.ALL, args)
        for name in validate.DISH_MEDIA_CHECKS:
            with self.subTest(check=name):
                self.assertIn(name, skipped)
        self.assertIn("restaurant_catalog_non_empty", kept)

    def test_nothing_is_lost_or_duplicated(self) -> None:
        for argv in (
            ["--run-id", "r"],
            ["--run-id", "r", "--sns-run-id", "s"],
            ["--run-id", "r", "--sns-run-id", "s", "--sns-only"],
            ["--run-id", "r", "--skip-dish-media-checks"],
        ):
            with self.subTest(argv=argv):
                kept, skipped = validate.select_checks(self.ALL, validate.parse_args(argv))
                self.assertEqual(sorted(self.ALL), sorted(kept + skipped))


class ProviderValueDomainTest(unittest.TestCase):
    """provider の値域を 9_2 と 8_1 の 2 か所に書いた以上、ずれたら落ちるようにする。

    ast で読むので psycopg2 が入っていなくても動く（9_2 は pg_sync_common 経由で
    psycopg2 を import する）。
    """

    def _providers_in_9_2(self) -> tuple[str, ...]:
        tree = ast.parse((_HERE / "9_2_sync_sns_dish_media.py").read_text(encoding="utf-8"))
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == "ALLOWED_PROVIDERS" for t in node.targets
            ):
                return tuple(ast.literal_eval(node.value))
        self.fail("9_2 に ALLOWED_PROVIDERS が見つかりません")

    def test_matches_the_sync_script(self) -> None:
        self.assertEqual(self._providers_in_9_2(), validate.DMEE_ALLOWED_PROVIDERS)

    def test_matches_the_db_check(self) -> None:
        # dmee_provider_check（20260824T0200_create_dish_media_external_embeddings.sql）
        migration = (
            _HERE.parents[1]
            / "infra/supabase/migrations"
            / "20260824T0200_create_dish_media_external_embeddings.sql"
        ).read_text(encoding="utf-8")
        for provider in validate.DMEE_ALLOWED_PROVIDERS:
            with self.subTest(provider=provider):
                self.assertIn(f"'{provider}'", migration)


class SyncSideContractTest(unittest.TestCase):
    """9_2 がゲートを参照できる形になっていること（9_2 自身は別の担当が触る）。"""

    def test_sync_common_knows_the_sns_error_checks(self) -> None:
        source = (_HERE / "pg_sync_common.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == "SNS_DISH_MEDIA_ERROR_CHECKS"
                for t in node.targets
            ):
                names = ast.literal_eval(node.value.args[0])
                # ERROR の名前が 8_1 の集合の部分集合であること（WARNING を混ぜない）
                self.assertTrue(set(names) <= validate.SNS_MEDIA_CHECKS)
                self.assertNotIn("sns_media_store_known_rate", names)
                return
        self.fail("pg_sync_common に SNS_DISH_MEDIA_ERROR_CHECKS がありません")

    def test_freshness_check_reads_the_sns_catalog(self) -> None:
        # SNS の run_id で 8_1 を回したとき、catalog_built_at が NULL にならないこと
        source = (_HERE / "pg_sync_common.py").read_text(encoding="utf-8")
        self.assertIn("sns_dish_media_catalog` WHERE run_id = @run_id", source)



class OverseasCheckIsIndependentTest(unittest.TestCase):
    """#1815 «取り込みと同じ矩形で取り込み結果を検査する» を二度としないための固定。

    韓国の店 97,726 行が入った run でも `sns_media_store_inside_japan` は緑だった。
    1_3 が日本と見なす矩形（緯度20.0–46.5 / 経度122.0–154.0）が韓国全土を含むため、
    同じ矩形を出力に当てると構造上落ちない。実測でも旧判定 0 行 / 新判定 948 行。
    """

    def test_check_does_not_use_the_ingest_bounding_box(self) -> None:
        sql = _sql()
        state = sql.split("sns_media_store_state AS (")[1].split("AS overseas_rows")[0]
        for param in ("@jp_lat_min", "@jp_lat_max", "@jp_lng_min", "@jp_lng_max"):
            self.assertNotIn(param, state,
                             "取り込みの矩形を判定に使うと構造上いつでも緑になる")

    def test_check_uses_country_and_script_evidence(self) -> None:
        sql = _sql()
        state = sql.split("sns_media_store_state AS (")[1].split("AS overseas_rows")[0]
        self.assertIn("country_code", state)
        self.assertIn("AC00", state)  # ハングル音節。取り込みから独立した根拠

if __name__ == "__main__":
    unittest.main()
