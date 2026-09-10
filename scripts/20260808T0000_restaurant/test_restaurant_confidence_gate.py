"""#1947 «信頼度 0.35 の «たぶんこの店» が、0.99 の «確実にこの店» と同じ顔で出る» を戻さない固定。

欠陥をパターンで言い直すと **«判定材料を書いてはいるが、読む側が 1 つも無い»**。
`restaurant_confidence` は `5_1_apply_resolve.py` が毎行書いているのに、配信（9_1）・
同期（9_2）・計上（7_1）のどこにも閾値が無かった。現物（#1947 issuecomment-5611765586）:

| 信頼度 | 配信されていた店 | 投稿のキャプション | 判定 |
| --- | --- | --- | --- |
| 0.39 | **観音寺市民会館**（香川県観音寺市） | 「…店舗：洋食屋チン…」 | ❌ 飲食店ですらない |
| 0.42 | らーめん天（静岡県沼津市） | 「麺屋卓朗商店さんの15周年イベント！」 | ❌ 本文は別の店 |

⚠️ **もう半分のパターンが «ゲートを掛ける相手を間違える»** ことである。seed 由来
（柱1 店アカウント / 柱1-B 店サイト埋め込み / 第三者ページ）の行は **収集時点で店が
確定している**。その行の `restaurant_confidence` は «resolve がついでに店名照合を試みた
結果» であって、その行の店の確からしさではない。ここへ閾値を当てると、店が分かっている
投稿を «resolve が下手だった» という無関係な理由で落とすことになる。

固定するのは値ではなく **この形**:

  (a) resolve が店を決めた行（`store_rank` = 4）は、下限未満なら配信に乗らない
  (b) seed 由来の行（`store_rank` 1〜3）は、信頼度が低くても NULL でも落ちない
  (c) 閾値は `common_sns` の 1 箇所にしか無い

(a)(b) は文字列一致ではなく **実際に SQL を回して**確かめる（duckdb。BigQuery へは繋がない）。
`post_store` から通すので、«seed か resolve か» の分岐そのものが回帰対象になる。
"""

from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

import duckdb

# google.cloud.bigquery の軽量スタブは conftest.py が 1 箇所で用意する
# （各テストへ写経すると «先に入れた者勝ち» で実行順に依存して落ちる）。

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import common_sns  # noqa: E402


def _to_duckdb(sql: str) -> str:
    """BigQuery の SQL を duckdb で回せる **方言だけ**直す（判定は 1 文字も書き換えない）。

    - 識別子の引用符: `` ` `` → `"`
    - 生文字列リテラル: `r'^www\\.'` → `'^www\\.'`（duckdb は `r` 接頭辞を持たない）
    """
    return re.sub(r"(?<![A-Za-z0-9_])r'", "'", sql.replace("`", '"'))


