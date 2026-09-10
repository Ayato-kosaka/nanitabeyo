"""#1951 «実行計画がどの索引を使ったか» の読み取りを固定する（DB もネットワークも不要）。

⚠️ **このテストが守っているのは «検査が空振りしていることに気付けない» ことである。**

`measure_order_by_posts.py` の店名検索の枝は «`idx_restaurants_name_trgm` が
使われているか» だけで合否を出す。ところが最初の実装は
`Index (Only )?Scan using <索引名>` しか拾っておらず、**Bitmap 経路の
`Bitmap Index Scan on <索引名>` を 1 つも拾えなかった**。trgm 索引は必ず Bitmap 経路で
出るので、**未変更の 3 文字の枝まで «索引に乗っていない» と赤くなった**
（dev run 34419672593）。ノードの種類で前置詞が `using` / `on` に変わるという、
PostgreSQL の EXPLAIN の書式の話である。

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
    NAME_TRGM_INDEX,
    indexes_used,
    name_predicate_is_indexed,
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


class NamePredicateIsIndexedTest(unittest.TestCase):
    def test_trgm_index_present(self):
        self.assertTrue(name_predicate_is_indexed(INDEXED_PLAN))

    def test_location_index_alone_is_not_enough(self):
        """位置索引だけで駆動する形は «索引に乗っている» と数えない。これが 20 秒の形。"""
        self.assertFalse(name_predicate_is_indexed(NOT_INDEXED_PLAN))

    def test_index_name_is_not_matched_as_a_substring(self):
        """別の索引名に trgm 索引名が含まれていても誤検出しない。"""
        self.assertFalse(
            name_predicate_is_indexed(
                ["  ->  Bitmap Index Scan on idx_restaurants_name_trgm_old  (cost=0..1)"]
            )
        )

    def test_constant_matches_an_index_that_actually_exists(self):
        """⚠️ 存在しない索引名を検査対象にすると、この検査は永久に赤くなる（あるいは
        名前を変えた瞬間に永久に赤くなる）。migration に実在することをここで縛る。"""
        self.assertRegex(
            _migration_text(),
            rf"CREATE INDEX[^;]*\b{NAME_TRGM_INDEX}\b",
            f"{NAME_TRGM_INDEX} を作る migration が無い",
        )


def _migration_text() -> str:
    """migration 全体の本文。索引名の写経がずれていないことを見るためだけに読む。"""
    root = Path(measure_order_by_posts.__file__).resolve().parents[2] / "infra/supabase/migrations"
    return "\n".join(f.read_text(encoding="utf-8") for f in sorted(root.glob("*.sql")))


if __name__ == "__main__":
    unittest.main()
