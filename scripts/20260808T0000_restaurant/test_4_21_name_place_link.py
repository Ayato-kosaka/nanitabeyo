"""#1947 «確定していない店を投稿へ貼る» を二度と起こさないための固定。

このステップは **誤帰属がそのまま配信に出る**（貼った seed は `post_store_cte_sql` の
候補になり、9_1 が dish_media を作る）。4_18 の実測精度 95.0% が成り立つのは
`decision='city_box_unique_strict'` に限った話で、判定を緩めた場合は自動照合の精度が
79% → 64% まで落ちている（4_18 の module docstring）。**緩める変更を黙って通さない**
ためのテストである。

固定するのは «欠陥のパターン» であって個別の値ではない。

| # | パターン | ここで固定する形 |
| --- | --- | --- |
| a | 使ってよい decision 以外を «たぶんこれ» として拾う | 判定関数も SQL も 2 つの規則しか見ない |
| b | 収集時に分かっている店を、名前由来の店で上書きする | SELECT 側と UPDATE 側の両方にガード |
| c | 1 投稿に 2 店当たったのに片方を選ぶ | 判定関数も UPDATE も «決まらないなら書かない» |
| d | 看板（アカウント/サイト）の投稿へ後入れして、その看板の他の投稿の seed を殺す | identity key を持つ経路を除外 |
| e | 箱の候補が複数残っているのに «飲食店っぽい方» を選ぶ | catalog に居る候補が **ちょうど 1 件**のときだけ採る |

d は #1846 の `post_store_cte_sql` を読んで見つけたもの。同じ看板が 2 店以上を指すと
**その看板の seed が全部捨てられる**ので、後入れは «1 投稿を足して数十投稿を殺す» ことが
できてしまう。

e は `city_box_not_unique`（矩形の中に同名が 2 件以上）を救う規則
（`box_one_in_catalog`）に対する固定である。救ってよいのは «候補のうち
`restaurant_catalog` に居るのが 1 件だけ» のときだけで、**0 件（飲食店として知らない）と
2 件以上（決められない）は採らない**。ここを «catalog に居るものを優先して 1 件選ぶ» へ
緩めると、同名の別店を投稿へ貼る形が戻る。
"""

from __future__ import annotations

import importlib.util
import re
import sys
import unittest
from pathlib import Path

# google.cloud.bigquery の軽量スタブは conftest.py が 1 箇所で用意する

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "1276_place_id_free_poc"))

import common_sns  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "link_name_place_to_posts", HERE / "4_21_link_name_place_to_posts.py")
linker = importlib.util.module_from_spec(_spec)
sys.modules["link_name_place_to_posts"] = linker
_spec.loader.exec_module(linker)

resolver = linker.resolver
SOURCE = (HERE / "4_21_link_name_place_to_posts.py").read_text(encoding="utf-8")


def _executable_lines(text: str) -> str:
    """docstring とコメントを落として «実行される行» だけを返す。

    説明のために docstring へ書いた語（判定名・禁止した形）を、実装だと誤判定しないため。
    """
    return "\n".join(line for line in re.sub(r'""".*?"""', "", text, flags=re.S).splitlines()
                     if not line.strip().startswith("#"))


CODE = _executable_lines(SOURCE)

KEY = resolver.NameKey("なんどり", "東京都", "荒川区")
OTHER_KEY = resolver.NameKey("まぼろし亭", "東京都", "荒川区")


def _lookup(place_id: str, decision: str = resolver.DECISION_MATCHED,
            key: resolver.NameKey = KEY, catalog_box_place_ids: list | None = None) -> dict:
    return {"store_name": key.store_name, "area_pref": key.pref, "area_city": key.city,
            "google_place_id": place_id, "decision": decision,
            "catalog_box_place_ids": catalog_box_place_ids or [],
            "algorithm_version": resolver.ALGORITHM_VERSION}


