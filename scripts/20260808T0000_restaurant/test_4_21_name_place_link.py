"""#1947 «確定していない店を投稿へ貼る» を二度と起こさないための固定。

このステップは **誤帰属がそのまま配信に出る**（貼った seed は `post_store_cte_sql` の
候補になり、9_1 が dish_media を作る）。4_18 の実測精度 95.0% が成り立つのは
`decision='city_box_unique_strict'` に限った話で、判定を緩めた場合は自動照合の精度が
79% → 64% まで落ちている（4_18 の module docstring）。**緩める変更を黙って通さない**
ためのテストである。

固定するのは «欠陥のパターン» であって個別の値ではない。

| # | パターン | ここで固定する形 |
| --- | --- | --- |
| a | strict 以外の decision を «たぶんこれ» として拾う | 判定関数も SQL も strict しか見ない |
| b | 収集時に分かっている店を、名前由来の店で上書きする | SELECT 側と UPDATE 側の両方にガード |
| c | 1 投稿に 2 店当たったのに片方を選ぶ | 判定関数も UPDATE も «決まらないなら書かない» |
| d | 看板（アカウント/サイト）の投稿へ後入れして、その看板の他の投稿の seed を殺す | identity key を持つ経路を除外 |

d は #1846 の `post_store_cte_sql` を読んで見つけたもの。同じ看板が 2 店以上を指すと
**その看板の seed が全部捨てられる**ので、後入れは «1 投稿を足して数十投稿を殺す» ことが
できてしまう。
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
            key: resolver.NameKey = KEY) -> dict:
    return {"store_name": key.store_name, "area_pref": key.pref, "area_city": key.city,
            "google_place_id": place_id, "decision": decision,
            "algorithm_version": resolver.ALGORITHM_VERSION}


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
        # 4_18 が捨てた理由を 1 つずつ。どれも «決まらなかった» であって «たぶんこれ» ではない
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
        self.assertIn("HAVING COUNT(DISTINCT google_place_id) = 1", linker.BACKFILL_SQL)


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


class ProvenanceIsKeptTest(unittest.TestCase):
    """出所を混ぜない・収集の情報を消さない。"""

    def test_backfill_marks_this_route_with_its_own_seed_source(self) -> None:
        self.assertEqual("name_place_lookup", linker.SEED_SOURCE)
        self.assertIn("seed_source = m.seed_source", linker.BACKFILL_SQL)
        # 台帳の規則 → seed_source の対応は SQL の中だけで決まる（写経を 2 箇所に置かない）
        self.assertIn("IF(link_rule = @box_one_rule, @seed_source_box_one, @seed_source)",
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


if __name__ == "__main__":
    unittest.main()