class GateBehaviourTest(unittest.TestCase):
    """実際に SQL を回して «何が落ちて何が残るか» を見る。

    投稿は 7 本。resolve 由来 4 本（低 / NULL / 境界 / 高）と seed 由来 3 本（rank 1〜3）。
    """

    def setUp(self) -> None:
        self.con = duckdb.connect()
        self.con.execute("""
            CREATE TABLE raw(post_id VARCHAR, provider VARCHAR, discovery_route VARCHAR,
              account_id VARCHAR, discovery_query VARCHAR, discovery_seed_place_id VARCHAR)""")
        self.con.execute("""
            CREATE TABLE resolved(post_id VARCHAR, provider VARCHAR, status VARCHAR,
              google_place_id VARCHAR, dish_category_id VARCHAR,
              restaurant_confidence DOUBLE, resolved_at TIMESTAMP)""")
        # 収集側: seed を持つのは 3 本だけ（残りは resolve が店を当てるしかない）
        self.con.execute("""INSERT INTO raw VALUES
            ('p_low',   'instagram', NULL, NULL, NULL, NULL),
            ('p_null',  'instagram', NULL, NULL, NULL, NULL),
            ('p_edge',  'instagram', NULL, NULL, NULL, NULL),
            ('p_high',  'instagram', NULL, NULL, NULL, NULL),
            ('p_seed_account', 'instagram', 'store_account',    'acct_1', NULL, 'PLACE_SEED_A'),
            ('p_seed_site',    'instagram', 'store_site_embed', NULL, 'www.example.com',
             'PLACE_SEED_B'),
            ('p_seed_third',   'instagram', 'cc_wat_embed',     NULL, 'blog.example.com',
             'PLACE_SEED_C')""")
        # resolve 側: 観音寺市民会館の帯（0.39）・確からしさ不明（NULL）・境界（0.60）・高（0.95）
        self.con.execute("""INSERT INTO resolved VALUES
            ('p_low',   'instagram', 'matched', 'PLACE_KANNONJI', 'Q1', 0.39, '2026-09-05'),
            ('p_null',  'instagram', 'matched', 'PLACE_UNKNOWN',  'Q1', NULL, '2026-09-05'),
            ('p_edge',  'instagram', 'matched', 'PLACE_EDGE',     'Q1', 0.60, '2026-09-05'),
            ('p_high',  'instagram', 'matched', 'PLACE_GOOD',     'Q1', 0.95, '2026-09-05'),
            -- seed 由来の 3 本は «resolve が店名照合に失敗した / 別の店を指した» 状態にしてある。
            -- これで落ちるなら、ゲートを掛ける相手を間違えている。
            ('p_seed_account','instagram','matched','PLACE_ELSEWHERE','Q1', 0.35, '2026-09-05'),
            ('p_seed_site',   'instagram','skipped_no_store', NULL,  'Q1', NULL, '2026-09-05'),
            ('p_seed_third',  'instagram','matched','PLACE_SEED_C',  'Q1', 0.10, '2026-09-05')""")

    def _delivered(self, threshold: float = common_sns.MIN_RESTAURANT_CONFIDENCE) -> dict:
        """ゲートを通った投稿 → 店 を返す（9_1 が配信する行と同じ組み立て）。"""
        gate = common_sns.resolved_store_confidence_sql().replace("@min_conf", repr(threshold))
        sql = _to_duckdb(f"""
            WITH v AS (SELECT * FROM `resolved` {common_sns.LATEST_RESOLVED_QUALIFY}),
            {common_sns.post_store_cte_sql("raw", latest_cte="v", runs_param=None)}
            SELECT v.post_id, ps.google_place_id
            FROM v JOIN post_store ps ON ps.post_id = v.post_id
            WHERE v.dish_category_id IS NOT NULL AND {gate}
        """)
        return dict(self.con.execute(sql).fetchall())

    def _rows_with_gate_value(self, threshold: float) -> dict:
        gate = common_sns.resolved_store_confidence_sql().replace("@min_conf", repr(threshold))
        sql = _to_duckdb(f"""
            WITH v AS (SELECT * FROM `resolved` {common_sns.LATEST_RESOLVED_QUALIFY}),
            {common_sns.post_store_cte_sql("raw", latest_cte="v", runs_param=None)}
            SELECT v.post_id, {gate} AS keep
            FROM v JOIN post_store ps ON ps.post_id = v.post_id
        """)
        return dict(self.con.execute(sql).fetchall())

    def test_low_confidence_resolved_row_is_not_delivered(self) -> None:
        """(a) 観音寺市民会館の帯（0.39）は配信に乗らない。"""
        self.assertNotIn("p_low", self._delivered())

    def test_resolved_row_without_confidence_is_not_delivered(self) -> None:
        """確からしさが NULL の resolve 行も落とす（«確かめられなかった» は «高い» ではない）。"""
        self.assertNotIn("p_null", self._delivered())

    def test_threshold_is_inclusive_and_high_rows_survive(self) -> None:
        delivered = self._delivered()
        self.assertIn("p_edge", delivered, "境界ちょうど（0.60）は配信する")
        self.assertIn("p_high", delivered)

    def test_seed_rows_survive_low_or_missing_confidence(self) -> None:
        """(b) ★ seed 由来は、信頼度が低くても NULL でも落ちない。

        しかも店は **seed の店**が出る（resolve が別の店を指していても seed が勝つ）。
        ここが崩れると «収集時点で店が分かっている投稿» を無関係な理由で捨てることになる。
        """
        delivered = self._delivered()
        self.assertEqual(delivered.get("p_seed_account"), "PLACE_SEED_A",
                         "店アカウント seed（信頼度 0.35）を落とした")
        self.assertEqual(delivered.get("p_seed_site"), "PLACE_SEED_B",
                         "店サイト埋め込み seed（信頼度 NULL）を落とした")
        self.assertEqual(delivered.get("p_seed_third"), "PLACE_SEED_C",
                         "第三者ページの seed（信頼度 0.10）を落とした")

    def test_raising_the_threshold_only_moves_the_resolved_rows(self) -> None:
        """閾値を上げても seed 由来は動かない（動くなら掛ける相手を間違えている）。"""
        strict = self._delivered(0.70)
        self.assertNotIn("p_edge", strict, "0.70 に上げたのに 0.60 の行が残っている")
        self.assertIn("p_high", strict)
        for seeded in ("p_seed_account", "p_seed_site", "p_seed_third"):
            self.assertIn(seeded, strict, f"閾値を上げたら seed 由来 {seeded} が落ちた")

    def test_predicate_is_never_null(self) -> None:
        """述語が NULL を返さないこと。

        «落とした数» は `NOT (述語)` で数える。NULL が混ざると、落とした行が
        どちらにも数えられず **黙って消える**（そのための IS NOT NULL ガード）。
        """
        values = self._rows_with_gate_value(common_sns.MIN_RESTAURANT_CONFIDENCE)
        self.assertEqual(len(values), 7)
        self.assertNotIn(None, values.values(), f"述語が NULL を返した: {values}")


