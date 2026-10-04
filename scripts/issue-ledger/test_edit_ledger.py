"""#843 台帳の書き換えを守る 3 つの番人を縛る。ネットワークも token も要らない。

守りたい形。どれも実際に踏んだ（あるいは踏みかけた）ものである。

1. **上限（65,536 文字）を超える本文を送らないこと。** 超えた PATCH は
   **HTTP 200 を返しながら黙って切り捨てる**。2026-10-04 時点の残りは 2,733 文字
2. **バッククォートが奇数の本文を送らないこと。** 以降が全部コードブロックになる
3. **置換がちょうど 1 箇所に当たること。** 0 箇所を «何もしない» で通すと、
   別セッションが台帳を書き換えていたときに «当たったつもり» になる

実行:
    python3 -m unittest scripts/issue-ledger/test_edit_ledger.py -v
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import edit_ledger as led  # noqa: E402


class LimitTest(unittest.TestCase):
    def test_the_limit_is_the_github_one(self) -> None:
        self.assertEqual(led.BODY_LIMIT, 65_536)

    def test_body_at_the_limit_passes(self) -> None:
        led.check_body("a" * led.BODY_LIMIT)  # 例外が出ないこと

    def test_one_char_over_the_limit_is_refused(self) -> None:
        with self.assertRaises(led.LedgerError) as caught:
            led.check_body("a" * (led.BODY_LIMIT + 1))
        self.assertIn("上限", str(caught.exception))

    def test_headroom(self) -> None:
        self.assertEqual(led.headroom("a" * 1000), led.BODY_LIMIT - 1000)

    def test_counts_characters_not_bytes(self) -> None:
        """⚠️ 日本語は 1 文字 3 バイト。バイトで数えると «まだ余裕がある» を
        «もう溢れている» と誤判定して、要らない削除をしてしまう。"""
        body = "あ" * 30_000  # 90,000 バイトだが 30,000 文字
        led.check_body(body)
        self.assertEqual(led.headroom(body), led.BODY_LIMIT - 30_000)


class BacktickTest(unittest.TestCase):
    def test_even_backticks_pass(self) -> None:
        led.check_body("`a` と `b`")

    def test_odd_backticks_are_refused(self) -> None:
        with self.assertRaises(led.LedgerError) as caught:
            led.check_body("`a` と `b")
        self.assertIn("奇数", str(caught.exception))


class ApplyEditsTest(unittest.TestCase):
    BODY = "## 未解決事項\n- [ ] 一意な行\n- [ ] 重複\n- [ ] 重複\n"

    def test_applies_a_unique_edit(self) -> None:
        got = led.apply_edits(self.BODY, [{"old": "- [ ] 一意な行", "new": "- [x] 一意な行"}])
        self.assertIn("- [x] 一意な行", got)

    def test_zero_hits_is_an_error_not_a_no_op(self) -> None:
        """⚠️ ここが要。台帳が別セッションに書き換わっていたら気づけること。"""
        with self.assertRaises(led.LedgerError) as caught:
            led.apply_edits(self.BODY, [{"old": "存在しない行", "new": "x"}])
        self.assertIn("0 箇所", str(caught.exception))

    def test_multiple_hits_is_an_error(self) -> None:
        with self.assertRaises(led.LedgerError) as caught:
            led.apply_edits(self.BODY, [{"old": "- [ ] 重複", "new": "x"}])
        self.assertIn("2 箇所", str(caught.exception))

    def test_edits_are_applied_in_order(self) -> None:
        got = led.apply_edits(self.BODY, [{"old": "一意な行", "new": "別名"}, {"old": "別名", "new": "最終"}])
        self.assertIn("- [ ] 最終", got)

    def test_an_edit_that_would_overflow_is_caught_by_check_body(self) -> None:
        """置換で膨らんだ場合も落ちること（apply と check は別の関数なので順番が要る）。"""
        body = "x" + "a" * (led.BODY_LIMIT - 1)
        grown = led.apply_edits(body, [{"old": "x", "new": "xx"}])
        with self.assertRaises(led.LedgerError):
            led.check_body(grown)


if __name__ == "__main__":
    unittest.main()