def _box(catalog_box_place_ids: list, key: resolver.NameKey = KEY) -> dict:
    """4_18 が «矩形の中で一意にならなかった» と書いた行。

    `google_place_id` は NULL（4_18 が店を決めていない）。`catalog_box_place_ids` は
    `box_place_ids` のうち `restaurant_catalog` に居たものだけ（絞りは LOOKUP_SQL 側）。
    """
    return _lookup(None, linker.DECISION_BOX_NOT_UNIQUE, key, catalog_box_place_ids)


def _link(keys, lookup_rows, *, identity_route_posts=frozenset()):
    return linker.build_link_rows(keys, lookup_rows, identity_route_posts=identity_route_posts,
                                  run_id="test-run", linked_at="2026-09-10T00:00:00+00:00")


class OnlyStrictDecisionIsUsedTest(unittest.TestCase):
    """(a) 4_18 が «決められなかった» と書いた行を、貼る側が拾い直さない。"""

    def test_strict_decision_is_linked(self) -> None:
        rows, stats = _link({KEY: {"post_ids": ["P1"], "name_source": "pin"}},
                            [_lookup("PLACE_A")])
        self.assertEqual(["P1"], [r["post_id"] for r in rows])
        self.assertEqual("PLACE_A", rows[0]["google_place_id"])
        self.assertEqual(1, stats["matched_keys"])

    def test_every_rejected_decision_is_ignored(self) -> None:
        # 4_18 が捨てた理由を 1 つずつ。どれも «決まらなかった» であって «たぶんこれ» ではない。
        # `city_box_not_unique` だけは箱の規則で救う «場合がある» が、それは catalog に
        # 候補が居るときだけ（ここでは 0 件）。素の decision では今までどおり 1 件も採らない
        for decision in ("city_box_not_unique", "no_candidate_in_city_box",
                         "area_query_empty", "area_query_not_unique", "probes_disagree",
                         "probe_missing", "api_error"):
            with self.subTest(decision=decision):
                rows, stats = _link({KEY: {"post_ids": ["P1"], "name_source": "pin"}},
                                    [_lookup("PLACE_A", decision)])
                self.assertEqual([], rows, f"{decision} を貼ってしまっている")
                self.assertEqual(1, stats["non_strict"])

    def test_strict_row_without_a_place_id_is_not_linked(self) -> None:
        rows, _ = _link({KEY: {"post_ids": ["P1"], "name_source": "pin"}},
                        [_lookup(""), _lookup(None)])
        self.assertEqual([], rows)

    def test_lookup_query_also_filters_on_the_same_constant(self) -> None:
        """SQL 側の絞りも 4_18 の定数を通す（文字列を書き写すと片方だけ古くなる）。"""
        self.assertIn("WHERE decision IN UNNEST(@decisions)", linker.LOOKUP_SQL)
        self.assertIn("resolver.DECISION_MATCHED", CODE)
        self.assertNotIn("city_box_unique_strict", CODE)

    def test_lookup_query_reads_only_the_two_decisions_the_linker_uses(self) -> None:
        """SQL が読む decision は、判定関数が使う 2 つと同じであること。

        SQL 側だけに 3 つ目を足すと «判定関数は捨てるのに読んでいる» 行が増え、
        逆に SQL 側だけ減らすと «判定関数は使うつもりなのに来ない» 規則ができる。
        """
        source = re.search(r'"decisions", "STRING", (\[[^\]]*\])', SOURCE).group(1)
        self.assertEqual("[resolver.DECISION_MATCHED, DECISION_BOX_NOT_UNIQUE]",
                         " ".join(source.split()))


