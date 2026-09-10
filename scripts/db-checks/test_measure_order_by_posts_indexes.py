"""#1951 «実行計画がどの索引を使ったか» の読み取りを固定する（DB もネットワークも不要）。

⚠️ **このテストが守っているのは «検査が空振りしていることに気付けない» ことである。**

`measure_order_by_posts.py` は各セルで «使った索引» をログへ出す。判定には使わないが、
赤くなったときに «代わりに何が使われたのか» を読む唯一の手掛かりである。ところが最初の実装は
`Index (Only )?Scan using <索引名>` しか拾っておらず、**Bitmap 経路の
`Bitmap Index Scan on <索引名>` を 1 つも拾えなかった**。trgm 索引は必ず Bitmap 経路で
出るので、**未変更の 3 文字の枝まで «索引に乗っていない» と赤くなった**
（dev run 34419672593）。ノードの種類で前置詞が `using` / `on` に変わるという、
PostgreSQL の EXPLAIN の書式の話である。

あわせて、店名の枝の判定そのもの（`verdict_name_shapes`）もここで固定する。

固定するのは «パターン»（CLAUDE.md §5）:
**索引を使うノードの書き方が何通りあっても、名前を取りこぼさない。**

実行:
    python3 -m unittest scripts/db-checks/test_measure_order_by_posts_indexes.py -v
"""

from __future__ import annotations

import sys
import types
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# ⚠️ 計測本体は psycopg2 を import するが、ここで測るのは実行計画の**文字列の読み方**
#    だけで DB は要らない。CI に psycopg2 を入れさせないためにダミーを差しておく。
sys.modules.setdefault("psycopg2", types.ModuleType("psycopg2")).errors = (
    types.SimpleNamespace(QueryCanceled=Exception)
)

import measure_order_by_posts  # noqa: E402
from measure_order_by_posts import (  # noqa: E402
    CONTROL_MIN_SLOWDOWN,
    NAME_SLOWDOWN_LIMIT,
    NAME_TRGM_INDEX,
    indexes_used,
    verdict_name_shapes,
)

# 実際の EXPLAIN (ANALYZE, BUFFERS) から必要な部分だけ写したもの。
# 直した形（2 文字の店名が trgm 索引に乗っている）。
INDEXED_PLAN = [
    "  ->  BitmapAnd  (cost=371.31..422.68 rows=1 width=24)",
    "        ->  Bitmap Index Scan on idx_restaurants_name_trgm"
    "  (cost=0.00..8.00 rows=48 width=0) (actual time=2.9..2.9 rows=48 loops=1)",
    "        ->  Bitmap Index Scan on idx_restaurants_location"
    "  (cost=0.00..4.43 rows=62 width=0) (actual time=159.8..159.8 rows=621656 loops=1)",
    "  ->  Index Scan using restaurants_pkey on restaurants r"
    "  (cost=0.42..2.64 rows=1 width=413) (actual time=0.010..0.010 rows=20 loops=1)",
]

# 直す前の形（`%一蘭%`）。位置索引だけで駆動し、半径内の行をヒープから読んで name で捨てる。
# dev / 半径 1,500km / generic plan で 20,397 ms（run 34419672593）。
NOT_INDEXED_PLAN = [
    "  ->  Bitmap Heap Scan on restaurants r_1  (cost=126.89..178.26 rows=1 width=24)"
    " (actual time=11841.781..20386.5 rows=48 loops=1)",
    "        Filter: (name ~~* '%一蘭%'::text)",
    "        ->  Bitmap Index Scan on idx_restaurants_location"
    "  (cost=0.00..4.43 rows=62 width=0) (actual time=9720.036..9720.036 rows=620414 loops=1)",
    "  ->  Index Scan using restaurants_pkey on restaurants r"
    "  (cost=0.42..2.64 rows=1 width=413) (actual time=0.157..0.157 rows=20 loops=1)",
]


