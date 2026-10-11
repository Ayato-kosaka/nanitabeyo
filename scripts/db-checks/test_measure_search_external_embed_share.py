"""#1947 «検索が外部埋め込みを返しているか» の計測が壊れていないことを検査する（DB 不要）。

このスクリプトの値打ちは次の 3 つに全部乗っている。ここが崩れると、
**別のクエリを測って «返っている / 返っていない» と読む**ことになる。

1. 検索の判定を **自分で書いていない**（本番の書き出し SQL をそのまま実行している）
2. バインド値を **params.json の順番どおり**に並べている
   （#1629 で radius と limit が入れ替わったまま «測れている» と読んだ事故がある）
3. 割合の分母が «返った行数» であり、0 件と 0% を取り違えない

psycopg2 も DB も要らない（本体は psycopg2 を main() の中で import する）。
"""

from __future__ import annotations

import json
import re
import sys
import unittest
from pathlib import Path

# リポジトリ直下から `python3 -m unittest scripts/db-checks/...` で回せるようにする
# （test_explain_rows_read.py と同じ作法）
sys.path.insert(0, str(Path(__file__).resolve().parent))

import dish_media_search_sql as s  # noqa: E402
import measure_search_external_embed_share as m  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]


class SearchSqlIsNotTranscribedTest(unittest.TestCase):
    """1. 検索の判定を自分で書いていないこと。"""

    def test_search_sql_comes_from_the_generated_file(self):
        sql, _ = m.load_search_sql()
        generated = s.SQL_PATH.read_text(encoding="utf-8").rstrip().rstrip(";")
        # 違いはプレースホルダの表記（? → $n）だけであること
        self.assertEqual(re.sub(r"\$\d+", "?", sql), generated)

    def test_module_does_not_contain_its_own_candidate_filter(self):
        """計測スクリプトの本文に «候補の絞り込み» を書き写していないこと。

        本体 SQL にしか無いはずの語がスクリプト側に現れたら、写経が始まっている。
        """
        source = Path(m.__file__).read_text(encoding="utf-8")
        # docstring / コメントを除いた «実行されるコード» だけを見る
        code = "\n".join(
            line for line in source.splitlines() if not line.strip().startswith("#")
        )
        for transcribed in ("base_candidates", "nearby_restaurants", "ROW_NUMBER", "gumbel"):
            self.assertNotIn(
                transcribed,
                code,
                f"{transcribed} が計測側に書かれている。本体 SQL は sql/ から読むこと",
            )

    def test_usable_condition_comes_from_the_generated_snapshot(self):
        """在庫（母数）の «使える dish_media» も正本から読んでいること。"""
        from dish_media_coverage_sql import usable_dish_media_conditions_sql

        conditions = usable_dish_media_conditions_sql()
        for sql in (m.build_pool_sql(), m.build_categories_in_radius_sql()):
            self.assertIn(conditions, sql)

    def test_render_type_lookup_has_no_extra_predicate(self):
        """ラベル引き当てに条件を足すと «検索が返した行» でなくなる。"""
        lookup = m.RENDER_TYPE_LOOKUP_SQL
        self.assertIn("FROM dish_media dm", lookup)
        self.assertIn("WHERE dm.id = ANY(%s::uuid[])", lookup)
        self.assertEqual(lookup.upper().count("WHERE"), 1)
        self.assertNotIn("deleted_at", lookup)


class RenderTypeLabelTest(unittest.TestCase):
    """`render_type` の値は DB の CHECK 制約が持つ列挙値そのものであること。"""

    MIGRATION = (
        REPO_ROOT
        / "infra/supabase/migrations/20260824T0100_add_render_type_to_dish_media.sql"
    )

    def test_values_match_the_check_constraint(self):
        sql = self.MIGRATION.read_text(encoding="utf-8")
        match = re.search(r"CHECK \(render_type IN \(([^)]*)\)\)", sql)
        self.assertIsNotNone(match, "migration の CHECK 制約が見つからない")
        allowed = {v.strip().strip("'") for v in match.group(1).split(",")}
        self.assertEqual(
            allowed, {m.STORED_RENDER_TYPE, m.EXTERNAL_EMBED_RENDER_TYPE}
        )