class ExistingSeedIsNeverOverwrittenTest(unittest.TestCase):
    """(b) 収集時に分かっている店の方が強い。名前由来の店で上書きしない。"""

    def test_target_posts_come_from_4_18_scope(self) -> None:
        """対象集合は 4_18 の POSTS_SQL（seed が空・resolve でも店が付いていない投稿）。

        こちらで SQL を書き直すと «Google へ聞いた投稿» と «貼る投稿» がずれる。
        """
        self.assertIn("resolver.load_posts(loader, pipeline)", SOURCE)
        self.assertIn("(r.seed_place_id IS NULL OR r.seed_place_id = '')", resolver.POSTS_SQL)
        self.assertIn("(v.google_place_id IS NULL OR v.google_place_id = '')",
                      resolver.POSTS_SQL)

    def test_update_refuses_to_overwrite_an_existing_seed(self) -> None:
        # SELECT 側のガードだけでは守られない（選んでから書くまでの間に別ジョブが埋める）
        self.assertIn("(r.discovery_seed_place_id IS NULL OR r.discovery_seed_place_id = '')",
                      linker.BACKFILL_SQL)


class AmbiguousPostIsDroppedTest(unittest.TestCase):
    """(c) 1 投稿に 2 店なら書かない。«決まらない» は «間違えて入れる» より良い。"""

    def test_two_stores_on_one_post_are_dropped(self) -> None:
        keys = {KEY: {"post_ids": ["P1", "P2"], "name_source": "pin"},
                OTHER_KEY: {"post_ids": ["P1"], "name_source": "quoted"}}
        rows, stats = _link(keys, [_lookup("PLACE_A", key=KEY),
                                   _lookup("PLACE_B", key=OTHER_KEY)])
        self.assertEqual(["P2"], [r["post_id"] for r in rows], "2 店当たった P1 を貼っている")
        self.assertEqual(1, stats["ambiguous_posts"])

    def test_same_place_from_two_keys_is_still_linked(self) -> None:
        # «2 つの名前が同じ店を指した» のは曖昧ではない
        keys = {KEY: {"post_ids": ["P1"], "name_source": "pin"},
                OTHER_KEY: {"post_ids": ["P1"], "name_source": "quoted"}}
        rows, stats = _link(keys, [_lookup("PLACE_A", key=KEY),
                                   _lookup("PLACE_A", key=OTHER_KEY)])
        self.assertEqual(["P1"], [r["post_id"] for r in rows])
        self.assertEqual(0, stats["ambiguous_posts"])

    def test_one_key_with_two_places_is_not_used_at_all(self) -> None:
        """判定を変えた再実行が同じキーへ別の place_id を書き残していることがある。

        «新しい方» を選ぶ根拠はこちらには無いので、そのキーは丸ごと使わない。
        """
        rows, stats = _link({KEY: {"post_ids": ["P1"], "name_source": "pin"}},
                            [_lookup("PLACE_A"), _lookup("PLACE_B")])
        self.assertEqual([], rows)
        self.assertEqual(1, stats["ambiguous_keys"])
        self.assertEqual(0, stats["matched_keys"])

    def test_update_also_drops_a_post_that_has_two_places_in_the_ledger(self) -> None:
        # 台帳は追記なので、同じ投稿が複数行あり得る。書く側にも同じ判定を置く
        self.assertIn("HAVING COUNT(DISTINCT k.google_place_id) = 1", linker.BACKFILL_SQL)


class IdentityRouteIsExcludedTest(unittest.TestCase):
    """(d) 看板の identity key を持つ経路へ後入れしない（#1846 を壊さない）。"""

    def test_identity_route_post_is_not_linked(self) -> None:
        rows, stats = _link({KEY: {"post_ids": ["P1", "P2"], "name_source": "pin"}},
                            [_lookup("PLACE_A")], identity_route_posts={"P1"})
        self.assertEqual(["P2"], [r["post_id"] for r in rows])
        self.assertEqual(1, stats["identity_route_posts"])

    def test_update_also_excludes_those_routes(self) -> None:
        self.assertIn("r.discovery_route NOT IN UNNEST(@identity_routes)", linker.BACKFILL_SQL)
        self.assertIn("SEED_IDENTITY_ROUTES", SOURCE)

    def test_route_list_matches_the_identity_key_case(self) -> None:
        """経路の一覧は `SEED_IDENTITY_KEY_SQL` の WHEN 節と 1:1 であること。

        片方だけ増えると «identity key を持つのに除外されない経路» が生まれ、
        後入れが他の投稿の seed を殺す形が黙って戻る。
        """
        for route in common_sns.SEED_IDENTITY_ROUTES:
            self.assertIn(f"'{route}'", common_sns.SEED_IDENTITY_KEY_SQL)
        self.assertEqual(len(common_sns.SEED_IDENTITY_ROUTES),
                         common_sns.SEED_IDENTITY_KEY_SQL.count("WHEN "))


