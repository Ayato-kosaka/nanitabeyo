#!/usr/bin/env python3
"""#1947 **数時間かかる収集は、途中で書き出すこと。**

2026-09-18、`4_4` が 5,493 店を約 2 時間 crawl したあと **最後に 1 回だけ** BigQuery へ
書いているのを見つけた。GitHub Actions は 6 時間で job を切るので、大きな crawl を
流した瞬間に «数時間ぶんが丸ごと消える» 状態だった。

**同じ形は #1273 の `4_18` で一度踏んでいる**（「35,000 キーを 2 時間かけて probe した
あと、終わりに 1 回だけ書いていた」）。1 箇所直して終わりにせず、同じ形を全部当たり直す
（CLAUDE.md「直したら、同じ形をしたものを全部探して一括で直す」）。

## 判定（2026-09-19 に 1 本ずつ実データと用途で判定した）

| script | 当てはまるか | 理由 |
| --- | --- | --- |
| `4_4_crawl_official_site_igs` | **当てはまる → 直した** | 5,493 店で約 2 時間。全国規模だと 50 時間になる |
| `4_18_resolve_place_id_by_name` | 当てはまった（#1273 で修正済み） | `test_place_id_by_name` が固定している |
| `4_2_collect_account_posts` | 当てはまらない | 既に flush 実装＋`--max-minutes` で切り上げる |
| `4_22_probe_embed_liveness` | 当てはまらない | 200 行ごとに flush（#1947 で実装） |
| `4_10` / `4_12` / `4_9` | 当てはまらない | flush 関数を持つ |
| `4_3` / `4_5` / `4_6` / `4_7` | **未判定（この番人の対象外）** | 下記 |

⚠️ `4_3` / `4_5` / `4_6` / `4_7` は単一書き込みだが、**いま運用で回していない**ので
実行時間を実測できていない。«推測で直さない»（CLAUDE.md §1）ため、回す時に測ってから
判定する。ここで «当てはまらない» と書いて忘れないよう、**未判定として明記する**。
"""
from __future__ import annotations

import ast
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent

#: この番人が «長時間の収集» とみなし、途中書き出しを要求する script
GUARDED = ("4_4_crawl_official_site_igs.py",)

#: 単一書き込みのまま残っているが、実行時間を実測していないので判定を保留したもの。
#: **空にしてはいけない。** 回す時にここから外して判定する。
UNJUDGED = ("4_3_collect_search_posts.py", "4_5_collect_cc_instagram_posts.py",
            "4_6_collect_wayback_instagram_posts.py", "4_7_collect_search_api_posts.py")


def _source(name: str) -> str:
    return (HERE / name).read_text(encoding="utf-8")


class GuardedScriptsWriteIncrementallyTest(unittest.TestCase):
    def test_the_write_happens_inside_a_loop(self):
        """書き込みが «for の中» にあること。外にしか無ければ全部一度に書いている。"""
        for name in GUARDED:
            with self.subTest(script=name):
                tree = ast.parse(_source(name))
                in_loop = False
                for node in ast.walk(tree):
                    if isinstance(node, (ast.For, ast.While)):
                        for inner in ast.walk(node):
                            if (isinstance(inner, ast.Call)
                                    and isinstance(inner.func, ast.Attribute)
                                    and inner.func.attr == "load_json_rows"):
                                in_loop = True
                self.assertTrue(in_loop,
                                f"{name}: 書き込みがループの外にしか無い（落ちたら全部消える）")

    def test_it_is_chunked_by_an_argument(self):
        for name in GUARDED:
            with self.subTest(script=name):
                self.assertIn('"--chunk-size"', _source(name))

    def test_the_idempotent_delete_is_per_chunk_not_global(self):
        """冪等化の DELETE が全件だと、2 つ目の chunk が 1 つ目を消してしまう。"""
        src = _source("4_4_crawl_official_site_igs.py")
        body = src[src.index("def main("):]
        delete_at = body.index("_delete_batch_rows(pipeline")
        window = body[max(0, delete_at - 300):delete_at]
        self.assertIn("for s in chunk", window,
                      "DELETE の対象が chunk ではなく全件になっている")

    def test_the_summary_counts_every_row_not_just_the_last_chunk(self):
        """chunk ごとに `rows` は作り直されるので、summary は全件の入れ物で数えること。"""
        src = _source("4_4_crawl_official_site_igs.py")
        self.assertIn("summarize_rows(all_rows)", src)


class UnjudgedScriptsAreRecordedTest(unittest.TestCase):
    """«判定していない» ことを消さずに残す（書かないと次の人がまた同じ調査をする）。"""

    def test_the_unjudged_list_is_not_silently_emptied(self):
        self.assertTrue(UNJUDGED, "未判定リストを空にしてはいけない")

    def test_every_unjudged_script_still_exists(self):
        for name in UNJUDGED:
            with self.subTest(script=name):
                self.assertTrue((HERE / name).exists(),
                                f"{name} が無い。消したなら UNJUDGED からも外すこと")

    def test_unjudged_scripts_are_not_in_the_guarded_list(self):
        self.assertFalse(set(UNJUDGED) & set(GUARDED))


if __name__ == "__main__":
    unittest.main()
