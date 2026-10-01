"""#1947 «自分の記録を読めば «ほぼ無駄» と分かる仕事に、限られた予算を使う» を復活させない。

2026-10-01 に同じ欠陥の形が 2 箇所で見つかった。

| どこ | 何に予算を使っていたか | 実測 |
| --- | --- | --- |
| `4_9`（CC WAT） | 9 月に読み終えた WAT を読み直していた | 新規投稿 2.9% |
| `4_14`（キャプション） | 一度空だった投稿を再試行していた | 本文が取れたのは 2.82%（初回は 54.35%） |

どちらも «記録は自分のテーブルにあるのに読んでいなかった» である。
テストは**パターン**に対して書く: «既定で除く» / «除外は無効化できる（捨てない）» /
«判定は 1 箇所» / «実測した数字が残っている»。
"""
import ast
import pathlib
import unittest

HERE = pathlib.Path(__file__).parent
CAP = (HERE / "4_14_fetch_missing_captions.py").read_text(encoding="utf-8")
WAT = (HERE / "4_9_scan_cc_wat_instagram.py").read_text(encoding="utf-8")


class キャプションは既定で既知の空を外す(unittest.TestCase):
    def test_既定で外す(self):
        self.assertIn("skip_known_empty = not args.include_known_empty", CAP,
                      "既定が «外さない» に戻っている")

    def test_外すのをやめる逃げ道が残っている(self):
        # 2.82% は 0 ではない（70,164 件 × 2.82% ≒ 1,978 件）。捨ててはいけない。
        self.assertIn("--include-known-empty", CAP)

    def test_判定は1箇所にしか書かれていない(self):
        self.assertEqual(CAP.count("skip_known_empty = not"), 1)
        tree = ast.parse(CAP)
        sel = [n for n in ast.walk(tree)
               if isinstance(n, ast.FunctionDef) and n.name == "_select_sql"]
        self.assertEqual(len(sel), 1, "対象を選ぶ SQL は 1 箇所（_select_sql）だけ")

    def test_実測した数字がソースに残っている(self):
        # 「なぜこの既定なのか」を数字で残さないと、次に誰かが理由なく戻す。
        for n in ("54.35", "2.82", "154,107"):
            self.assertIn(n, CAP, f"{n} が消えている")

    def test_どちらを使っているかをログに出す(self):
        head = CAP[CAP.index("skip_known_empty = not args.include_known_empty"):]
        self.assertIn("LOGGER.info", head[:400],
                      "«今どちらで走っているか» が run のログから読めないと後から判定できない")


class CC_WATは既読を読み直さない(unittest.TestCase):
    def test_既定で止める(self):
        self.assertIn("if overlap and not args.allow_reread:", WAT)

    def test_読み直す逃げ道が残っている(self):
        self.assertIn("--allow-reread", WAT)

    def test_実測した数字がソースに残っている(self):
        for n in ("2.9%", "82,938", "2,440"):
            self.assertIn(n, WAT, f"{n} が消えている")

    def test_判定は1箇所にしか書かれていない(self):
        tree = ast.parse(WAT)
        names = [n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]
        self.assertEqual(names.count("already_read_indices"), 1)
        self.assertEqual(WAT.count("already_read_indices("), 2,
                         "定義 1 つと呼び出し 1 つだけ（写経すると片方だけ直る）")


if __name__ == "__main__":
    unittest.main()