class BindOrderTest(unittest.TestCase):
    """2. バインド値が params.json の順番どおりに並んでいること。"""

    def setUp(self):
        self.sql, self.names = m.load_search_sql()

    def test_placeholder_count_matches_param_names(self):
        self.assertEqual(self.sql.count("$"), len(self.names))
        self.assertEqual(
            self.names,
            json.loads(s.PARAMS_PATH.read_text(encoding="utf-8")),
        )

    def test_values_are_placed_by_name_not_by_hand(self):
        """同じ名前が複数回出る（lat / lng / radius）ので、位置ではなく名前で引くこと。"""
        params = s.bind_search_params(
            self.names,
            user_id="U",
            lat=35.5,
            lng=139.5,
            radius=500,
            category_id="Q483163",
            limit=5,
            page_seed="seed",
        )
        self.assertEqual(len(params), len(self.names))
        for name, value in zip(self.names, params):
            if name == "lat":
                self.assertEqual(value, 35.5)
            elif name == "lng":
                self.assertEqual(value, 139.5)
            elif name == "radius":
                self.assertEqual(value, 500)
            elif name == "limit":
                self.assertEqual(value, 5)
            elif name == "categoryId":
                self.assertEqual(value, "Q483163")
            elif name == "pageSeed":
                self.assertEqual(value, "seed")

    def test_radius_and_limit_are_not_swapped(self):
        """#1629 の事故そのもの。半径 500 と limit 5 は取り違えても型では落ちない。"""
        params = s.bind_search_params(
            self.names,
            user_id="U",
            lat=35.5,
            lng=139.5,
            radius=500,
            category_id="Q",
            limit=5,
            page_seed="seed",
        )
        self.assertEqual(params[self.names.index("radius")], 500)
        self.assertEqual(params[self.names.index("limit")], 5)

    def test_knn_limit_follows_the_production_formula(self):
        """正本は nearby-restaurants-cte.ts の knnCandidateLimit()。"""
        self.assertEqual(s.knn_candidate_limit(5), 1000)
        self.assertEqual(s.knn_candidate_limit(20), 1000)
        self.assertEqual(s.knn_candidate_limit(100), 5000)

    def test_unknown_bind_name_is_rejected(self):
        """SQL の形が変わって知らない名前が増えたら、黙って測らずに止まること。"""
        with self.assertRaises(SystemExit):
            s.bind_search_params(
                ["userId", "somethingNew"],
                user_id="U",
                lat=0,
                lng=0,
                radius=1,
                category_id="Q",
                limit=1,
                page_seed="seed",
            )

    def test_default_limit_matches_remote_config_default(self):
        """アプリが実際に投げる件数（v1_search_result_restaurants_number の既定値）。"""
        remote_config = (
            REPO_ROOT / "app-expo/lib/remoteConfig.ts"
        ).read_text(encoding="utf-8")
        match = re.search(
            r'v1_search_result_restaurants_number:\s*"(\d+)"', remote_config
        )
        self.assertIsNotNone(match, "Remote Config の既定値が見つからない")
        self.assertEqual(s.DEFAULT_LIMIT, int(match.group(1)))

    def test_default_radius_matches_the_app_default(self):
        constants = (
            REPO_ROOT / "app-expo/features/dishCategories/constants.ts"
        ).read_text(encoding="utf-8")
        match = re.search(r"DEFAULT_SEARCH_RADIUS\s*=\s*(\d+)", constants)
        self.assertIsNotNone(match, "アプリの既定半径が見つからない")
        self.assertEqual(m.DEFAULT_RADIUS_M, int(match.group(1)))

    def test_positional_placeholders_become_pyformat_in_order(self):
        pyformat = m._to_pyformat(self.sql)
        self.assertEqual(pyformat.count("%s"), len(self.names))
        self.assertNotIn("$", pyformat)