class CatalogBuilderAppliesTheGateTest(unittest.TestCase):
    """配る側（9_1）が共通判定を使い続けていること。

    差分レビューは «書かれるべきなのに存在しないコード» を指摘できないので、テストで縛る。
    """

    def setUp(self) -> None:
        self.src = (HERE / "9_1_build_sns_dish_media_catalog.py").read_text(encoding="utf-8")
        self.code = "\n".join(
            line for line in self.src.splitlines()
            if not line.strip().startswith("#") and not line.strip().startswith("--")
        )

    def test_builder_goes_through_the_shared_predicate(self) -> None:
        self.assertIn("resolved_store_confidence_sql(", self.src)
        self.assertIn("AND {STORE_CONFIDENCE_SQL}", self.src,
                      "配信する行の WHERE にゲートが入っていない")

    def test_builder_does_not_rewrite_the_rule_inline(self) -> None:
        """判定を 9_1 の中へ書き直さない（写経した複製は片方だけ直る）。"""
        self.assertNotRegex(self.code, r"restaurant_confidence\s*(>=|<=|>|<)")

    def test_threshold_value_is_not_hardcoded_in_the_builder(self) -> None:
        self.assertIn("default=MIN_RESTAURANT_CONFIDENCE", self.code,
                      "CLI の既定値は共通定数から採ること")
        self.assertNotRegex(self.code, r"0\.6\b|0\.60\b")

    def test_threshold_is_overridable_from_the_cli(self) -> None:
        self.assertIn("--min-restaurant-confidence", self.src)
        self.assertIn('bigquery.ScalarQueryParameter("min_conf", "FLOAT64"', self.src)

    def test_dropped_rows_are_counted_not_silently_lost(self) -> None:
        """落とした投稿数と店数を run ログへ残す。«黙って減る» のが一番まずい。"""
        for marker in ("low_confidence_posts", "low_confidence_stores",
                       "dropped_low_confidence_posts", "dropped_low_confidence_stores"):
            self.assertIn(marker, self.src, f"{marker} を数えていない")
        self.assertIn("min_restaurant_confidence", self.code,
                      "どの閾値で組んだ catalog かを run のパラメータへ残すこと")


class ThresholdLivesInOnePlaceTest(unittest.TestCase):
    """(c) 閾値と判定が `common_sns` の 1 箇所にしか無いこと。

    2 箇所に分かれた時点で、片方だけ動かされて «配る側と数える側がずれる» が戻る。
    """

    def test_constant_is_defined_once(self) -> None:
        self.assertEqual(common_sns.MIN_RESTAURANT_CONFIDENCE, 0.60)
        offenders = [
            p.relative_to(HERE).as_posix() for p in sorted(HERE.rglob("*.py"))
            if p.name != "common_sns.py"
            and re.search(r"MIN_RESTAURANT_CONFIDENCE\s*=\s*[0-9]", p.read_text(encoding="utf-8"))
        ]
        self.assertEqual(offenders, [], "閾値の定義は common_sns だけ: " + ", ".join(offenders))

    def test_nobody_transcribes_the_comparison(self) -> None:
        """`restaurant_confidence` を直接比較する SQL / コードを他所に書かない。

        当てはまらないもの（なぜ当てはまらないかを残す。書かないと次の人がまた調べ直す）:
        - `5_1_apply_resolve.py`: 値を **書く**側。比較していない
        - `test_classify_keeps_decided_half.py`: 値が消えていないことを見るだけ
        """
        me = Path(__file__).name
        offenders = []
        for p in sorted(HERE.rglob("*.py")):
            if p.name in (me, "common_sns.py"):
                continue
            if re.search(r"restaurant_confidence\s*(>=|<=|>|<)", p.read_text(encoding="utf-8")):
                offenders.append(p.relative_to(HERE).as_posix())
        self.assertEqual(
            offenders, [],
            "店の確からしさの判定は common_sns.resolved_store_confidence_sql だけが持つ: "
            + ", ".join(offenders))

    def test_predicate_only_touches_the_resolved_branch(self) -> None:
        """述語が «resolve が決めた行» だけを見ていること（seed-trust の分岐を壊さない）。"""
        sql = common_sns.resolved_store_confidence_sql()
        self.assertIn(f"ps.store_rank != {common_sns.RESOLVED_STORE_RANK}", sql)
        self.assertIn("v.restaurant_confidence IS NOT NULL", sql)
        self.assertIn("v.restaurant_confidence >= @min_conf", sql)
        # 別名を差し替えられること（7_1 など、別の CTE 名で使う側のため）
        other = common_sns.resolved_store_confidence_sql(
            store_cte="s", resolved_cte="latest", threshold_param="conf")
        self.assertIn("s.store_rank !=", other)
        self.assertIn("latest.restaurant_confidence >= @conf", other)


if __name__ == "__main__":
    unittest.main()
