#!/usr/bin/env python3
"""#1666 «候補の並び» を写経していないことを固定する。

## なぜ要るか

`inspect_opening_hours_reach.py` は「クロールが歩いた順の何番目で読めたか」を測る。
測る順が本番と 1 文字でも違えば、答え（前半は既に読めなかった店だけだったのか）が
**静かに嘘になる**。緑のまま嘘をつくので、人間には気づけない。

だから «同じ SQL を使っていること» をここで縛る。個別の値ではなく
**「並びを自分で書いていない」という形**に対する回帰テストである。
"""

from __future__ import annotations

import ast
import pathlib
import unittest

REACH = pathlib.Path(__file__).resolve().parent / "inspect_opening_hours_reach.py"
CRAWLER = (
    pathlib.Path(__file__).resolve().parents[1]
    / "20260808T0000_restaurant"
    / "6_3_crawl_official_site_hours.py"
)


def _module_level_sql(path: pathlib.Path) -> dict[str, str]:
    """モジュール直下の `*_SQL` に入っている文字列だけを取り出す。

    ⚠️ 文字列を素の grep で探すと、説明文やログ文言まで «SQL を書いている» と
       誤検出する。縛りたいのは **実行される SQL** だけなので AST で絞る。
    """
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found: dict[str, str] = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if (
                isinstance(target, ast.Name)
                and target.id.endswith("_SQL")
                and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)
            ):
                found[target.id] = node.value.value
    return found


class InspectOpeningHoursReachTest(unittest.TestCase):
    def test_reach_does_not_rewrite_the_candidate_ordering(self) -> None:
        """並び（md5(...)）・対象（kind='website'）を自分で書いていないこと。"""
        for name, sql in _module_level_sql(REACH).items():
            for forbidden in ("md5(", "kind = 'website'", "'^https?://'"):
                assert forbidden not in sql, (
                    f"{REACH.name} の {name} が候補の並び／対象を自分で書いている"
                    f"（{forbidden!r}）。{CRAWLER.name} の CANDIDATE_SQL を import すること。"
                )


    def test_reach_imports_the_production_candidate_sql(self) -> None:
        source = REACH.read_text(encoding="utf-8")
        assert "CANDIDATE_SQL = _crawler.CANDIDATE_SQL" in source
        assert "CRAWL_SOURCE = _crawler.SOURCE" in source


    def test_candidate_sql_still_orders_by_the_seeded_hash(self) -> None:
        """本番側が並びをやめたら、このスクリプトの前提も崩れる。そのとき赤くする。"""
        crawler = CRAWLER.read_text(encoding="utf-8")
        assert "ORDER BY md5(l.restaurant_id::text || %(seed)s)" in crawler


if __name__ == "__main__":
    unittest.main()
