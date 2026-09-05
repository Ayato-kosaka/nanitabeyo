"""#1815 BigQuery スタブを各テストへ写経し直したら落ちる。

2026-09-05、`test_category_image_gate` と `test_4_19_rank_account_candidates` が
**単体では両方通るのに同時に走らせると落ちた**。6 本のテストが同じスタブを各自で持ち
`if "google.cloud.bigquery" not in sys.modules` で «先に入れた者勝ち» になっていて、
属性の少ない方（6 属性）が先に入ると多い方（8 属性）が
`module 'google.cloud.bigquery' has no attribute 'SchemaField'` で collection error になる。

スタブは conftest.py が 1 箇所で用意する。このテストは個別の属性ではなく
**«スタブを 2 箇所以上に書かない» というパターン**を固定する。
"""

from __future__ import annotations

import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
MARKER = 'sys.modules["google.cloud.bigquery"]'


class NoDuplicateBigQueryStub(unittest.TestCase):
    def test_only_conftest_installs_the_stub(self) -> None:
        me = Path(__file__).name  # 自分は MARKER を «探す文字列» として持っているので除く
        offenders = [p.name for p in sorted(HERE.glob("test_*.py"))
                     if p.name != me and MARKER in p.read_text()]
        self.assertEqual(
            offenders, [],
            "BigQuery スタブは conftest.py だけが用意する。写経すると実行順に依存して落ちる: "
            + ", ".join(offenders))

    def test_conftest_provides_the_stub(self) -> None:
        conftest = (HERE / "conftest.py").read_text()
        self.assertIn(MARKER, conftest, "conftest.py がスタブを用意していない")
        for attr in ("SchemaField", "Table", "ParquetOptions", "LoadJobConfig"):
            self.assertIn(attr, conftest, f"conftest.py のスタブに {attr} が無い")


if __name__ == "__main__":
    unittest.main()
