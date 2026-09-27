"""#1947 CC WAT の走査が GitHub の 360 分上限に殺されて «何本読んだか» を失わない。

2026-09-27、`--max-files 2000` の 1 シャードの所要が **199 → 228 → 240 分**と伸びていた。
`4_9` には締め切りが無く、360 分に当たると job ごと殺されるので:

- run は «赤» になる（自分の欠陥ではないのに、本物の failure と見分けが付かなくなる）
- «完了: caption付き投稿 …» の行が出ないので、**そのシャードの収量が報告に使えない**

行そのものは `--flush-every` ごとに BQ へ入るので失われない。失われるのは «報告できる形» である。
自分で締め切りを持ち、途中までの結果を出して正常終了する。
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SOURCE = HERE / "4_9_scan_cc_wat_instagram.py"

_spec = importlib.util.spec_from_file_location("m49dl", SOURCE)
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)
SRC = SOURCE.read_text(encoding="utf-8")


class TheRunStopsItself(unittest.TestCase):
    def test_the_default_is_under_the_github_limit(self) -> None:
        """360 分に当たる前に降りること。"""
        i = SRC.index('"--max-minutes"')
        tail = SRC[i:i + 300]
        self.assertIn("default=300", tail)

    def test_the_deadline_is_checked_inside_the_file_loop(self) -> None:
        body = SRC[SRC.index("deadline = time.monotonic()"):]
        self.assertLess(body.index("for n, path in enumerate(mine, 1):"),
                        body.index("if time.monotonic() > deadline:"))

    def test_it_breaks_rather_than_raising(self) -> None:
        """打ち切りは正常終了。«正常なのに赤くする» をやらない。"""
        body = SRC[SRC.index("if time.monotonic() > deadline:"):]
        head = body[:body.index("\n        for ") if "\n        for " in body else 400]
        self.assertIn("break", head)
        self.assertNotIn("raise", head)
        self.assertNotIn("sys.exit", head)

    def test_it_says_how_far_it_got(self) -> None:
        self.assertIn("--max-minutes %d に達したので %d/%d 本で降ります", SRC)

    def test_the_rows_are_described_as_kept(self) -> None:
        """«読んだぶんは残っている» と言う（人が «全部やり直し» と誤解しないため）。"""
        self.assertIn("読んだぶんは BQ へ入っています", SRC)


class TheRunRecordsWhereItStopped(unittest.TestCase):
    def test_the_step_record_says_how_many_files(self) -> None:
        self.assertIn('result["files_read"]', SRC)

    def test_the_step_record_says_why_it_stopped(self) -> None:
        self.assertIn('result["stopped_by"] = "max_minutes" if stopped_early else "all_files"', SRC)

    def test_a_full_pass_is_not_labelled_as_cut_off(self) -> None:
        """全件読み切ったときに «max_minutes» と記録しないこと。"""
        self.assertIn('stopped_early or len(mine)', SRC)


class TheFlushingIsUnchanged(unittest.TestCase):
    """締め切りを足しても «途中で書く» 性質は変えない。"""

    def test_it_still_flushes_every_n_files(self) -> None:
        self.assertIn("if n % args.flush_every == 0:", SRC)

    def test_it_still_flushes_after_the_loop(self) -> None:
        tail = SRC[SRC.index("if n % args.flush_every == 0:"):]
        self.assertIn("\n        flush()", tail)


if __name__ == "__main__":
    unittest.main()