class IndexesUsedTest(unittest.TestCase):
    def test_bitmap_index_scan_uses_on_not_using(self):
        """⚠️ 取りこぼしの本体。`Bitmap Index Scan` は `using` ではなく `on` と書く。"""
        self.assertEqual(
            indexes_used(
                ["  ->  Bitmap Index Scan on idx_restaurants_name_trgm  (cost=0.00..8.00)"]
            ),
            ["idx_restaurants_name_trgm"],
        )

    def test_index_scan_and_index_only_scan_use_using(self):
        self.assertEqual(
            indexes_used(
                [
                    "  ->  Index Scan using restaurants_pkey on restaurants r  (cost=0.42..2.64)",
                    "  ->  Index Only Scan using idx_dishes_restaurant on dishes d  (cost=0.4..1.0)",
                ]
            ),
            ["restaurants_pkey", "idx_dishes_restaurant"],
        )

    def test_seq_scan_contributes_no_index(self):
        self.assertEqual(indexes_used(["  ->  Seq Scan on restaurants r_1  (cost=0..1)"]), [])

    def test_order_is_preserved_and_duplicates_collapsed(self):
        self.assertEqual(
            indexes_used(INDEXED_PLAN),
            ["idx_restaurants_name_trgm", "idx_restaurants_location", "restaurants_pkey"],
        )


class VerdictNameShapesTest(unittest.TestCase):
    """#1951 店名の枝の判定は «3 文字の基準に対する倍率»。

    ⚠️ 構造で判定しようとして 3 回外している（延べ行数 / Seq Scan / 索引名の有無）。
       絶対値の ms も dev では 3 ms と 8,117 ms が同じ形から出るので閾値が引けない。
       ここで固定するのは «相対比較であること» と «対照群が検査の生死を見張ること» の 2 つ。
    """

    # run 34420435499 の実測（best-of-3）。合成値へ置き換えないこと。
    REAL = {
        ("short", "全国 1,500km", "generic"): 129.1,
        ("baseline", "全国 1,500km", "generic"): 117.0,
        ("control", "全国 1,500km", "generic"): 19365.0,
        ("short", "東京駅から 20km", "custom"): 21.0,
        ("baseline", "東京駅から 20km", "custom"): 18.9,
        ("control", "東京駅から 20km", "custom"): 185.6,
    }

    def test_real_measurements_pass(self):
        self.assertEqual(verdict_name_shapes(dict(self.REAL)), [])

    def test_regressed_short_shape_fails(self):
        """2 文字が中間一致へ戻ったら赤。これが守りたい本体。"""
        t = dict(self.REAL)
        t[("short", "全国 1,500km", "generic")] = 19000.0
        failures = verdict_name_shapes(t)
        self.assertEqual(len(failures), 1)
        self.assertIn("店名 2 文字", failures[0])

    def test_control_that_is_no_longer_slow_fails(self):
        """対照群が遅くなくなったら «検査が空振り» として赤。

        検査そのものが働いていることを、毎回この 1 本で確かめる。
        #1629 / #1686 / #1951 で «空振りを ✅ と読む» を三度やっている。
        """
        t = dict(self.REAL)
        t[("control", "東京駅から 20km", "custom")] = 19.0
        failures = verdict_name_shapes(t)
        self.assertEqual(len(failures), 1)
        self.assertIn("空振り", failures[0])

    def test_missing_baseline_is_an_error_not_a_pass(self):
        """基準が測れていないのに «緑» を返さない（空振りを緑と読まないため）。"""
        t = {k: v for k, v in self.REAL.items() if k[0] != "baseline"}
        self.assertTrue(verdict_name_shapes(t))

    def test_thresholds_sit_between_the_measured_populations(self):
        """閾値が実測の «直した形» と «直す前» の間にあること。

        直した形は 3 文字の 0.97〜1.11 倍、対照群は 8.8〜436 倍だった（12 通り実測）。
        どちらかの母集団へ閾値が食い込んだら、この検査は誤警報か空振りになる。
        """
        self.assertGreater(NAME_SLOWDOWN_LIMIT, 1.11)
        self.assertLess(CONTROL_MIN_SLOWDOWN, 8.8)


def _migration_text() -> str:
    """migration 全体の本文。索引名の写経がずれていないことを見るためだけに読む。"""
    root = Path(measure_order_by_posts.__file__).resolve().parents[2] / "infra/supabase/migrations"
    return "\n".join(f.read_text(encoding="utf-8") for f in sorted(root.glob("*.sql")))


if __name__ == "__main__":
    unittest.main()
