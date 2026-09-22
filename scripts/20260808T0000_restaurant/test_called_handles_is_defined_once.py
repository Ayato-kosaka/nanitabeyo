#!/usr/bin/env python3
"""#1947 «もう呼んだ handle» の定義を 2 箇所に書かせない。

2026-09-22 に同じ考え違いを **3 箇所**で踏んだ:

| どこ | 何と言ったか | 実際 |
| --- | --- | --- |
| `7_6` | 「`inflseed` は 0 件しか呼んでいないのに配信店 21,932」 | 台帳（#1815 以降）に無いだけで 265 件呼んでいた |
| `7_5` | 「合格線の 31 地点に **撃てる弾 123 店**」 | `4_2` が実際に呼べたのは **20 件** |
| （報告） | 「Foursquare が 15,984 件の弾を足した」 | 新規は **43 件** |

いずれも **«呼んだ» を `sns_account_attempt` だけで数えた**ことが原因である。
この台帳は #1815 の途中からしか無い。
弾の数を多めに言う方が少なめに言うより害が大きい（計画がその分だけ楽観になる）。
"""
from __future__ import annotations

import ast
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from common_sns import called_handles_sql  # noqa: E402

# 台帳を «呼んだ» の判定に使ってよい script。ここへ足すときは、なぜ
# called_handles_sql で足りないのかを 1 行書くこと。
_MAY_NAME_THE_LEDGER = {
    "common_sns.py",                 # 定義そのもの
    "4_2_collect_account_posts.py",  # 台帳へ **書く** 側。読む側は called_handles_sql を使う
}


class TheDefinitionLivesInOnePlaceTest(unittest.TestCase):
    def test_it_counts_handles_with_posts_as_called(self):
        sql = called_handles_sql("p.d.sns_account_attempt", "p.d.sns_post_raw")
        self.assertIn("sns_account_attempt", sql)
        self.assertIn("UNION DISTINCT", sql)
        self.assertIn("sns_post_raw", sql)

    def test_the_provider_parameter_is_bindable(self):
        self.assertIn("@x", called_handles_sql("a", "b", provider_param="x"))

    def test_no_other_script_writes_its_own_ledger_exclusion(self):
        """`SELECT handle FROM ... sns_account_attempt` を自前で書いている script を禁じる。"""
        offenders = []
        for path in sorted(HERE.glob("[0-9]*.py")):
            if path.name in _MAY_NAME_THE_LEDGER:
                continue
            src = path.read_text(encoding="utf-8")
            if "TABLE_ACCOUNT_ATTEMPT" not in src and "sns_account_attempt" not in src:
                continue
            if "called_handles_sql" not in src:
                offenders.append(path.name)
        self.assertEqual([], offenders,
                         "台帳を直接見ている。common_sns.called_handles_sql を使うこと")

    def test_the_readers_bind_the_provider(self):
        """`@prov` を渡し忘れると «引数が無い» で落ちる。落ちる前にここで気づく。"""
        for name in ("7_5_measure_rank_coverage.py", "7_6_measure_route_yield.py"):
            src = (HERE / name).read_text(encoding="utf-8")
            self.assertIn('"prov"', src, f"{name} が @prov を束ねていない")

    def test_four_two_still_narrows_per_run_for_chunking(self):
        """scope=run は意図的に狭い。ここまで共通化すると分割収集が壊れる。"""
        src = (HERE / "4_2_collect_account_posts.py").read_text(encoding="utf-8")
        self.assertIn("WHERE run_id = @out_rid AND account_id IS NOT NULL", src)

    def test_the_helper_is_syntactically_a_select(self):
        tree = ast.parse((HERE / "common_sns.py").read_text(encoding="utf-8"))
        names = [n.name for n in tree.body if isinstance(n, ast.FunctionDef)]
        self.assertIn("called_handles_sql", names)


if __name__ == "__main__":
    unittest.main()
