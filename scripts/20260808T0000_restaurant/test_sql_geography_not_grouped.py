"""#1970 GEOGRAPHY の列を SELECT DISTINCT / GROUP BY へ置かせない。

2026-09-10、`4_16` の radius モードが本番データで
`400 Column location of type GEOGRAPHY cannot be used in SELECT DISTINCT` で落ちた。

**同じ日に 3 回、同じ形で落ちている。**

| 落ちたもの | 何を書いたか |
| --- | --- |
| リーダーの検証 query | `SELECT DISTINCT ..., cat.geo` |
| `4_16` radius モード | `SELECT DISTINCT m.google_place_id, m.dish_category_id, c.location` |
| （どちらも）| «異なり» を取りたいのは place_id とカテゴリだけなのに、座標まで DISTINCT に入れた |

BigQuery は GEOGRAPHY を groupable な型として扱わないので、`SELECT DISTINCT` にも
`GROUP BY` にも置けない。**座標は «異なり» を取ったあとに JOIN で付ける**のが正しい形。

このリポジトリの GEOGRAPHY 列は `restaurant_catalog.location` だけなので、
その名前が DISTINCT / GROUP BY の並びに出てきたら落とす。

⚠️ **テストが SQL を実行しないことは、この種の欠陥を止められない理由になる。**
実行しないなら、実行しなくても分かる形（＝ここ）で止める。
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent

#: SQL のコメント（`--` から行末）。説明文の中の語を «実装» と誤判定しないため
_SQL_COMMENT = re.compile(r"--[^\n]*")
#: `SELECT DISTINCT <ここ> FROM`
_SELECT_DISTINCT = re.compile(r"\bSELECT\s+DISTINCT\b(.*?)\bFROM\b", re.I | re.S)
#: `GROUP BY <ここ>`（次の主要な節、閉じ括弧、空行のいずれかまで）
_GROUP_BY = re.compile(
    r"\bGROUP\s+BY\b([^\n]*(?:\n(?!\s*(?:HAVING|ORDER|LIMIT|QUALIFY|UNION|WINDOW|\)|\"\"\"))[^\n]*)*)",
    re.I)
#: GEOGRAPHY の列名（`c.location` のような修飾も拾う）
_GEO_COLUMN = re.compile(r"(?<![\w.])(?:\w+\.)?location\b", re.I)


def _strip_sql_comments(text: str) -> str:
    return _SQL_COMMENT.sub("", text)


def geography_violations(source: str) -> list[tuple[str, str]]:
    """(節, その並び) の一覧を返す。空なら違反なし。**判定はここ 1 箇所**。"""
    body = _strip_sql_comments(source)
    found: list[tuple[str, str]] = []
    for clause, pattern in (("SELECT DISTINCT", _SELECT_DISTINCT), ("GROUP BY", _GROUP_BY)):
        for match in pattern.finditer(body):
            if _GEO_COLUMN.search(match.group(1)):
                found.append((clause, " ".join(match.group(1).split())[:120]))
    return found


class GeographyIsNeverGroupedTest(unittest.TestCase):
    def test_no_script_puts_location_in_distinct_or_group_by(self) -> None:
        checked = 0
        for path in sorted(HERE.rglob("*.py")):
            if path.name == Path(__file__).name:
                continue
            checked += 1
            with self.subTest(script=path.name):
                self.assertEqual(
                    [], geography_violations(path.read_text(encoding="utf-8", errors="replace")),
                    f"{path.name}: GEOGRAPHY の列を DISTINCT / GROUP BY に置いている。"
                    "«異なり» は place_id 側で取り、座標は後から JOIN で付けること")
        self.assertGreater(checked, 20, "走査が空振りしている（scripts が拾えていない）")

    def test_the_check_catches_the_shape_that_actually_failed(self) -> None:
        """番人が空振りしていないこと。2026-09-10 に実際に 400 になった形で確かめる。"""
        broken = """
          SELECT DISTINCT m.google_place_id, m.dish_category_id, c.location
          FROM `x` m JOIN catalog_loc c ON c.google_place_id = m.google_place_id
        """
        self.assertTrue(geography_violations(broken))
        fixed = """
          SELECT DISTINCT google_place_id, dish_category_id
          FROM `x`
        """
        self.assertEqual([], geography_violations(fixed))

    def test_a_comment_mentioning_the_trap_is_not_a_violation(self) -> None:
        """注意書きに «GROUP BY / location» と書いてあるだけで赤くならないこと。"""
        commented = """
          -- GEOGRAPHY は SELECT DISTINCT / GROUP BY に置けない（location を入れない）
          SELECT DISTINCT google_place_id FROM `x`
        """
        self.assertEqual([], geography_violations(commented))


if __name__ == "__main__":
    unittest.main()