class SummarizeTest(unittest.TestCase):
    """3. 集計の割っ算。"""

    def test_share_is_external_over_returned_rows(self):
        summary = m.summarize(
            [
                ("m1", "r1", "external_embed"),
                ("m2", "r1", "stored"),
                ("m3", "r2", "external_embed"),
                ("m4", "r3", "stored"),
            ]
        )
        self.assertEqual(summary["rows"], 4)
        self.assertEqual(summary["external_embed_rows"], 2)
        self.assertAlmostEqual(summary["external_embed_share"], 0.5)

    def test_zero_rows_has_no_share_instead_of_zero_percent(self):
        """«1 件も返っていない» と «返っているが埋め込みが 0%» は打つ手が違う。"""
        self.assertIsNone(m.summarize([])["external_embed_share"])
        returned_but_none = m.summarize([("m1", "r1", "stored")])
        self.assertEqual(returned_but_none["external_embed_share"], 0.0)

    def test_distinct_restaurants_counts_each_restaurant_once(self):
        """同じ店が new / regional の 2 バケットで返りうるので、行数と店数は一致しない。"""
        summary = m.summarize(
            [
                ("m1", "r1", "external_embed"),
                ("m2", "r1", "stored"),
                ("m3", "r1", "external_embed"),
            ]
        )
        self.assertEqual(summary["rows"], 3)
        self.assertEqual(summary["distinct_restaurants"], 1)
        self.assertEqual(summary["distinct_external_embed_restaurants"], 1)

    def test_unknown_render_type_is_surfaced_not_folded_into_stored(self):
        summary = m.summarize([("m1", "r1", "brand_new_kind")])
        self.assertEqual(summary["unknown_render_types"], ["brand_new_kind"])
        self.assertEqual(summary["external_embed_rows"], 0)

    def test_merge_uses_pooled_rows_not_average_of_shares(self):
        """カテゴリごとの行数が違うので «割合の平均» を取ると小さいカテゴリが過大評価される。

        下の 2 カテゴリは 100% と 0%。行数で重み付ければ 1/5 = 20% になる。
        単純平均だと 50% になってしまう。
        """
        merged = m.merge_summaries(
            [
                ("Q1", [("m1", "r1", "external_embed")]),
                (
                    "Q2",
                    [
                        ("m2", "r2", "stored"),
                        ("m3", "r3", "stored"),
                        ("m4", "r4", "stored"),
                        ("m5", "r5", "stored"),
                    ],
                ),
            ]
        )
        self.assertEqual(merged["rows"], 5)
        self.assertAlmostEqual(merged["external_embed_share"], 0.2)

    def test_format_share_marks_undefined_share(self):
        self.assertEqual(m.format_share(None).strip(), "―")
        self.assertEqual(m.format_share(0.0).strip(), "0.0%")


class PointArgumentTest(unittest.TestCase):
    def test_label_is_optional(self):
        self.assertEqual(m.parse_point("渋谷:35.6,139.7"), ("渋谷", 35.6, 139.7))
        self.assertEqual(m.parse_point("35.6,139.7"), ("35.6,139.7", 35.6, 139.7))

    def test_lat_lng_pair_is_required_together(self):
        with self.assertRaises(ValueError):
            m.resolve_points(None, 35.6, None)
        with self.assertRaises(ValueError):
            m.resolve_points(None, None, 139.7)

    def test_out_of_range_and_malformed_points_are_rejected(self):
        for bad in ("渋谷:135.6,139.7", "渋谷:35.6", "渋谷:あ,139.7", "渋谷:35.6,999"):
            with self.assertRaises(ValueError, msg=bad):
                m.parse_point(bad)

    def test_points_and_lat_lng_are_both_measured(self):
        points = m.resolve_points(["梅田:34.7,135.5"], 35.6, 139.7)
        self.assertEqual([p[0] for p in points], ["梅田", "35.6,139.7"])

    def test_defaults_cover_city_center_and_a_regional_city(self):
        """都心だけ測って «返っている» と言うと、地方で 0 件なことに気付けない。"""
        self.assertEqual(len(m.resolve_points(None, None, None)), 3)
        self.assertEqual(m.resolve_points(None, None, None), list(m.DEFAULT_POINTS))

    def test_page_seeds_are_deterministic_and_distinct(self):
        """再実行して同じ数字が出ないと «直った» を確かめられない。"""
        self.assertEqual(m.page_seeds(3), m.page_seeds(3))
        self.assertEqual(len(set(m.page_seeds(5))), 5)


WRITE_KEYWORDS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|COPY)\b",
    re.IGNORECASE,
)