class BoxOneInCatalogTest(unittest.TestCase):
    """(e) 箱の候補のうち catalog に居るのが «ちょうど 1 件» のときだけ採る。

    固定するのは «1 件のときだけ» という形そのものである。«catalog に居る方を優先して
    1 件選ぶ» «一番近い方を採る» のような «選び方» へ緩めると、同名の別店を貼る形が戻る。
    """

    def test_two_candidates_in_the_catalog_are_not_linked(self) -> None:
        """(a) catalog に居る候補が 2 件以上なら採らない — どちらか決める根拠が無い。"""
        rows, stats = _link({KEY: {"post_ids": ["P1"], "name_source": "pin"}},
                            [_box(["PLACE_A", "PLACE_B"])])
        self.assertEqual([], rows, "catalog に 2 件あるのに片方を選んでいる")
        self.assertEqual(1, stats["box_many_in_catalog"])
        self.assertEqual(0, stats["box_one_keys"])

    def test_many_candidates_in_the_catalog_are_not_linked(self) -> None:
        # 2 件で止めない（3 件・5 件でも «たまたま先頭» を採らないこと）
        for size in (3, 5, 20):
            with self.subTest(candidates=size):
                rows, stats = _link({KEY: {"post_ids": ["P1"], "name_source": "pin"}},
                                    [_box([f"PLACE_{i}" for i in range(size)])])
                self.assertEqual([], rows)
                self.assertEqual(1, stats["box_many_in_catalog"])

    def test_no_candidate_in_the_catalog_is_not_linked(self) -> None:
        """(b) 0 件なら採らない — 箱の中に同名が複数あり、どれも飲食店として知らない。"""
        for candidates in ([], [""], None):
            with self.subTest(candidates=candidates):
                rows, stats = _link({KEY: {"post_ids": ["P1"], "name_source": "pin"}},
                                    [_box(candidates)])
                self.assertEqual([], rows)
                self.assertEqual(1, stats["box_zero_in_catalog"])
                self.assertEqual(0, stats["box_one_keys"])

    def test_exactly_one_candidate_in_the_catalog_is_linked(self) -> None:
        """(c) 1 件のときだけ採る。«飲食店として知っているのが 1 件» が採用の理由である。"""
        rows, stats = _link({KEY: {"post_ids": ["P1", "P2"], "name_source": "pin"}},
                            [_box(["PLACE_A"])])
        self.assertEqual(["P1", "P2"], [r["post_id"] for r in rows])
        self.assertEqual(["PLACE_A", "PLACE_A"], [r["google_place_id"] for r in rows])
        self.assertEqual(1, stats["box_one_keys"])
        self.assertEqual(2, stats["linked_posts_box_one"])

    def test_the_two_rules_are_never_mixed_in_the_ledger(self) -> None:
        """どちらの規則で決まった店かが 1 行ごとに残る（混ぜると巻き戻せない）。"""
        rows, _ = _link({KEY: {"post_ids": ["P1"], "name_source": "pin"},
                         OTHER_KEY: {"post_ids": ["P2"], "name_source": "quoted"}},
                        [_lookup("PLACE_A", key=KEY), _box(["PLACE_B"], key=OTHER_KEY)])
        self.assertEqual({"P1": resolver.DECISION_MATCHED, "P2": "box_one_in_catalog"},
                         {r["post_id"]: r["link_rule"] for r in rows})
        self.assertEqual("box_one_in_catalog", linker.LINK_RULE_BOX_ONE)
        self.assertEqual(resolver.DECISION_MATCHED, linker.LINK_RULE_STRICT)

    def test_the_union_across_rows_must_still_be_one(self) -> None:
        """同じキーの行が 2 本あり、合わせると 2 店になるなら採らない。

        判定を変えた再実行が同じキーへ別の候補を書き残していることがある。
        行ごとに «1 件» を見ると、run が違うだけの 2 店から片方を選んでしまう。
        """
        rows, stats = _link({KEY: {"post_ids": ["P1"], "name_source": "pin"}},
                            [_box(["PLACE_A"]), _box(["PLACE_B"])])
        self.assertEqual([], rows)
        self.assertEqual(1, stats["box_many_in_catalog"])

    def test_strict_wins_over_the_box_rule_on_the_same_key(self) -> None:
        # 強い方（4_18 が確定させた店）を、緩い方で上書きしない
        rows, _ = _link({KEY: {"post_ids": ["P1"], "name_source": "pin"}},
                        [_lookup("PLACE_A"), _box(["PLACE_B"])])
        self.assertEqual(["PLACE_A"], [r["google_place_id"] for r in rows])
        self.assertEqual(resolver.DECISION_MATCHED, rows[0]["link_rule"])

    def test_a_key_strict_called_ambiguous_is_not_rescued_by_the_box_rule(self) -> None:
        """strict が «1 キー 2 店» で捨てたキーを、緩い方で救い直さない。"""
        rows, stats = _link({KEY: {"post_ids": ["P1"], "name_source": "pin"}},
                            [_lookup("PLACE_A"), _lookup("PLACE_B"), _box(["PLACE_C"])])
        self.assertEqual([], rows)
        self.assertEqual(1, stats["ambiguous_keys"])
        self.assertEqual(0, stats["box_one_keys"])

    def test_the_box_rule_obeys_the_two_stores_per_post_guard(self) -> None:
        # 新しい規則で来た店も «1 投稿 2 店なら書かない» を通る
        keys = {KEY: {"post_ids": ["P1", "P2"], "name_source": "pin"},
                OTHER_KEY: {"post_ids": ["P1"], "name_source": "quoted"}}
        rows, stats = _link(keys, [_box(["PLACE_A"], key=KEY),
                                   _lookup("PLACE_B", key=OTHER_KEY)])
        self.assertEqual(["P2"], [r["post_id"] for r in rows])
        self.assertEqual(1, stats["ambiguous_posts"])

    def test_the_box_rule_obeys_the_identity_route_exclusion(self) -> None:
        rows, stats = _link({KEY: {"post_ids": ["P1", "P2"], "name_source": "pin"}},
                            [_box(["PLACE_A"])], identity_route_posts={"P1"})
        self.assertEqual(["P2"], [r["post_id"] for r in rows])
        self.assertEqual(1, stats["identity_route_posts"])

    def test_4_18_still_returns_the_decision_this_rule_keys_on(self) -> None:
        """4_18 の判定関数を実際に呼んで «この decision を今も返すか» を確かめる。

        4_18 側は文字列リテラルで定数になっていない。写した値が古くなっても例外は
        出ず、**この規則が黙って 1 件も拾わなくなる**（catalog を引く SQL も空を返す）。
        沈黙する壊れ方なので、値そのものではなく «4_18 の出力と一致すること» を固定する。
        """
        box = resolver.SearchResult(place_ids=("PLACE_A", "PLACE_B"), http_status=200)
        area = resolver.SearchResult(place_ids=("PLACE_A",), http_status=200)
        self.assertEqual(linker.DECISION_BOX_NOT_UNIQUE,
                         resolver.decide_name_match(box, area).decision)

    def test_the_catalog_is_what_narrows_the_candidates(self) -> None:
        """候補を絞る辞書は `restaurant_catalog`（配信に出る店の全体）であること。

        ここを別の表（seed / source_records）にすると «こちらが飲食店として
        知っている» の意味が変わり、配信に出せない place_id を貼り始める。
        """
        self.assertIn("restaurant_catalog", linker.TABLE_CATALOG)
        self.assertIn("FROM `__CATALOG__`", linker.LOOKUP_SQL)
        self.assertIn("WHERE run_id = @catalog_run_id AND google_place_id IS NOT NULL",
                      linker.LOOKUP_SQL)
        # 箱の候補を catalog で絞るのは JOIN 側の仕事（Python へ catalog 全件を持ってこない）
        self.assertIn("CROSS JOIN UNNEST(l.box_place_ids) AS p", linker.LOOKUP_SQL)
        self.assertIn("JOIN catalog c ON c.pid = p", linker.LOOKUP_SQL)
        self.assertIn("WHERE l.decision = @box_not_unique", linker.LOOKUP_SQL)

    def test_the_rule_can_be_rolled_back_on_its_own(self) -> None:
        """新しい規則で入れた seed だけを後から選べること（混ぜたら巻き戻せない）。"""
        self.assertEqual("name_place_box_one_in_catalog", linker.SEED_SOURCE_BOX_ONE)
        self.assertNotEqual(linker.SEED_SOURCE, linker.SEED_SOURCE_BOX_ONE)
        self.assertIn("link_rule", linker.CREATE_LINK_TABLE_SQL)
        # 台帳は既にあるので、列は ALTER で足さないと load が落ちる
        self.assertIn("ADD COLUMN IF NOT EXISTS link_rule STRING", linker.ALTER_LINK_TABLE_SQL)
        self.assertIn("pipeline.execute(ALTER_LINK_TABLE_SQL", SOURCE)

    def test_update_refuses_a_post_whose_ledger_rows_disagree_on_the_rule(self) -> None:
        # 台帳は追記。1 投稿に 2 規則が並んだら «どちらの seed_source か» が決まらない
        self.assertIn("COUNT(DISTINCT IFNULL(k.link_rule, @strict_rule)) = 1", linker.BACKFILL_SQL)

    def test_applied_count_is_measured_per_rule(self) -> None:
        # 片方が 0 件なら «その規則が 1 件も通っていない» と分かる（合計だけだと隠れる）
        self.assertIn("GROUP BY r.seed_source", linker.APPLIED_COUNT_SQL)
        self.assertIn("r.seed_source IN UNNEST(@seed_sources)", linker.APPLIED_COUNT_SQL)


