#!/usr/bin/env python3
"""#1947 «SQL が使う @param を束ね忘れる» を静的に止める。

2 日で 2 回、同じ形で 400 を出した:

| いつ | 何を借りた | 束ね忘れた |
| --- | --- | --- |
| 2026-09-23 | `7_7.candidate_handles_sql()` を `4_2` から | `@cat_rid` |
| 2026-09-23 | `common_sns.resolved_store_confidence_sql()` を `7_8` から | `@min_conf` |

どちらも **共通の SQL 片を借りた**ときに起きている。借りた側は片の中身を読まないので、
その片が要求するパラメータに気づけない。**実行するまで分からない**のが問題なので、
実行しなくても分かる形（＝ここ）で止める。

## 何を見るか

`build_sql()` 系の関数が返す SQL から `@name` を全部抜き、
**同じ file の中で `ScalarQueryParameter("name"` / `ArrayQueryParameter("name"` が
書かれているか**を確かめる。書かれていなければ束ね忘れである。
"""
from __future__ import annotations

import importlib.util
import re
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

_PARAM = re.compile(r"@([A-Za-z_]\w*)")

#: (file, 関数名, 呼び出す引数) — SQL を «接続せずに» 組める測定 script だけを見る。
_BUILDERS = [
    ("7_5_measure_rank_coverage.py", "build_sql",
     ("food-scroll.restaurant_recommendation", "food-scroll.wikidata_food_graph"),
     {"sample_n": 313, "sample_run": "r", "radius_m": 500}),
    ("7_6_measure_route_yield.py", "build_sql",
     ("food-scroll.restaurant_recommendation",), {}),
    ("7_6_measure_route_yield.py", "build_run_sql",
     ("food-scroll.restaurant_recommendation",), {}),
    ("7_7_measure_deep_dive_headroom.py", "build_sql",
     ("food-scroll.restaurant_recommendation",), {}),
    ("7_7_measure_deep_dive_headroom.py", "build_candidate_sql",
     ("food-scroll.restaurant_recommendation",), {}),
    ("7_7_measure_deep_dive_headroom.py", "candidate_handles_sql",
     ("food-scroll.restaurant_recommendation",), {}),
    ("7_8_measure_gap_point_blocked.py", "build_sql",
     ("food-scroll.restaurant_recommendation", "food-scroll.wikidata_food_graph"),
     {"radius_m": 500}),
    ("4_23_target_gap_point_stores.py", "build_sql",
     ("food-scroll.restaurant_recommendation",), {"radius_m": 500}),
]


def _load(fname: str):
    spec = importlib.util.spec_from_file_location(f"qp_{fname.replace('.', '_')}", HERE / fname)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class EveryParameterTheSqlUsesIsBoundTest(unittest.TestCase):
    def test_builders_bind_what_they_reference(self) -> None:
        for fname, fn_name, args, kwargs in _BUILDERS:
            with self.subTest(script=fname, fn=fn_name):
                module = _load(fname)
                sql = getattr(module, fn_name)(*args, **kwargs)
                src = (HERE / fname).read_text(encoding="utf-8")
                missing = sorted(
                    name for name in set(_PARAM.findall(sql))
                    if f'QueryParameter("{name}"' not in src)
                self.assertEqual(
                    [], missing,
                    f"{fname}: {fn_name}() の SQL が @{' @'.join(missing)} を使うのに "
                    "束ねていない。共通の SQL 片を借りたら、その片が要求する "
                    "パラメータも一緒に束ねること")

    def test_the_check_catches_a_missing_binding(self) -> None:
        """番人が空振りしていないこと。実際に落ちた形で確かめる。"""
        sql = "SELECT 1 WHERE x = @min_conf"
        src = 'ScalarQueryParameter("other", "STRING", v)'
        missing = [n for n in set(_PARAM.findall(sql)) if f'QueryParameter("{n}"' not in src]
        self.assertEqual(["min_conf"], missing)

    def test_the_check_accepts_a_present_binding(self) -> None:
        sql = "SELECT 1 WHERE x = @min_conf"
        src = 'ScalarQueryParameter("min_conf", "FLOAT64", v)'
        missing = [n for n in set(_PARAM.findall(sql)) if f'QueryParameter("{n}"' not in src]
        self.assertEqual([], missing)


if __name__ == "__main__":
    unittest.main()