class ReadOnlyTest(unittest.TestCase):
    """書き込みを 1 文も投げないこと（この置き場の約束）。

    ⚠️ ソース全文の部分一致で «TRUNCATE が無いこと» を見ないこと。
       `truncated` のような変数名に当たって、検査が «たまたま赤い» 状態になる。
       ここでは «実際に execute へ渡る文» だけを AST で拾って判定する。
    """

    def _executed_sql_literals(self):
        """`cur.execute(...)` の第 1 引数として書かれている文字列を全部拾う。

        文字列リテラルでも f-string でもない（= 関数呼び出しや変数）ものは、
        その名前を返す。名前は下の許可リストで «SQL を組み立てる純関数» に限る。
        """
        import ast

        tree = ast.parse(Path(m.__file__).read_text(encoding="utf-8"))
        literals, names = [], []
        for node in ast.walk(tree):
            if not (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "execute"
                and node.args
            ):
                continue
            arg = node.args[0]
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                literals.append(arg.value)
            elif isinstance(arg, ast.JoinedStr):
                literals.append(
                    "".join(
                        v.value
                        for v in arg.values
                        if isinstance(v, ast.Constant) and isinstance(v.value, str)
                    )
                )
            elif isinstance(arg, ast.Name):
                names.append(arg.id)
            elif isinstance(arg, ast.Call) and isinstance(arg.func, ast.Name):
                names.append(arg.func.id)
            else:
                self.fail(f"execute の引数が読めない形になっている: {ast.dump(arg)[:120]}")
        return literals, names

    def test_every_executed_statement_is_a_read(self):
        literals, names = self._executed_sql_literals()
        self.assertTrue(literals or names, "execute の呼び出しが 1 つも見つからない")

        for sql in literals:
            self.assertRegex(
                sql.strip(),
                r"(?is)^(SELECT|SET)\b",
                f"SELECT / SET 以外を実行しようとしている: {sql.strip()[:60]}",
            )
            self.assertIsNone(
                WRITE_KEYWORDS.search(sql), f"書き込みの語が混ざっている: {sql[:60]}"
            )

        # 変数・関数で渡しているものは «SQL を組み立てる純関数» に限り、中身も検査する
        allowed = {
            "_to_pyformat": m._to_pyformat(m.load_search_sql()[0]),
            "build_pool_sql": m.build_pool_sql(),
            "build_categories_in_radius_sql": m.build_categories_in_radius_sql(),
            "RENDER_TYPE_LOOKUP_SQL": m.RENDER_TYPE_LOOKUP_SQL,
        }
        for name in names:
            self.assertIn(name, allowed, f"素性の知れない SQL を実行している: {name}")
            sql = allowed[name]
            self.assertRegex(sql.strip(), r"(?is)^(WITH|SELECT)\b")
            self.assertIsNone(
                WRITE_KEYWORDS.search(sql), f"{name} に書き込みの語が混ざっている"
            )

    def test_connection_is_opened_readonly(self):
        source = Path(m.__file__).read_text(encoding="utf-8")
        self.assertIn("conn.set_session(readonly=True)", source)

    def test_schema_choice_excludes_production(self):
        """public（本番）はオーナーが自分から出したときにしか触らない。"""
        source = Path(m.__file__).read_text(encoding="utf-8")
        self.assertIn('parser.add_argument("--schema", default="dev", choices=["dev"])', source)


class FakeColumn:
    def __init__(self, name):
        self.name = name


class FakeCursor:
    """DB の代わり。«どの SQL にどう答えたか» だけを持つ。

    本物のプランナも索引も要らない。ここで確かめたいのは
    **返ってきた行を計測側がどう数え、どう表示するか**だけである。
    """

    SEARCH_COLUMNS = (
        "bucket",
        "dish_media_id",
        "dish_id",
        "restaurant_id",
        "distance_km",
    )

    def __init__(self, pool, categories, search_rows, render_types):
        self.pool = pool
        self.categories = categories
        self.search_rows = search_rows
        self.render_types = render_types
        self.executed = []
        self.description = None
        self._result = []

    def execute(self, sql, params=None):
        self.executed.append((sql, params))
        if "GROUP BY dm.render_type" in sql:
            self.description = None
            self._result = self.pool
        elif "GROUP BY d.category_id" in sql:
            self.description = None
            self._result = self.categories
        elif "SELECT dm.id, dm.render_type" in sql:
            self.description = None
            self._result = [
                (i, self.render_types[i]) for i in params[0] if i in self.render_types
            ]
        else:
            # 本体の検索クエリ。category_id は params.json の並びで 5 番目
            self.description = [FakeColumn(c) for c in self.SEARCH_COLUMNS]
            category_id = params[4]
            self._result = [
                ("new", dm, "dish", rest, 0.1)
                for cid, dm, rest in self.search_rows
                if cid == category_id
            ]

    def fetchall(self):
        return list(self._result)

    def fetchone(self):
        return self._result[0] if self._result else None


