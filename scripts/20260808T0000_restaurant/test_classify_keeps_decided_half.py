"""#1815 片方が決まらなくても、決まっていた方を捨てない（classify）。

2026-09-05、`classify()` は非対称だった。店が決まらなかったときはカテゴリを残すのに、
**カテゴリが決まらなかったときは決まっていた店を捨てていた**（実測 8,383 行）。
resolve に «取り消し» は無く、決まらなかったのは «決められなかった» だけである。
同じ考え違いで `LATEST_RESOLVED_QUALIFY` が «解けなかった解き直し» に先の結果を
殺させ、カバレッジが cov13 987 → cov14 961 と減っていた。

このテストは個別の値ではなく **«決まった半分を捨てない» というパターン**を固定する。
あわせて、店を残しても配信・計上が壊れないこと（resolve 由来の店候補は
`status='matched'` に限る）も SQL 側で見る。
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import common_sns  # noqa: E402


def _resp(*, category: str | None, place: str | None) -> dict:
    cats = [{"dishCategoryId": category, "confidence": 0.9, "rank": 1}] if category else []
    rsts = [{"googlePlaceId": place, "confidence": 0.8, "rank": 1}] if place else []
    return {"status": "ok", "reason": "ok", "prefill": {}, "restaurantSearch": {},
            "candidates": {"dishCategories": cats, "restaurants": rsts}}


class ClassifyKeepsDecidedHalf(unittest.TestCase):
    def test_no_category_keeps_the_store(self) -> None:
        out = common_sns.classify(_resp(category=None, place="ChIJ_store"))
        self.assertEqual(out.status, common_sns.STATUS_SKIPPED_NO_CATEGORY)
        self.assertEqual(out.google_place_id, "ChIJ_store",
                         "カテゴリが決まらなかっただけで、決まっていた店を捨ててはいけない")
        self.assertIsNotNone(out.restaurant_confidence,
                             "店の確からしさも一緒に捨ててはいけない")

    def test_no_store_keeps_the_category(self) -> None:
        out = common_sns.classify(_resp(category="Q1", place=None))
        self.assertEqual(out.status, common_sns.STATUS_SKIPPED_NO_STORE)
        self.assertEqual(out.dish_category_id, "Q1")

    def test_both_decided_is_matched(self) -> None:
        out = common_sns.classify(_resp(category="Q1", place="ChIJ_store"))
        self.assertEqual(out.status, common_sns.STATUS_MATCHED)
        self.assertEqual((out.google_place_id, out.dish_category_id), ("ChIJ_store", "Q1"))

    def test_neither_decided_keeps_nothing(self) -> None:
        out = common_sns.classify(_resp(category=None, place=None))
        self.assertEqual(out.status, common_sns.STATUS_SKIPPED_NO_CATEGORY)
        self.assertIsNone(out.google_place_id)

    def test_kept_store_cannot_leak_into_delivery(self) -> None:
        # 残した店が «1 投稿 1 店» の候補に混ざると、看板が 2 店を指しているように見えて
        # seed-trust を殺す。resolve 由来の候補は matched に限られていること。
        sql = common_sns.post_store_cte_sql("proj.ds.raw", latest_cte="v")
        self.assertIn("v.status = 'matched'", sql,
                      "resolve 由来の店候補が matched 以外にも広がっている")


if __name__ == "__main__":
    unittest.main()