class ProvenanceIsKeptTest(unittest.TestCase):
    """出所を混ぜない・収集の情報を消さない。"""

    def test_backfill_marks_this_route_with_its_own_seed_source(self) -> None:
        self.assertEqual("name_place_lookup", linker.SEED_SOURCE)
        self.assertIn("seed_source = m.seed_source", linker.BACKFILL_SQL)
        # 台帳の規則 → seed_source の対応は SQL の中だけで決まる（写経を 2 箇所に置かない）
        self.assertIn("IF(k.link_rule = @box_one_rule, @seed_source_box_one, @seed_source)",
                      linker.BACKFILL_SQL)

    def test_backfill_never_touches_the_discovery_columns(self) -> None:
        """«どうやって見つけたか» を «店をどう決めたか» で上書きしない（4_0b の設計）。"""
        set_clause = re.search(r"\bSET\b(.*?)\bFROM\b", " ".join(linker.BACKFILL_SQL.split()),
                               re.I).group(1)
        self.assertNotIn("discovery_method", set_clause)
        self.assertNotIn("discovery_route", set_clause)
        self.assertNotIn("discovery_query", set_clause)
        self.assertNotIn("caption", set_clause)
        self.assertRegex(set_clause.strip(),
                         r"^discovery_seed_place_id = m\.google_place_id, seed_source = m\.seed_source$")

    def test_link_row_carries_the_algorithm_version_of_the_lookup(self) -> None:
        rows, _ = _link({KEY: {"post_ids": ["P1"], "name_source": "pin"}},
                        [_lookup("PLACE_A")])
        self.assertEqual(resolver.ALGORITHM_VERSION, rows[0]["algorithm_version"])
        self.assertEqual("pin", rows[0]["name_source"])

    def test_ledger_is_append_only(self) -> None:
        """run 単位の DELETE で «貼った記録» を消さない。

        途中で落ちた run を再実行すると、既に seed を埋めた投稿は対象集合から外れる。
        そこで台帳を消すと «seed_source は立っているのに貼った記録が無い» 投稿ができる。
        """
        self.assertNotIn("delete_run_rows", SOURCE)
        self.assertNotIn("DELETE FROM", SOURCE)


