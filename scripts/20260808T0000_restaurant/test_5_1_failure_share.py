"""#1947 resolve が «相手が壊れている» 状態を黙って success で終えないようにする。

2026-09-24、dev の API が落ちた列を読み続けて **9 時間 500 を返し**、店を 1 件も
引けなかったのに、run は success で終わり続けた。さらに要約の «resolve失敗=N» は
追加バッチの頭で 0 に戻る `n_err` を載せていたため、**最後のバッチ 1 本ぶんの数**しか
出ていなかった（total / matched は累積なので桁が合っていなかった）。

守りたいのは 3 つ。

1. **落とさない・赤くしない**（一時的に重いだけの run を赤くするのは見落としと同じくらい悪い）
2. 小さい標本で騒がない
3. 半分以上失敗しているときは、必ず文言が出る
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


m = _load(HERE / "5_1_apply_resolve.py", "apply_resolve_failure_share")


class FailureShareNote(unittest.TestCase):
    def test_silent_when_nothing_failed(self) -> None:
        self.assertIsNone(m.failure_share_note(5_000, 0))

    def test_silent_on_a_small_sample(self) -> None:
        """10 回中 9 回失敗でも騒がない（相手の一瞬の不調と区別できない）。"""
        self.assertIsNone(m.failure_share_note(1, 9))

    def test_silent_below_the_threshold(self) -> None:
        self.assertIsNone(m.failure_share_note(800, 200))

    def test_speaks_up_when_most_calls_fail(self) -> None:
        note = m.failure_share_note(3_834, 20_114)
        self.assertIsNotNone(note)
        self.assertIn("84.0%", note)
        self.assertIn("«この run は成功した» と読まないこと", note)

    def test_says_the_posts_are_not_lost(self) -> None:
        """«やり直せる» を必ず書く。そうしないと «壊れた» だけが伝わって判断できない。"""
        note = m.failure_share_note(1_000, 9_000)
        self.assertIn("解き直せます", note)

    def test_the_threshold_is_a_half_not_a_hair(self) -> None:
        """境界を締めすぎない（正常なのに赤くするガードは同じくらい悪い）。"""
        self.assertEqual(m.FAILURE_SHARE_WARN, 0.5)
        self.assertGreaterEqual(m.FAILURE_SHARE_MIN_CALLS, 100)


class TheSummaryUsesCumulativeCounters(unittest.TestCase):
    """要約に «最後のバッチだけの失敗数» を載せない（total / matched は累積）。"""

    def test_summary_line_reads_the_cumulative_counter(self) -> None:
        src = (HERE / "5_1_apply_resolve.py").read_text(encoding="utf-8")
        i = src.index("sns_post_resolved に %d 件")
        tail = src[i:i + 400]
        self.assertIn("tot_err", tail)
        self.assertNotIn("n_err", tail)

    def test_the_cumulative_counter_is_never_reset(self) -> None:
        src = (HERE / "5_1_apply_resolve.py").read_text(encoding="utf-8")
        self.assertEqual(src.count("tot_ok = tot_err = 0"), 1,
                         "累積カウンタを 2 度初期化したら累積ではない")


if __name__ == "__main__":
    unittest.main()
