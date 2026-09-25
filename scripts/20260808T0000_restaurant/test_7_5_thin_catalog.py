"""#1947 «店台帳が薄い» を «あと少し» と «物理的に無理» に分ける。

2026-09-25、合格線に届かない地点のうち «500m 圏の店を全部知っていて、全部呼び終えた»
ものを `7_5` は数えていたが、**その地点に何軒あるのかは出していなかった**。
そのため «薄い» としか言えず、供給を足せば届くのか、そもそも 5 店作れないのかを
分けられなかった。KPI は «同じカテゴリで異なり 5 店» なので、**500m 圏の台帳が 5 軒未満の
地点は、Instagram をいくら集めても達成できない**（供給側の算数であって、ゴールを緩める話ではない）。

物差しの 313 地点で実測したところ、5 軒未満は 32 地点（10.2%）あるが、
**合格線の分母である上位 219 地点の中には 1 地点しかない**（最小 4 軒）。
つまり合格線 70% の物理的な天井は 218/219 = 99.5% で、**70% は供給の問題である**。
この «天井» を毎回測り直せるように、地点ごとの台帳の軒数を出力へ足す。
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SOURCE = HERE / "7_5_measure_rank_coverage.py"

_spec = importlib.util.spec_from_file_location("m75t", SOURCE)
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)
SRC = SOURCE.read_text(encoding="utf-8")

DS = "food-scroll.restaurant_recommendation"
DISH = "food-scroll.wikidata_food_graph"


def _sql() -> str:
    return m.build_sql(DS, DISH, sample_n=313, sample_run="restaurant-2026-08-23", radius_m=500)


class TheCatalogDensityIsMeasured(unittest.TestCase):
    def test_the_column_is_selected(self) -> None:
        sql = _sql()
        self.assertIn("pt_all AS", sql)
        self.assertIn("catalog_stores_500m", sql)
        self.assertIn("LEFT JOIN pt_all pa ON pa.point = p.pid", sql)

    def test_it_counts_the_catalog_not_the_delivered(self) -> None:
        """«配信できているか» で絞らないこと。絞ると天井ではなく現状を測ってしまう。"""
        i = _sql().index("pt_all AS")
        block = _sql()[i:i + 400]
        self.assertIn("store_loc s", block)
        self.assertNotIn("delivered", block)
        self.assertNotIn("near", block)

    def test_the_radius_is_the_shared_one(self) -> None:
        """半径をここへ書かない（`7_4` の RADIUS_M と揃っていること）。"""
        sql = m.build_sql(DS, DISH, sample_n=313, sample_run="r", radius_m=777)
        i = sql.index("pt_all AS")
        self.assertIn("777", sql[i:i + 400])


class ThinIsReportedAsANumber(unittest.TestCase):
    """«薄い» で止めず «何軒あるか» と «5 軒未満は何地点か» まで出すこと。"""

    def test_the_deficit_report_prints_the_density(self) -> None:
        body = "\n".join(ln for ln in SRC.splitlines() if not ln.lstrip().startswith("#"))
        self.assertIn("catalog_stores_500m", body)
        self.assertIn("供給をいくら足しても 5 店は作れない地点", body)

    def test_the_ceiling_is_printed_outside_the_thin_branch(self) -> None:
        """#1947 «薄い地点が 0 件» のときも天井が出ること。

        最初の版は «全部呼び終えた» 分岐の中だけに置いていたので、cat25（薄い地点 0 件）
        では 1 度も出ずに終わった。分岐に入らなくても未達地点の軒数は毎回出す。
        """
        self.assertLess(SRC.index("台帳の店数"), SRC.index("«撃てる弾が 1 つも無い»"),
                        "天井の出力が «撃てる弾が無い» 分岐より後ろにある")

    def test_it_uses_five_because_that_is_the_kpi(self) -> None:
        """«5 軒未満» のしきい値が KPI の «5 店» と同じ数であること。"""
        self.assertIn("d < 5", SRC)


class NoColumnIsDroppedOnTheWayOut(unittest.TestCase):
    """#1947 SQL へ足した列を Python 側で落とさない（2026-09-25）。

    `catalog_stores_500m` を `build_sql` の SELECT へ足したが `fetch_points` が組む dict へ
    足し忘れた。読み出し側が `.get(..., 0)` だったので **例外も出ず 0 が返り**、
    «未達 22 地点の台帳は 0 軒» という、すぐ次の行（同じ地点に 1,458 店ある）と
    真っ向から矛盾する数字をログへ出した。

    このテストは列名を並べ直すのではなく、**SELECT の別名を機械的に拾って
    `fetch_points` のキーと突き合わせる**（次に列を足した人も自動で守られる）。
    """

    def test_every_selected_alias_becomes_a_key(self) -> None:
        import re
        sql = _sql()
        tail = sql[sql.rindex("\n    SELECT\n"):]
        aliases = set(re.findall(r"\bAS (\w+)\s*(?:,|\n)", tail))
        body = SRC[SRC.index("def fetch_points("):]
        body = body[:body.index("def select_gap_points(")]
        keys = set(re.findall(r'"(\w+)":', body))
        missing = sorted(aliases - keys)
        self.assertEqual(missing, [],
                         f"build_sql が返す列を fetch_points が落としている: {missing}")

    def test_the_reader_fails_loudly_on_a_missing_key(self) -> None:
        """`.get(key, 0)` で黙って 0 を返さないこと（落ちないと気づけない）。"""
        self.assertNotIn('.get("catalog_stores_500m"', SRC)


if __name__ == "__main__":
    unittest.main()