class WritesAreOptInTest(unittest.TestCase):
    """既定では 1 行も書かない。刻めること。"""

    def test_execute_is_required_to_write(self) -> None:
        self.assertIn('"--execute", action="store_true"', SOURCE)
        self.assertIn("if args.dry_run or not args.execute:", SOURCE)

    def test_limit_slices_the_posts_that_get_linked(self) -> None:
        # 4_18 の --limit は «読む投稿» の上限。こちらは «貼る投稿» の上限で、
        # 貼った投稿は次の run の対象から外れるので繰り返すと先へ進む
        self.assertIn("rows = rows[: args.limit]", SOURCE)
        self.assertIn("loader = SimpleNamespace", SOURCE)
        self.assertIn("limit=0", SOURCE)

    def test_link_rows_are_ordered_deterministically(self) -> None:
        keys = {KEY: {"post_ids": ["P3", "P1", "P2"], "name_source": "pin"}}
        rows, _ = _link(keys, [_lookup("PLACE_A")])
        self.assertEqual(["P1", "P2", "P3"], [r["post_id"] for r in rows])

    def test_dml_goes_through_the_retrying_path(self) -> None:
        # sns_post_raw は収集ジョブが裏で append している（同時更新の 400 に耐える）
        self.assertIn("pipeline.execute_dml_retrying(backfill_sql(pipeline)", SOURCE)

    def test_applied_count_is_measured_not_assumed(self) -> None:
        # «流したから入ったはず» を報告しない（実際に seed が入った投稿を数える）
        self.assertIn("def count_applied(", SOURCE)
        self.assertIn("COUNT(DISTINCT r.post_id) AS applied", linker.APPLIED_COUNT_SQL)


