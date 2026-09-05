"""#1846 «1 つの投稿が 2 店以上に紐づく» を二度と戻さないための固定。

BigQuery へは繋がない。固定するのは «壊れても実行は成功してしまう» 契約だけ。

欠陥をパターンで言い直すと **«収集経路が示すのは「どの店の看板の下で見つけたか」で
あって「どの店の投稿か」ではない。看板が複数店で共有されているとき、その 2 つはずれる»**。
実測（sns-catalog-2026-09-05 / 142,489 行）ではこの形で 1,388 投稿が 2 店以上に紐づき、
どちらが出るかは place_id の辞書順で決まっていた。個別の値ではなく **この形**を固定する。

1. `post_store_cte_sql` が «看板の共有度» で seed を落とす条件を持っていること
2. 1 投稿に候補が 2 店以上残ったら **配信しない**（`HAVING ... = 1`）こと
3. 共有度の集計を run で絞っていないこと（run を絞ると共有に気づけない）
4. 配る側（9_1）と数える側（7_1）が **同じ判定**を使っていること
   （どちらかが `STORE_ID_ANY_SQL` に戻ったら失敗する）
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

# google.cloud.bigquery の軽量スタブは conftest.py が 1 箇所で用意する
# （各テストへ写経すると «先に入れた者勝ち» で実行順に依存して落ちる）。

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import common_sns  # noqa: E402


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


class PostStoreCteTest(unittest.TestCase):
    """`common_sns.post_store_cte_sql` の «契約»。"""

    def setUp(self) -> None:
        self.sql = common_sns.post_store_cte_sql(
            "proj.ds.sns_post_raw", latest_cte="v", runs_param="srcs")

    def test_identity_key_covers_both_single_store_routes(self) -> None:
        # 看板が «1 店を名乗る» のはこの 2 経路だけ。第三者ページ（cc_wat 等）は
        # ホストが多数の店を指すのが当たり前なので identity key を持たせない。
        self.assertIn("'store_account'", common_sns.SEED_IDENTITY_KEY_SQL)
        self.assertIn("'store_site_embed'", common_sns.SEED_IDENTITY_KEY_SQL)
        self.assertIn("ELSE NULL", common_sns.SEED_IDENTITY_KEY_SQL)

    def test_www_is_normalised_in_identity_key(self) -> None:
        # 実測で `hachibei.com` と `www.hachibei.com` が別ドメイン扱いになっていた
        self.assertIn(r"'^www\.'", common_sns.SEED_IDENTITY_KEY_SQL)

    def test_shared_signboard_seed_is_dropped(self) -> None:
        """2 店以上を指す看板の seed は候補にしない。"""
        self.assertIn("COUNT(DISTINCT place_id) AS n_place", self.sql)
        self.assertIn("IFNULL(k.n_place, 0) <= 1", self.sql)

    def test_identity_share_is_counted_across_all_runs(self) -> None:
        """共有度の集計だけは run で絞らない（絞ると «この run では 1 店» で見逃す）。"""
        head = self.sql[self.sql.index("seed_identity AS ("):self.sql.index("identity_place_count")]
        self.assertNotIn("run_id", head)
        # 候補の側は run で絞る（呼び出し側が渡した場合）
        self.assertIn("r.run_id IN UNNEST(@srcs)", self.sql)

    def test_runs_param_is_optional(self) -> None:
        no_runs = common_sns.post_store_cte_sql(
            "proj.ds.sns_post_raw", latest_cte="latest", runs_param=None)
        self.assertNotIn("UNNEST(@", no_runs)

    def test_ambiguous_post_is_dropped_not_guessed(self) -> None:
        """候補が 1 店に絞れない投稿は落とす（間違った店に付けるより落とす）。"""
        self.assertIn("HAVING COUNT(DISTINCT cand_place) = 1", self.sql)

    def test_having_does_not_collide_with_aggregate_alias(self) -> None:
        """HAVING は SELECT の別名を先に見る。候補列に集計列と同じ名前を付けない。

        `HAVING COUNT(DISTINCT google_place_id)` と書くと `ANY_VALUE(...)` を指して
        BigQuery が «Aggregations of aggregations are not allowed» で落ちる。
        """
        self.assertIn("ANY_VALUE(cand_place) AS google_place_id", self.sql)
        # コメント行にはこの «やってはいけない形» を書いてあるので、実行される SQL だけを見る
        code = "\n".join(l for l in self.sql.splitlines() if not l.strip().startswith("--"))
        self.assertNotIn("HAVING COUNT(DISTINCT google_place_id)", code)

    def test_seed_beats_resolve(self) -> None:
        """seed が 1 つでも使えるなら resolve の店照合は採らない（rank で決まる）。"""
        self.assertGreater(common_sns.RESOLVED_STORE_RANK, 3)
        self.assertIn("MIN(c.store_rank) OVER (PARTITION BY c.post_id)", self.sql)

    def test_store_account_beats_site_embed(self) -> None:
        """店自身のアカウント > 店の公式サイトの埋め込み > 第三者ページ。"""
        rank = common_sns.SEED_STORE_RANK_SQL
        self.assertLess(rank.index("'store_account'"), rank.index("'store_site_embed'"))
        self.assertIn("ELSE 3", rank)


class DeliverAndCountUseTheSameRuleTest(unittest.TestCase):
    """配る側（9_1）と数える側（7_1）がずれないこと。

    ここがずれると «カバレッジには計上されているのにアプリには出ないデータ» が生まれる。
    """

    def _source(self, filename: str) -> str:
        return (HERE / filename).read_text(encoding="utf-8")

    def test_catalog_builder_uses_post_store(self) -> None:
        src = self._source("9_1_build_sns_dish_media_catalog.py")
        self.assertIn("post_store_cte_sql(", src)
        self.assertIn("JOIN post_store ps ON ps.post_id = v.post_id", src)
        # 広い式に戻していないこと
        self.assertNotIn("STORE_ID_ANY_SQL", src)
        self.assertNotIn("STORE_KNOWN_ANY_SQL", src)

    def test_coverage_builder_uses_post_store(self) -> None:
        src = self._source("7_1_build_coverage.py")
        self.assertIn("post_store_cte_sql(", src)
        self.assertIn("JOIN post_store ps ON ps.post_id = v.post_id", src)
        self.assertNotIn("STORE_ID_ANY_SQL", src)
        self.assertNotIn("STORE_KNOWN_ANY_SQL", src)

    def test_catalog_builder_emits_one_row_per_post(self) -> None:
        """店もカテゴリも投稿ごとに 1 つなので、GROUP BY はこの 3 列で 1 行になる。"""
        src = self._source("9_1_build_sns_dish_media_catalog.py")
        self.assertIn("GROUP BY v.post_id, google_place_id, v.dish_category_id", src)

    def test_catalog_builder_reports_what_it_dropped(self) -> None:
        """落とした投稿を数えて run のログへ残す（黙って消えると次に調べ直しになる）。"""
        src = self._source("9_1_build_sns_dish_media_catalog.py")
        self.assertIn("dropped_ambiguous_posts", src)
        self.assertIn("dropped_shared_identity_posts", src)


class AuditCauseTest(unittest.TestCase):
    """原因分類（9_9_audit_multi_place_posts）の «壊れても実行は通る» ところ。"""

    def setUp(self) -> None:
        self.mod = _load(HERE / "9_9_audit_multi_place_posts.py", "audit_multi_place_posts")

    def test_cte_name_does_not_shadow_the_cause_column(self) -> None:
        """CTE 名を列名と同じ `cause` にしない。

        BigQuery は `GROUP BY cause` を «テーブル別名（STRUCT 全体）» と解釈するため、
        行ごとに 1 グループになり、集計が静かに壊れる（実際に起きた）。
        """
        class _P:
            def table(self, name: str) -> str:
                return f"proj.ds.{name}"

        sql = self.mod.breakdown_sql(_P())
        self.assertIn("post_cause AS (", sql)
        self.assertIn("FROM post_cause GROUP BY cause", sql)
        self.assertNotIn("FROM cause GROUP BY cause", sql)

    def test_all_causes_are_distinguished(self) -> None:
        for label in ("C1_ブランドサイト共有", "C2_複数ドメインに埋め込み",
                      "C3_ブランドアカウント共有", "C4_seedとresolveの食い違い"):
            self.assertIn(label, self.mod.CAUSE_CASE_SQL)


if __name__ == "__main__":
    unittest.main()