class DryRunTest(unittest.TestCase):
    """DB 無しで 1 地点ぶんを通しでまわす。

    «表示のところで落ちる» を db-script-run.yml の 1 回ぶんで踏まないための保険。
    書式指定の引数の数が合っていないような不具合は、ここでしか捕まらない。
    """

    def setUp(self):
        self.sql, self.names = m.load_search_sql()

    def _run(self, cur, **kwargs):
        options = dict(radius=500, limit=5, pages=1, categories=None, max_categories=30)
        options.update(kwargs)
        return m.measure_point(
            cur, self.sql, self.names, ("渋谷", 35.659482, 139.700553), **options
        )

    def test_counts_what_the_search_actually_returned(self):
        cur = FakeCursor(
            pool=[("stored", 40, 12, 3), ("external_embed", 10, 4, 2)],
            categories=[("Q1", "ramen", 30, 8), ("Q2", "sushi", 20, 2)],
            search_rows=[
                ("Q1", "m1", "r1"),
                ("Q1", "m2", "r2"),
                ("Q2", "m3", "r3"),
            ],
            render_types={
                "m1": "external_embed",
                "m2": "stored",
                "m3": "stored",
            },
        )
        result = self._run(cur)

        ramen = next(c for c in result["categories"] if c["category_id"] == "Q1")
        self.assertEqual(ramen["rows"], 2)
        self.assertEqual(ramen["external_embed_rows"], 1)
        self.assertAlmostEqual(ramen["external_embed_share"], 0.5)

        self.assertEqual(result["no_category"]["rows"], 3)
        self.assertEqual(result["no_category"]["external_embed_rows"], 1)
        self.assertEqual(result["no_category"]["distinct_external_embed_restaurants"], 1)
        self.assertEqual(result["pool"]["external_embed"]["media"], 10)

        # 結論の 1 行も落ちずに出ること
        m.report_verdict([result])

    def test_stock_present_but_nothing_returned_is_reported(self):
        """#1947 の本命。在庫があるのに検索が 1 件も返さない状態を通しで再現する。"""
        cur = FakeCursor(
            pool=[("stored", 40, 12, 3), ("external_embed", 10, 4, 2)],
            categories=[("Q1", "ramen", 30, 8)],
            search_rows=[("Q1", "m1", "r1")],
            render_types={"m1": "stored"},
        )
        result = self._run(cur)
        self.assertEqual(result["no_category"]["external_embed_rows"], 0)
        self.assertEqual(result["no_category"]["external_embed_share"], 0.0)
        m.report_verdict([result])

    def test_empty_radius_does_not_crash(self):
        cur = FakeCursor(pool=[], categories=[], search_rows=[], render_types={})
        result = self._run(cur)
        self.assertEqual(result["categories"], [])
        self.assertIsNone(result["no_category"]["external_embed_share"])
        m.report_verdict([result])

    def test_named_category_is_measured_even_with_no_stock(self):
        """名指しされたカテゴリは在庫が無くても回す（«0 件だった» ことが答えになる）。"""
        cur = FakeCursor(
            pool=[("stored", 5, 2, 1)],
            categories=[("Q1", "ramen", 5, 0)],
            search_rows=[],
            render_types={},
        )
        result = self._run(cur, categories=["Q9"])
        self.assertEqual([c["category_id"] for c in result["categories"]], ["Q9"])

    def test_pages_multiply_the_number_of_search_queries(self):
        """1 ページぶんの «0 件» を «返っていない» と読まないための引き直し。"""
        cur = FakeCursor(
            pool=[("stored", 5, 2, 1)],
            categories=[("Q1", "ramen", 5, 1)],
            search_rows=[("Q1", "m1", "r1")],
            render_types={"m1": "external_embed"},
        )
        result = self._run(cur, pages=3)
        seed_index = self.names.index("pageSeed")
        seeds = [
            params[seed_index]
            for sql, params in cur.executed
            if params is not None and len(params) == len(self.names)
        ]
        self.assertEqual(seeds, m.page_seeds(3))
        self.assertEqual(result["no_category"]["rows"], 3)

    def test_max_categories_truncation_is_logged(self):
        """黙って切らない。切ったことが出力に残ること。"""
        cur = FakeCursor(
            pool=[("stored", 9, 3, 3)],
            categories=[(f"Q{i}", f"c{i}", 9 - i, 0) for i in range(3)],
            search_rows=[],
            render_types={},
        )
        with self.assertLogs(m.logger, level="INFO") as logs:
            result = self._run(cur, max_categories=2)
        self.assertEqual(result["categories_not_measured"], 1)
        self.assertTrue(any("測っていない" in line for line in logs.output))


if __name__ == "__main__":
    unittest.main()