class NoExternalApiTest(unittest.TestCase):
    """このステップは Google も Instagram も 1 回も叩かない。"""

    def test_no_http_client_is_constructed(self) -> None:
        # 4_18 を import するので Google の client は «手の届くところ» にある。
        # 呼ぶ形が 1 つでも入ったら、このステップは無料ではなくなる
        for forbidden in ("FreePlacesClient(", "search_text(", "requests.",
                          "urllib.request", "ProbeCache("):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, CODE, f"外部 API を叩く形が入っている: {forbidden}")

    def test_resolve_api_is_not_called_either(self) -> None:
        self.assertNotIn("mint_service_jwt", CODE)
        self.assertNotIn("backend_base_url", CODE)


class HavingNeverReadsASelectAliasTest(unittest.TestCase):
    """f: HAVING が SELECT の別名を指して、UPDATE «だけ» が黙って落ちる形を禁じる。

    2026-09-10 の事故。BACKFILL_SQL がこう書かれていた。

        SELECT post_id, ANY_VALUE(google_place_id) AS google_place_id
        ...
        HAVING COUNT(DISTINCT google_place_id) = 1

    BigQuery の HAVING は **SELECT の別名を先に見る**ので、`google_place_id` は
    元の列ではなく `ANY_VALUE(...)` を指し、«Aggregations of aggregations are not
    allowed» で UPDATE だけが 400 になる。台帳への書き込みはその手前で成功しているから、
    ログの途中には «貼れる投稿 30,834 件» と出る。**成果があったように読める**。
    実際には `sns_post_raw` の seed は 1 件も増えていなかった（実測: 1,261,038 行中
    `seed_source` が入っている行は 0 件）。

    同じ罠は `common_sns.post_store` にも注意書きがある（あちらは候補列を `cand_place` へ
    改名して避けている）。値ではなく **«HAVING の列は必ず修飾する»** という形で固定する。
    """

    #: `AS <名前>` / `) <名前>` で付く別名
    ALIAS_RE = re.compile(r"\bAS\s+([A-Za-z_][A-Za-z0-9_]*)", re.I)
    #: HAVING 節（次の主要な節、または末尾まで）
    HAVING_RE = re.compile(
        r"\bHAVING\b(.*?)(?=\b(?:SELECT|FROM|WHERE|GROUP\s+BY|ORDER\s+BY|LIMIT|UNION|\))\b|$)",
        re.I | re.S)
    #: 修飾されていない裸の識別子（`k.col` の col と `@param` は除く）
    BARE_RE = re.compile(r"(?<![.@\w])([a-z_][a-z0-9_]*)\b")

    #: SQL の予約語・関数名。裸で出てよい
    SQL_WORDS = frozenset("""
        and or not in is null distinct count sum min max any_value ifnull coalesce if
        between like cast as true false unnest array struct safe_cast
    """.split())

    def _sql_constants(self) -> dict:
        import re as _re
        found = {}
        for match in _re.finditer(r'^([A-Z0-9_]*SQL[A-Z0-9_]*)\s*=\s*"""(.*?)"""',
                                  SOURCE, _re.S | _re.M):
            found[match.group(1)] = match.group(2)
        self.assertIn("BACKFILL_SQL", found, "読み取りが空振りしている（SQL 定数が拾えていない）")
        return found

    def test_every_having_column_is_qualified_or_not_an_alias(self) -> None:
        for name, sql in self._sql_constants().items():
            # コメント行を落とす（説明文の中の語を «実装» と誤判定しないため）
            body = "\n".join(line for line in sql.splitlines()
                              if not line.strip().startswith("--"))
            aliases = {a.lower() for a in self.ALIAS_RE.findall(body)}
            for having in self.HAVING_RE.findall(body):
                for ident in self.BARE_RE.findall(having):
                    if ident in self.SQL_WORDS:
                        continue
                    with self.subTest(sql=name, ident=ident):
                        self.assertNotIn(
                            ident, aliases,
                            f"{name} の HAVING が SELECT の別名 `{ident}` を指す。"
                            "テーブル別名で修飾するか、別名の方を改名すること")

    def test_backfill_having_is_qualified(self) -> None:
        """上の一般則が «HAVING が 1 つも見つからない» で空振りしていないことを確かめる。"""
        body = linker.BACKFILL_SQL
        havings = self.HAVING_RE.findall(body)
        self.assertTrue(havings, "BACKFILL_SQL の HAVING が拾えていない")
        self.assertIn("COUNT(DISTINCT k.google_place_id)", body,
                      "HAVING の列が修飾されていない（別名を指して 400 になる形）")


class ZeroAppliedIsNotSuccessTest(unittest.TestCase):
    """g: 台帳に貼ったのに sns_post_raw が 1 件も変わらなかった run を、成功で終わらせない。

    上の事故が 2 日ぶん見過ごされたのは、UPDATE が落ちたことではなく
    **書いた先を数えていなかった**ことによる。`count_applied` は存在したのに、
    合計 0 でもそのまま return していた。
    """

    def test_main_raises_when_nothing_was_applied(self) -> None:
        self.assertIn("sum(applied.values()) == 0", CODE,
                      "貼った件数が 0 のときに落とすガードが無い")
        self.assertIn("raise SystemExit", CODE)


if __name__ == "__main__":
    unittest.main()
